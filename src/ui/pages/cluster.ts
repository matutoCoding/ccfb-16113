// 页面 2:组树排布(圆周排布、拖拽调半径/方位/yaw/倾角、碰撞标红)
import type { BladeInstance, ClusterDef } from '../../core/types';
import { state, currentCluster, currentBlade } from '../state';
import { db } from '../../core/db';
import { h, clear, toast, numField, slider } from '../dom';
import { GLViewer } from '../viewer';
import { clusterViewerMeshes } from '../scene-helper';
import { SceneBuilder } from '../../core/scene';
import { generateBlade } from '../../core/geometry';
import { uid, rad2deg, deg2rad } from '../../core/math';

let selectedInst = 0;

export function renderClusterPage(root: HTMLElement): void {
  const cluster = currentCluster();
  root.classList.add('with-viewer');
  root.append(buildLeft(cluster), buildCenter(cluster), buildRight(cluster));
}

function buildLeft(cluster: ClusterDef): HTMLElement {
  const side = h('div', { class: 'sidebar scrollbox' });
  const refresh = () => { clear(side); side.append(...content()); };

  async function persist() {
    cluster.updatedAt = Date.now();
    await db.saveCluster(cluster);
  }

  function content(): Node[] {
    const nodes: Node[] = [];
    nodes.push(h('h3', {}, '组树方案'));
    nodes.push(h('label', {}, '方案', h('select', {
      onchange: (e: Event) => {
        state.selectedClusterId = (e.target as HTMLSelectElement).value;
        location.reload();
      },
    }, ...state.clusters.map(c => h('option', {
      value: c.id, ...(c.id === cluster.id ? { selected: true } : {}),
    }, c.name)))));
    nodes.push(h('label', {}, '名称', h('input', {
      value: cluster.name,
      oninput: (e: Event) => { cluster.name = (e.target as HTMLInputElement).value; },
    })));
    nodes.push(numField('底盘半径 mm', cluster.chillDiskRadius * 1000, 1,
      v => { cluster.chillDiskRadius = v / 1000; persist(); refresh(); }));

    nodes.push(h('h3', {}, '圆周排布'));
    nodes.push(h('div', { class: 'row' },
      h('button', {
        onclick: () => {
          const n = parseInt(prompt('叶片数量(2~24)', String(cluster.instances.length)) || '0', 10);
          if (n >= 2 && n <= 24) rebuildCircle(cluster, n);
        },
      }, '按片数重排'),
      h('button', {
        onclick: () => {
          const r = parseFloat(prompt('排布半径 mm', String(cluster.instances[0]?.radius * 1000 || '135')) || '0');
          if (r > 0) {
            cluster.instances.forEach(it => { it.radius = r / 1000; });
            persist(); refresh();
          }
        },
      }, '统一半径'),
    ));

    const inst = cluster.instances[selectedInst];
    if (inst) {
      nodes.push(h('h3', {}, `叶片 #${selectedInst + 1} 参数`));
      nodes.push(slider('半径 mm', inst.radius * 1000, 40, 220, 0.5,
        v => { inst.radius = v / 1000; persist(); refresh(); }, v => `${v.toFixed(1)}`));
      nodes.push(slider('方位角 °', rad2deg(inst.azimuth), 0, 360, 0.5,
        v => { inst.azimuth = deg2rad(v); persist(); refresh(); }, v => `${v.toFixed(1)}°`));
      nodes.push(slider('朝向 yaw °', rad2deg(inst.yaw), -90, 90, 0.5,
        v => { inst.yaw = deg2rad(v); persist(); refresh(); }, v => `${v.toFixed(1)}°`));
      nodes.push(slider('倾角 °', rad2deg(inst.tilt), -15, 15, 0.25,
        v => { inst.tilt = deg2rad(v); persist(); refresh(); }, v => `${v.toFixed(2)}°`));
      nodes.push(slider('倾斜方向 °', rad2deg(inst.tiltDir), 0, 360, 1,
        v => { inst.tiltDir = deg2rad(v); persist(); refresh(); }, v => `${v.toFixed(0)}°`));
      nodes.push(h('p', { class: 'muted' }, 'yaw=0 时叶背正对炉心;顶视图中可直接拖动叶片调整半径与方位,拖动外圈短杆调 yaw。'));
      nodes.push(h('div', { class: 'row' },
        h('button', { class: 'danger', onclick: () => {
          cluster.instances.splice(selectedInst, 1);
          selectedInst = Math.max(0, selectedInst - 1);
          persist(); refresh();
        } }, '删除该叶片'),
        h('button', { onclick: () => {
          const copy: BladeInstance = structuredClone(inst);
          copy.id = uid('inst');
          cluster.instances.push(copy);
          persist(); refresh();
        } }, '复制一片'),
      ));
    }

    nodes.push(h('h3', {}, '添加叶片'));
    nodes.push(h('button', { onclick: () => {
      const n = cluster.instances.length;
      cluster.instances.push({
        id: uid('inst'), bladeDefId: state.selectedBladeId,
        radius: cluster.instances[0]?.radius ?? 0.135,
        azimuth: n ? (n / (n + 1)) * Math.PI * 2 : 0,
        yaw: 0, tilt: 0, tiltDir: 0,
      });
      persist(); refresh();
    } }, '➕ 加一片'));
    return nodes;
  }
  side.append(...content());
  return side;
}

function rebuildCircle(cluster: ClusterDef, n: number) {
  const r = cluster.instances[0]?.radius ?? 0.135;
  const defId = cluster.instances[0]?.bladeDefId ?? state.selectedBladeId;
  cluster.instances = Array.from({ length: n }, (_, i) => ({
    id: uid('inst'), bladeDefId: defId, radius: r,
    azimuth: (i / n) * Math.PI * 2, yaw: 0, tilt: 0, tiltDir: 0,
  }));
  selectedInst = 0;
  db.saveCluster(cluster);
  location.reload();
}

let viewer3d: GLViewer | null = null;

function buildCenter(cluster: ClusterDef): HTMLElement {
  const wrap = h('div', { class: 'viewer-wrap', style: 'display:grid;grid-template-rows:1fr 260px' });
  const canvas3d = h('canvas', { style: 'min-height:0' });
  const topWrap = h('div', { style: 'position:relative;border-top:1px solid var(--line);min-height:0' });
  const canvas2d = h('canvas', { style: 'width:100%;height:100%;display:block;cursor:crosshair' });
  topWrap.append(canvas2d);
  wrap.append(canvas3d, topWrap);

  const builder = new SceneBuilder(cluster, state.blades, state.furnaces[0]);
  const collisions = builder.checkCollisions();
  const badOwners = new Set<number>();
  collisions.forEach(c => { badOwners.add(c.a); badOwners.add(c.b); });

  queueMicrotask(() => {
    viewer3d = new GLViewer(canvas3d);
    viewer3d.dist = 0.55;
    viewer3d.setMeshes(clusterViewerMeshes(cluster, state.blades, true, badOwners));
    drawTopView(canvas2d, cluster, collisions, (idx) => {
      selectedInst = idx;
      renderClusterPage(clearRoot());
    }, (idx, kind, dx, dy) => {
      const it = cluster.instances[idx];
      if (kind === 'move') {
        const r = Math.hypot(dx, dy);
        it.radius = Math.max(0.03, Math.min(0.24, r));
        it.azimuth = Math.atan2(dy, dx);
      } else {
        const worldAz = Math.atan2(dy, dx);
        it.yaw = worldAz - it.azimuth + Math.PI / 2;
      }
      db.saveCluster(cluster);
      renderClusterPage(clearRoot());
    });
  });
  return wrap;
}

function clearRoot(): HTMLElement {
  const root = document.getElementById('app-main')!;
  clear(root);
  root.classList.add('with-viewer');
  return root;
}

/** 顶视图:俯视 xy 平面,叶片画成带朝向短杆的轮廓 */
function drawTopView(canvas: HTMLCanvasElement, cluster: ClusterDef,
  collisions: { a: number; b: number; minGap: number }[],
  onPick: (idx: number) => void,
  onDrag: (idx: number, kind: 'move' | 'yaw', dx: number, dy: number) => void): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const draw = () => {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    const cx = w / 2, cy = hgt / 2;
    const scale = Math.min(w, hgt) / 2 / 0.26;
    const X = (x: number) => cx + x * scale;
    const Y = (y: number) => cy - y * scale;

    // 底盘圆
    ctx.strokeStyle = '#4ea1ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, cluster.chillDiskRadius * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#2b3949';
    ctx.beginPath(); ctx.arc(cx, cy, 0.26 * scale, 0, Math.PI * 2); ctx.stroke();
    // 炉心标记
    ctx.fillStyle = '#8aa0b4';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillText('炉心', cx + 6, cy - 6);

    const bad = new Set<number>();
    collisions.forEach(c => { bad.add(c.a); bad.add(c.b); });

    cluster.instances.forEach((it, i) => {
      const def = state.blades.find(b => b.id === it.bladeDefId)!;
      const g = generateBlade(def);
      const px = X(it.radius * Math.cos(it.azimuth));
      const py = Y(it.radius * Math.sin(it.azimuth));
      const r = g.boundRadius * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-(it.azimuth + it.yaw - Math.PI / 2));
      const isSel = i === selectedInst, isBad = bad.has(i);
      ctx.strokeStyle = isBad ? '#ff5d5d' : isSel ? '#35d0ba' : '#8aa0b4';
      ctx.fillStyle = isBad ? 'rgba(255,93,93,0.25)' : 'rgba(78,161,255,0.12)';
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // yaw 短杆:局部 -Y 朝炉心
      ctx.strokeStyle = '#ffb020';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, r * 1.1); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = isBad ? '#ff5d5d' : '#dce6f0';
      ctx.font = '10px monospace';
      ctx.fillText(String(i + 1), px + 4, py - 4);
    });
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);

  // 交互
  let dragIdx = -1; let dragKind: 'move' | 'yaw' = 'move';
  const toWorld = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width, rect.height) / 2 / 0.26;
    return {
      x: (e.clientX - rect.left - rect.width / 2) / scale,
      y: -(e.clientY - rect.top - rect.height / 2) / scale,
    };
  };
  canvas.onpointerdown = (e) => {
    const wp = toWorld(e);
    let best = -1, bestD = 0.02;
    cluster.instances.forEach((it, i) => {
      const d = Math.hypot(wp.x - it.radius * Math.cos(it.azimuth),
        wp.y - it.radius * Math.sin(it.azimuth));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) return;
    dragIdx = best;
    onPick(best);
    dragKind = bestD < 0.012 ? 'move' : 'yaw';
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (dragIdx < 0) return;
    const wp = toWorld(e);
    onDrag(dragIdx, dragKind, wp.x, wp.y);
  };
  canvas.onpointerup = () => { dragIdx = -1; };
}

function buildRight(cluster: ClusterDef): HTMLElement {
  const side = h('div', { class: 'sidebar right scrollbox' });
  const builder = new SceneBuilder(cluster, state.blades, state.furnaces[0]);
  const collisions = builder.checkCollisions();
  side.append(h('h3', {}, '碰撞 / 间隙检查'));
  if (!collisions.length) {
    side.append(h('p', { style: 'color:var(--ok)' }, '✓ 所有模壳间距正常(阈值 20 mm)'));
  } else {
    side.append(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '叶片对'), h('th', {}, '间隙 mm'))),
      h('tbody', {}, ...collisions.map(c => h('tr', {},
        h('td', { style: 'color:var(--danger)' }, `#${c.a + 1} ↔ #${c.b + 1}`),
        h('td', { class: 'num', style: c.minGap < 0 ? 'color:var(--danger)' : '' },
          (c.minGap * 1000).toFixed(1)))))));
  }
  side.append(h('h3', {}, '叶片清单'));
  side.append(h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, '#'), h('th', {}, 'R mm'), h('th', {}, '方位°'), h('th', {}, 'yaw°'), h('th', {}, '倾角°'))),
    h('tbody', {}, ...cluster.instances.map((it, i) =>
      h('tr', {
        style: i === selectedInst ? 'background:var(--panel2);cursor:pointer' : 'cursor:pointer',
        onclick: () => { selectedInst = i; renderClusterPage(clearRoot()); },
      },
        h('td', {}, String(i + 1)),
        h('td', { class: 'num' }, (it.radius * 1000).toFixed(1)),
        h('td', { class: 'num' }, rad2deg(it.azimuth).toFixed(1)),
        h('td', { class: 'num', style: Math.abs(rad2deg(it.yaw)) > 10 ? 'color:var(--warn)' : '' },
          rad2deg(it.yaw).toFixed(1)),
        h('td', { class: 'num' }, rad2deg(it.tilt).toFixed(2)))))));

  // 抽拉通道间隙核算
  const f = state.furnaces.find(x => x.id === state.selectedFurnaceId) ?? state.furnaces[0];
  const maxR = Math.max(...cluster.instances.map(it => {
    const def = state.blades.find(b => b.id === it.bladeDefId)!;
    return it.radius + generateBlade(def).boundRadius;
  }));
  const gap = f.baffleOpeningRadius - maxR;
  side.append(
    h('h3', {}, '挡板通道校核'),
    h('div', { class: `kpi ${gap < f.pullGap ? 'bad' : ''}` },
      h('div', { class: 'l' }, '模壳外缘到挡板开孔单边间隙'),
      h('div', { class: 'v' }, `${(gap * 1000).toFixed(1)} mm`),
      h('div', { class: 'muted' }, `工艺要求 ≥ ${(f.pullGap * 1000).toFixed(1)} mm,开孔 R=${(f.baffleOpeningRadius * 1000).toFixed(0)} mm`),
    ),
  );
  return side;
}
