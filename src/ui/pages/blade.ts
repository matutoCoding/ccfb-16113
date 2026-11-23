// 页面 1:叶片模型(参数化生成 / STL 导入 / 选晶器引晶段 / 模壳层数)
import type { BladeDef } from '../../core/types';
import { state, currentBlade } from '../state';
import { db } from '../../core/db';
import { h, clear, numField, slider, toast, selectField } from '../dom';
import { GLViewer } from '../viewer';
import { bladeViewerMeshes } from '../scene-helper';
import { generateBlade } from '../../core/geometry';
import { parseSTL, normalizeSTLMesh } from '../../core/geometry';
import { uid, deg2rad } from '../../core/math';

export function renderBladePage(root: HTMLElement): void {
  const def = structuredClone(currentBlade()) as BladeDef;
  root.classList.add('with-viewer');
  root.append(buildLeft(def), buildCenter(def), buildRight(def));
}

function buildLeft(def: BladeDef): HTMLElement {
  const side = h('div', { class: 'sidebar scrollbox' });
  const refresh = () => { clear(side); side.append(...content()); };

  const save = async () => {
    def.updatedAt = Date.now();
    const idx = state.blades.findIndex(b => b.id === def.id);
    if (idx >= 0) state.blades[idx] = def; else state.blades.push(def);
    await db.saveBlade(def);
    toast('叶片参数已保存', 'ok');
  };

  const saveAs = async () => {
    def.id = uid('blade'); def.name += ' (副本)';
    state.blades.push(structuredClone(def));
    state.selectedBladeId = def.id;
    await db.saveBlade(def);
    toast('已另存为新叶片', 'ok');
    refresh();
  };

  function content(): Node[] {
    const nodes: Node[] = [];
    nodes.push(
      h('label', {}, '选择叶片',
        h('select', {
          onchange: async (e: Event) => {
            state.selectedBladeId = (e.target as HTMLSelectElement).value;
            location.reload();
          },
        }, ...state.blades.map(b => h('option', {
          value: b.id, ...(b.id === def.id ? { selected: true } : {}),
        }, b.name)))),
      h('label', {}, '名称', h('input', {
        value: def.name, oninput: (e: Event) => { def.name = (e.target as HTMLInputElement).value; },
      })),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: save }, '保存'),
        h('button', { onclick: saveAs }, '另存'),
      ),
    );

    // 叶身
    const af = def.airfoil;
    nodes.push(h('h3', {}, '叶身'));
    [
      ['叶高 mm', 'height', 1000, 1],
      ['根弦长 mm', 'chordRoot', 1000, 0.5],
      ['顶弦长 mm', 'chordTip', 1000, 0.5],
      ['根厚度 mm', 'thicknessRoot', 1000, 0.2],
      ['顶厚度 mm', 'thicknessTip', 1000, 0.2],
    ].forEach(([label, key, scale, step]) => {
      const obj = af as unknown as Record<string, number>;
      nodes.push(numField(label as string, obj[key as string] * (scale as number),
        step as number, v => { obj[key as string] = v / (scale as number); refresh(); }, 'mm'));
    });
    nodes.push(
      slider('根扭角 °', af.twistRoot * 180 / Math.PI, -30, 30, 0.5,
        v => { af.twistRoot = deg2rad(v); refresh(); }, v => `${v.toFixed(1)}°`),
      slider('顶扭角 °', af.twistTip * 180 / Math.PI, -30, 30, 0.5,
        v => { af.twistTip = deg2rad(v); refresh(); }, v => `${v.toFixed(1)}°`),
      numField('高度分段(热网格 band)', af.bands, 1, v => { af.bands = Math.round(v); refresh(); }),
      numField('环向分段 sector', af.sectors, 2, v => { af.sectors = Math.round(v); refresh(); }),
    );

    // 榫头/缘板
    nodes.push(h('h3', {}, '榫头 / 缘板'));
    [
      ['榫头长度 mm', def.tenon, 'length'], ['榫头宽 mm', def.tenon, 'width'],
      ['榫头厚 mm', def.tenon, 'thickness'],
    ].forEach(([label, obj0, key]) => {
      const obj = obj0 as unknown as Record<string, number>;
      nodes.push(numField(label as string, obj[key as string] * 1000, 0.2,
        v => { obj[key as string] = v / 1000; refresh(); }, 'mm'));
    });
    nodes.push(numField('缘板弦长 mm', def.platform.chord * 1000, 0.5,
      v => { def.platform.chord = v / 1000; refresh(); }));
    nodes.push(numField('缘板宽 mm', def.platform.width * 1000, 0.5,
      v => { def.platform.width = v / 1000; refresh(); }));

    // 选晶器 / 引晶段
    nodes.push(h('h3', {}, '选晶器 / 引晶段'));
    nodes.push(selectField('选晶器形式', def.selector.kind, [
      { value: 'spiral', text: '螺旋 pigtail' },
      { value: 'zigzag', text: '折线 zigzag' },
      { value: 'block', text: '方块 block' },
    ], v => { def.selector.kind = v; refresh(); }));
    nodes.push(numField('选晶器高度 mm', def.selector.height * 1000, 0.5,
      v => { def.selector.height = v / 1000; refresh(); }));
    if (def.selector.kind === 'spiral') {
      nodes.push(numField('螺旋圈数', def.selector.turns ?? 1.5, 0.25,
        v => { def.selector.turns = v; refresh(); }));
      nodes.push(numField('螺旋半径 mm', (def.selector.radius ?? 0) * 1000, 0.5,
        v => { def.selector.radius = v / 1000; refresh(); }));
    }
    if (def.selector.kind === 'zigzag') {
      nodes.push(numField('折线段数', def.selector.zigCount ?? 3, 1,
        v => { def.selector.zigCount = Math.round(v); refresh(); }));
    }
    nodes.push(numField('引晶段高度 mm', def.starter.height * 1000, 0.5,
      v => { def.starter.height = v / 1000; refresh(); }));
    nodes.push(selectField('引晶段截面', def.starter.kind, [
      { value: 'cylinder', text: '圆柱' }, { value: 'square', text: '方柱' },
    ], v => { def.starter.kind = v; refresh(); }));

    // 模壳
    nodes.push(h('h3', {}, '模壳(沾浆淋砂)'));
    nodes.push(numField('制壳层数', def.shell.layers, 1, v => {
      def.shell.layers = Math.round(v); refresh();
    }));
    nodes.push(numField('单层厚度 mm', def.shell.layerThickness * 1000, 0.05,
      v => { def.shell.layerThickness = v / 1000; refresh(); }));
    const thick = def.shell.layers * def.shell.layerThickness;
    nodes.push(h('p', { class: 'muted mono' }, `模壳总厚:${(thick * 1000).toFixed(2)} mm`));
    nodes.push(
      numField('模壳黑度 ε', def.shell.emissivity, 0.01, v => { def.shell.emissivity = v; refresh(); }),
      numField('模壳导热 W/(m·K)', def.shell.conductivity, 0.1,
        v => { def.shell.conductivity = v; refresh(); }),
    );

    // 材料
    nodes.push(h('h3', {}, '合金热物性'));
    nodes.push(
      numField('液相线 K', def.liquidus, 5, v => { def.liquidus = v; refresh(); }),
      numField('固相线 K', def.solidus, 5, v => { def.solidus = v; refresh(); }),
      numField('导热 W/(m·K)', def.materialConductivity, 0.5,
        v => { def.materialConductivity = v; refresh(); }),
    );

    // STL
    nodes.push(h('h3', {}, 'STL 导入'));
    nodes.push(h('input', {
      type: 'file', accept: '.stl',
      onchange: async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const buf = await file.arrayBuffer();
          let mesh = parseSTL(buf);
          mesh = normalizeSTLMesh(mesh, def.airfoil.height, 0);
          def.stlMesh = mesh;
          toast(`已导入 ${mesh.indices.length / 3} 个三角形(作为叶身几何参考)`, 'ok');
        } catch (err) {
          toast('STL 解析失败:' + String(err), 'err');
        }
      },
    }));
    nodes.push(h('p', { class: 'muted' }, '导入的 STL 会归一化到叶身高度,参与显示;辐射网格仍按参数化叶身生成以保证面片规则。'));
    return nodes;
  }
  side.append(...content());
  return side;
}

let viewer: GLViewer | null = null;
let showShell = true;

function buildCenter(def: BladeDef): HTMLElement {
  const wrap = h('div', { class: 'viewer-wrap' });
  const canvas = h('canvas', {});
  const card = h('div', { class: 'overlay-card', style: 'left:14px;top:14px' });
  wrap.append(canvas, card);
  queueMicrotask(() => {
    viewer = new GLViewer(canvas);
    viewer.setMeshes(bladeViewerMeshes(def, showShell));
    const g = generateBlade(def);
    card.innerHTML = '';
    card.append(
      h('div', {}, `总高 ${(g.height * 1000).toFixed(1)} mm`),
      h('div', {}, `辐射面片 ${g.patches.length} 个`),
      h('div', {}, `模壳外接半径 ${(g.boundRadius * 1000).toFixed(1)} mm`),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', {
          class: 'small', onclick: () => {
            showShell = !showShell;
            viewer!.setMeshes(bladeViewerMeshes(def, showShell));
          },
        }, showShell ? '看合金外形' : '看模壳外表面'),
      ),
    );
  });
  return wrap;
}

function buildRight(def: BladeDef): HTMLElement {
  const side = h('div', { class: 'sidebar right scrollbox' });
  const g = generateBlade(def);
  const partCount = new Map<string, number>();
  for (const p of g.patches) partCount.set(p.part, (partCount.get(p.part) ?? 0) + 1);
  side.append(
    h('h3', {}, '几何统计'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '部位'), h('th', {}, '面片数'))),
      h('tbody', {}, ...[...partCount.entries()].map(([k, v]) =>
        h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, String(v)))))),
    h('h3', {}, '模壳层结构'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '层'), h('th', {}, '累计厚度 mm'))),
      h('tbody', {}, ...Array.from({ length: def.shell.layers }, (_, i) =>
        h('tr', {}, h('td', {}, `第 ${i + 1} 层`),
          h('td', { class: 'num' }, ((i + 1) * def.shell.layerThickness * 1000).toFixed(2)))))),
    h('h3', {}, '说明'),
    h('p', { class: 'muted' },
      '模壳外表面由蜡模外形沿顶点法线等厚偏置得到;辐射面片为四边面片,半立方体渲染时拆成两个三角形并共享面片 ID。'),
  );
  return side;
}
