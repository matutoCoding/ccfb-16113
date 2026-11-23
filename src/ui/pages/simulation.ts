// 页面 4:抽拉推演(分步角系数重算、时间轴、热流/风险染色、梯度曲线、建议)
import type { BladeSimResult, SimulationRun, SimulationStep } from '../../core/types';
import { state, currentCluster, currentFurnace } from '../state';
import { db, downloadText, matrixToCSV } from '../../core/db';
import { h, clear, toast, lineChart, slider, numField, selectField } from '../dom';
import { GLViewer, type ViewerMesh } from '../viewer';
import { clusterViewerMeshes } from '../scene-helper';
import { generateBlade, instanceTransform } from '../../core/geometry';
import { runSimulation, advise } from '../../core/simulation';
import { DEFAULT_THERMAL } from '../../core/defaults';
import { mat4Multiply, mat4Translation, rad2deg } from '../../core/math';

let run: SimulationRun | null = null;
let stepIdx = 0;
let bladeSel = 0;
let colorMode: 'risk' | 'heat' | 'plain' = 'risk';
let busy = false;

export function renderSimPage(root: HTMLElement): void {
  root.classList.add('with-viewer');
  root.append(buildLeft(), buildCenter(), buildRight());
}

function buildLeft(): HTMLElement {
  const side = h('div', { class: 'sidebar scrollbox' });
  const cluster = currentCluster(), furnace = currentFurnace(), curve = state.curves[0];

  const resOptions = [
    { value: '48', text: '48 px(快,预览)' },
    { value: '64', text: '64 px(标准)' },
    { value: '96', text: '96 px(精算)' },
    { value: '128', text: '128 px(验收级)' },
  ];
  let res = 64, steps = 8;

  const content = (): Node[] => [
    h('h3', {}, '推演方案'),
    selectField('组树', state.selectedClusterId,
      state.clusters.map(c => ({ value: c.id, text: c.name })),
      v => { state.selectedClusterId = v; location.reload(); }),
    selectField('炉型', state.selectedFurnaceId,
      state.furnaces.map(x => ({ value: x.id, text: x.name })),
      v => { state.selectedFurnaceId = v; location.reload(); }),
    selectField('抽拉曲线', curve.id,
      state.curves.map(c => ({ value: c.id, text: c.name })), () => undefined),
    h('h3', {}, '数值设置'),
    selectField('半立方体分辨率', String(res), resOptions, v => { res = parseInt(v, 10); }),
    numField('抽拉步数', steps, 1, v => { steps = Math.max(2, Math.round(v)); }),
    numField('界面倾斜阈值 °', DEFAULT_THERMAL.tiltLimitDeg, 0.5,
      v => { DEFAULT_THERMAL.tiltLimitDeg = v; }),
    numField('最小温度梯度 K/m', DEFAULT_THERMAL.gradientMin, 100,
      v => { DEFAULT_THERMAL.gradientMin = v; }),
    numField('雀斑 V/G² 临界值', DEFAULT_THERMAL.freckleIndexLimit, 1e-11,
      v => { DEFAULT_THERMAL.freckleIndexLimit = v; }),
    numField('浇注温度 K', DEFAULT_THERMAL.pourTemp, 5,
      v => { DEFAULT_THERMAL.pourTemp = v; }),
    h('button', {
      class: 'primary', style: 'width:100%;margin-top:10px',
      onclick: async () => {
        if (busy) return;
        busy = true;
        toast('推演开始:每步重建场景并重算角系数…');
        try {
          const t0 = performance.now();
          // 用 setTimeout 让 toast 先渲染
          await new Promise(r => setTimeout(r, 30));
          run = runSimulation(cluster, state.blades, furnace, curve, {
            stepCount: steps, hemicubeRes: res,
            params: { ...DEFAULT_THERMAL },
            shellOnly: res < 96,
            log: m => console.info(m),
          });
          run.name = `${cluster.name} / ${furnace.name}`;
          state.runs.push(run);
          state.selectedRunId = run.id;
          await db.saveRun(run);
          stepIdx = 0;
          toast(`推演完成 ${steps} 步,总耗时 ${((performance.now() - t0) / 1000).toFixed(1)} s,已入库`, 'ok', 6000);
          rerender();
        } catch (e) {
          console.error(e);
          toast('推演失败:' + String(e), 'err', 8000);
        } finally {
          busy = false;
        }
      },
    }, '▶ 开始推演'),
    h('h3', {}, '历史推演'),
    ...state.runs.slice().reverse().map(r => h('div', {
      class: `list-item ${run?.id === r.id ? 'selected' : ''}`,
      onclick: () => { run = r; stepIdx = 0; rerender(); },
    },
      h('div', {}, r.name),
      h('div', { class: 'muted mono' },
        `${new Date(r.createdAt).toLocaleString('zh-CN')} · ${r.stepCount} 步 · HC${r.hemicubeRes}px`))),
  ];
  side.append(...content());
  return side;
}

function buildCenter(): HTMLElement {
  const wrap = h('div', { class: 'viewer-wrap' });
  const canvas = h('canvas');
  const overlay = h('div', { class: 'overlay-card', style: 'left:14px;top:14px;max-width:300px' });
  const timeline = h('div', { class: 'timeline-bar' });
  wrap.append(canvas, overlay, timeline);

  queueMicrotask(() => {
    const viewer = new GLViewer(canvas);
    viewer.dist = 0.55;
    drawAll(viewer, overlay, timeline);
    (wrap as unknown as { _viewer: GLViewer })._viewer = viewer;
  });
  return wrap;
}

function drawAll(viewer: GLViewer, overlay: HTMLElement, timeline: HTMLElement) {
  const cluster = currentCluster();
  if (!run) {
    viewer.setMeshes(clusterViewerMeshes(cluster, state.blades, true));
    overlay.innerHTML = '';
    overlay.append(h('div', { class: 'muted' }, '设置参数后点击「开始推演」'));
    timeline.innerHTML = '';
    return;
  }
  const step = run.steps[Math.min(stepIdx, run.steps.length - 1)];
  const meshes = buildColoredMeshes(step, colorMode);
  viewer.mode = colorMode === 'plain' ? 0 : colorMode === 'heat' ? 1 : 2;
  viewer.setMeshes(meshes);

  overlay.innerHTML = '';
  const worst = step.blades
    .map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.maxInnerOuterDeltaT - x.b.maxInnerOuterDeltaT)[0];
  overlay.append(
    h('div', {}, `步骤 ${step.index + 1}/${run.steps.length} · t=${step.t.toFixed(0)} s`),
    h('div', {}, `抽拉位移 ${(step.displacement * 1000).toFixed(1)} mm · 速度 ${(step.speed * 1e6).toFixed(0)} μm/s`),
    h('div', { class: 'mono', style: 'margin-top:4px' },
      `角系数重算耗时 ${step.computeMs.toFixed(0)} ms/步`),
    h('div', { style: `color:var(${worst.b.maxInnerOuterDeltaT > 25 ? 'warn' : 'accent2'});margin-top:6px` },
      `内外温差最大:#${worst.i + 1} 叶片,ΔT=${worst.b.maxInnerOuterDeltaT.toFixed(1)} K,界面倾斜 ${worst.b.maxTiltDeg.toFixed(1)}°`),
    h('div', { class: 'legend', style: 'margin-top:8px' },
      h('span', {}, h('i', { style: 'background:#ff5d5d' }), '杂晶'),
      h('span', {}, h('i', { style: 'background:#ffb020' }), '雀斑'),
      h('span', {}, h('i', { style: 'background:#35d0ba' }), '低风险'),
    ),
  );

  timeline.innerHTML = '';
  const range = h('input', {
    type: 'range', min: '0', max: String(run.steps.length - 1), value: String(stepIdx),
    oninput: (e: Event) => {
      stepIdx = parseInt((e.target as HTMLInputElement).value, 10);
      drawAll(viewer, overlay, timeline);
      refreshRight();
    },
  });
  timeline.append(
    h('div', { class: 'row' },
      h('button', { class: 'small', onclick: () => { stepIdx = Math.max(0, stepIdx - 1); drawAll(viewer, overlay, timeline); refreshRight(); } }, '◀'),
      h('button', { class: 'small', onclick: () => play(viewer, overlay, timeline) }, '▶ 播放'),
      h('button', { class: 'small', onclick: () => {
        colorMode = colorMode === 'risk' ? 'heat' : colorMode === 'heat' ? 'plain' : 'risk';
        drawAll(viewer, overlay, timeline);
      } }, `染色:${colorMode === 'risk' ? '风险' : colorMode === 'heat' ? '热流' : '本色'}`),
      h('button', { class: 'small', onclick: exportMatrix }, '导出角系数矩阵 CSV'),
      h('span', { class: 'muted mono', style: 'flex:0' }, `步 ${stepIdx + 1}/${run.steps.length}`),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'small', onclick: () => { bladeSel = (bladeSel + 1) % cluster.instances.length; refreshRight(); } }, `看叶片 #${bladeSel + 1}`),
    ),
    range,
  );
}

let playTimer = 0;
function play(viewer: GLViewer, overlay: HTMLElement, timeline: HTMLElement) {
  if (!run) return;
  const captured = run;
  clearInterval(playTimer);
  playTimer = window.setInterval(() => {
    stepIdx = (stepIdx + 1) % captured.steps.length;
    drawAll(viewer, overlay, timeline);
    refreshRight();
  }, 900);
}

function buildColoredMeshes(step: SimulationStep, mode: 'risk' | 'heat' | 'plain'): ViewerMesh[] {
  const cluster = currentCluster();
  const out: ViewerMesh[] = [];
  cluster.instances.forEach((inst, i) => {
    const def = state.blades.find(b => b.id === inst.bladeDefId)!;
    const g = generateBlade(def);
    const mesh = mode === 'plain' ? g.displayMesh : g.shellMesh;
    const colors = new Float32Array(mesh.positions.length / 3);
    if (mode !== 'plain') {
      const result = step.blades.find(b => b.instanceId === inst.id);
      if (result) paintColors(mesh, g, result, colors, mode);
    }
    out.push({
      mesh,
      model: mat4Multiply(
        instanceTransform(inst.radius, inst.azimuth, inst.yaw, inst.tilt, inst.tiltDir),
        mat4Translation(0, 0, -step.displacement)),
      baseColor: [0.6, 0.65, 0.72],
      colorByVertex: colors,
    });
  });
  return out;
}

/** 按 band 把风险码/热流值写到顶点;非叶身部位给低风险默认色 */
function paintColors(mesh: ReturnType<typeof generateBlade>['shellMesh'],
  g: ReturnType<typeof generateBlade>, result: BladeSimResult,
  colors: Float32Array, mode: 'risk' | 'heat'): void {
  const airBands = new Map<number, number>(); // local band -> airfoil band
  let firstAir = Infinity;
  for (const p of g.patches) if (p.part === 'airfoil') firstAir = Math.min(firstAir, p.band);
  for (const p of g.patches) {
    if (p.part !== 'airfoil') continue;
    airBands.set(p.band, p.band - firstAir);
  }
  const tMin = Math.min(...result.bands.flatMap(b => b.colTemp));
  const tMax = Math.max(...result.bands.flatMap(b => b.colTemp));
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const pid = mesh.triPatch ? mesh.triPatch[t] : t;
    const local = g.patches[pid];
    let val = 0;
    if (local && local.part === 'airfoil') {
      const ab = airBands.get(local.band) ?? 0;
      const risk = result.risks[ab];
      if (mode === 'risk') {
        if (risk.risk === 'stray') val = 2;
        else if (risk.risk === 'freckle') val = 1;
        else val = Math.max(risk.strayRisk, risk.freckleRisk) * 0.4;
      } else {
        const T = result.bands[ab].colTemp[Math.min(3, local.sector % 4)];
        val = (T - tMin) / (tMax - tMin || 1);
      }
    } else {
      val = mode === 'risk' ? 0.02 : 0.5;
    }
    for (const k of [0, 1, 2]) colors[mesh.indices[t * 3 + k]] = val;
  }
}

function exportMatrix() {
  if (!run) return toast('没有可导出的推演', 'err');
  const step = run.steps[stepIdx];
  const cluster = currentCluster();
  const labels: string[] = [];
  // 标签从场景构建器获取代价高,用 kind+id 简化
  const n = step.viewFactor.sourceIds.length;
  for (let i = 0; i < n; i++) labels.push(`P${i}`);
  void cluster;
  downloadText(`viewfactor_step${stepIdx + 1}.csv`, matrixToCSV(step.viewFactor, labels));
  toast('角系数矩阵已导出 CSV', 'ok');
}

// ---------- 右栏 ----------

function buildRight(): HTMLElement {
  const side = h('div', { class: 'sidebar right scrollbox' });
  const render = () => {
    clear(side);
    if (!run) {
      side.append(h('p', { class: 'muted' }, '完成一次推演后这里显示温度梯度、固液界面与风险判据。'));
      return;
    }
    const step = run.steps[stepIdx];
    const cluster = currentCluster();
    bladeSel = Math.min(bladeSel, cluster.instances.length - 1);
    const inst = cluster.instances[bladeSel];
    const result = step.blades.find(b => b.instanceId === inst.id)!;

    side.append(
      h('h3', {}, `叶片 #${bladeSel + 1} 沿高度结果`),
      h('div', { class: 'grid2' },
        h('div', { class: `kpi ${result.maxTiltDeg > run.tiltLimitDeg ? 'bad' : ''}` },
          h('div', { class: 'l' }, '界面最大倾斜'),
          h('div', { class: 'v' }, `${result.maxTiltDeg.toFixed(1)}°`),
          h('div', { class: 'muted' }, `阈值 ${run.tiltLimitDeg}°`)),
        h('div', { class: `kpi ${result.maxInnerOuterDeltaT > 25 ? 'warn' : ''}` },
          h('div', { class: 'l' }, '内外侧最大温差'),
          h('div', { class: 'v' }, `${result.maxInnerOuterDeltaT.toFixed(1)} K`),
          h('div', { class: 'muted' }, `band #${result.worstBand + 1}`)),
      ),
      h('h3', {}, '温度梯度 G(K/m)沿叶高'),
      buildGradientChart(result),
      h('h3', {}, '四列温度(K)沿叶高'),
      buildTempChart(result),
      h('h3', {}, '风险段'),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'band'), h('th', {}, 'z mm'), h('th', {}, '倾斜°'),
          h('th', {}, 'ΔT K'), h('th', {}, 'V/G²'), h('th', {}, '判定'))),
        h('tbody', {}, ...result.risks.map(rk => h('tr', {},
          h('td', {}, String(rk.band + 1)),
          h('td', { class: 'num' }, (rk.z * 1000).toFixed(1)),
          h('td', { class: 'num' }, rk.tiltDeg.toFixed(1)),
          h('td', { class: 'num' }, rk.innerOuterDeltaT.toFixed(1)),
          h('td', { class: 'num' }, rk.freckleIndex.toExponential(1)),
          h('td', {}, h('span', { class: `tag ${rk.risk}` },
            rk.risk === 'stray' ? '杂晶' : rk.risk === 'freckle' ? '雀斑' : '正常')))))),
      h('h3', {}, '工艺建议'),
      ...advise(step, cluster).map(a => h('div', { class: 'list-item' },
        h('div', { style: 'color:var(--accent)' }, `#${a.bladeIndex + 1} 叶片`),
        h('div', { class: 'muted' }, a.advice))),
      h('h3', {}, '固液界面四列高度'),
      buildInterfaceInfo(result),
    );
  };
  (side as unknown as { _render: () => void })._render = render;
  render();
  return side;
}

function refreshRight() {
  const side = document.querySelector('.sidebar.right') as (HTMLElement & { _render?: () => void }) | null;
  side?._render?.();
}

function buildGradientChart(result: BladeSimResult): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: 'height:170px' });
  queueMicrotask(() => {
    const series = [
      { label: '内侧', color: '#ff5d5d', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.gradient[0] })) },
      { label: '外侧', color: '#4ea1ff', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.gradient[1] })) },
      { label: '左', color: '#35d0ba', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.gradient[2] })) },
      { label: '右', color: '#ffb020', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.gradient[3] })) },
    ];
    lineChart(canvas, series, { xLabel: 'z mm' });
  });
  return canvas;
}

function buildTempChart(result: BladeSimResult): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: 'height:170px' });
  queueMicrotask(() => {
    const series = [
      { label: '内侧', color: '#ff5d5d', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.colTemp[0] })) },
      { label: '外侧', color: '#4ea1ff', pts: result.bands.map(b => ({ x: b.z * 1000, y: b.colTemp[1] })) },
    ];
    lineChart(canvas, series, { xLabel: 'z mm' });
  });
  return canvas;
}

function buildInterfaceInfo(result: BladeSimResult): HTMLElement {
  // 由温度带反推液相线位置(复用风险表里倾斜;这里给四列等温面高度近似)
  const rows = result.bands.length;
  void rows;
  return h('p', { class: 'muted' },
    `界面四列高差折算倾斜角最大 ${result.maxTiltDeg.toFixed(1)}°;倾斜超阈值的 band 已在三维视图中按杂晶色染色,阈值 = ${run?.tiltLimitDeg ?? '-'}°。`);
}

function rerender() {
  const root = document.getElementById('app-main')!;
  clear(root);
  renderSimPage(root);
}

export { rad2deg };
