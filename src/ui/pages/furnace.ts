// 页面 3:炉型参数(双加热区/隔热挡板/水冷结晶器/开孔与通道间隙)
import type { FurnaceDef, HeaterZone } from '../../core/types';
import { state, currentFurnace } from '../state';
import { db } from '../../core/db';
import { h, clear, toast, numField } from '../dom';
import { GLViewer } from '../viewer';
import { furnaceViewerMeshes } from '../scene-helper';
import { uid } from '../../core/math';

export function renderFurnacePage(root: HTMLElement): void {
  const f = structuredClone(currentFurnace()) as FurnaceDef;
  root.classList.add('with-viewer');
  root.append(buildLeft(f), buildCenter(f), buildRight(f));
}

function buildLeft(f: FurnaceDef): HTMLElement {
  const side = h('div', { class: 'sidebar scrollbox' });
  const refresh = () => { clear(side); side.append(...content()); };
  const save = async () => {
    f.updatedAt = Date.now();
    const idx = state.furnaces.findIndex(x => x.id === f.id);
    if (idx >= 0) state.furnaces[idx] = f; else state.furnaces.push(f);
    await db.saveFurnace(f);
    toast('炉型已保存', 'ok');
  };

  function content(): Node[] {
    const n: Node[] = [];
    n.push(h('h3', {}, '炉型'));
    n.push(h('label', {}, '选择炉型', h('select', {
      onchange: (e: Event) => {
        state.selectedFurnaceId = (e.target as HTMLSelectElement).value;
        location.reload();
      },
    }, ...state.furnaces.map(x => h('option', {
      value: x.id, ...(x.id === f.id ? { selected: true } : {}),
    }, x.name)))));
    n.push(h('label', {}, '名称', h('input', { value: f.name,
      oninput: (e: Event) => { f.name = (e.target as HTMLInputElement).value; } })));
    n.push(
      numField('外壁半径 mm', f.wallRadius * 1000, 1, v => { f.wallRadius = v / 1000; refresh(); }),
      numField('炉体高度 mm', f.wallHeight * 1000, 1, v => { f.wallHeight = v / 1000; refresh(); }),
      numField('外壁黑度', f.wallEmissivity, 0.01, v => { f.wallEmissivity = v; refresh(); }),
      numField('环境桶温度 K', f.ambientTemp, 10, v => { f.ambientTemp = v; refresh(); }),
    );

    n.push(h('h3', {}, '加热区'));
    f.zones.forEach((z, zi) => {
      n.push(h('div', { class: 'kpi', style: 'margin-bottom:8px' },
        h('div', { class: 'l' }, `区 ${zi + 1}:${z.name}`),
        numField('中心高度 z mm', z.zCenter * 1000, 1, v => { z.zCenter = v / 1000; refresh(); }),
        numField('区高 mm', z.height * 1000, 1, v => { z.height = v / 1000; refresh(); }),
        numField('加热器内半径 mm', z.radius * 1000, 1, v => { z.radius = v / 1000; refresh(); }),
        numField('温度 K', z.temperature, 5, v => { z.temperature = v; refresh(); }),
        numField('黑度', z.emissivity, 0.01, v => { z.emissivity = v; refresh(); }),
        h('div', { class: 'row' },
          numField('周向分段', z.segments, 2, v => { z.segments = Math.round(v); refresh(); }),
          numField('轴向分段', z.bands, 1, v => { z.bands = Math.round(v); refresh(); })),
      ));
    });
    n.push(h('button', {
      onclick: () => {
        const z: HeaterZone = {
          id: uid('zone'), name: `加热区 ${f.zones.length + 1}`,
          zCenter: 0.5, height: 0.12, radius: f.zones[0]?.radius ?? 0.22,
          temperature: 1773, emissivity: 0.85, segments: 16, bands: 2,
        };
        f.zones.push(z); refresh();
      },
    }, '➕ 增加加热区'));

    n.push(h('h3', {}, '隔热挡板'));
    n.push(
      numField('挡板高度 z mm', f.baffleZ * 1000, 1, v => { f.baffleZ = v / 1000; refresh(); }),
      numField('挡板厚度 mm', f.baffleThickness * 1000, 0.5, v => { f.baffleThickness = v / 1000; refresh(); }),
      numField('开孔半径 mm', f.baffleOpeningRadius * 1000, 0.5,
        v => { f.baffleOpeningRadius = v / 1000; refresh(); }),
      numField('挡板温度 K', f.baffleTemp, 5, v => { f.baffleTemp = v; refresh(); }),
      numField('挡板黑度', f.baffleEmissivity, 0.01, v => { f.baffleEmissivity = v; refresh(); }),
      numField('抽拉通道单边间隙要求 mm', f.pullGap * 1000, 0.5,
        v => { f.pullGap = v / 1000; refresh(); }),
    );

    n.push(h('h3', {}, '水冷结晶器'));
    n.push(
      numField('底盘半径 mm', f.chillRadius * 1000, 1, v => { f.chillRadius = v / 1000; refresh(); }),
      numField('冷却温度 K', f.chillTemp, 5, v => { f.chillTemp = v; refresh(); }),
      numField('底盘黑度', f.chillEmissivity, 0.01, v => { f.chillEmissivity = v; refresh(); }),
    );
    n.push(h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: save }, '保存炉型'),
      h('button', {
        onclick: () => {
          f.id = uid('furnace'); f.name += ' (副本)';
          state.furnaces.push(structuredClone(f));
          db.saveFurnace(f); toast('已另存', 'ok'); refresh();
        },
      }, '另存为')));
    return n;
  }
  side.append(...content());
  return side;
}

function buildCenter(f: FurnaceDef): HTMLElement {
  const wrap = h('div', { class: 'viewer-wrap' });
  const canvas = h('canvas');
  wrap.append(canvas);
  queueMicrotask(() => {
    const v = new GLViewer(canvas);
    v.dist = 0.8; v.pitch = 0.25;
    v.setMeshes(furnaceViewerMeshes(f));
  });
  return wrap;
}

function buildRight(f: FurnaceDef): HTMLElement {
  const side = h('div', { class: 'sidebar right scrollbox' });
  const rows: [string, string, string][] = [
    ['上加热区', `${f.zones[1]?.temperature ?? '-'} K`, `z=${((f.zones[1]?.zCenter ?? 0) * 1000).toFixed(0)} mm`],
    ['下加热区', `${f.zones[0]?.temperature ?? '-'} K`, `z=${((f.zones[0]?.zCenter ?? 0) * 1000).toFixed(0)} mm`],
    ['挡板开孔', `R=${(f.baffleOpeningRadius * 1000).toFixed(0)} mm`, `z=${(f.baffleZ * 1000).toFixed(0)} mm`],
    ['结晶器', `${f.chillTemp} K`, `R=${(f.chillRadius * 1000).toFixed(0)} mm`],
  ];
  side.append(
    h('h3', {}, '结构摘要'),
    h('table', {}, h('tbody', {}, ...rows.map(r => h('tr', {},
      h('td', {}, r[0]), h('td', { class: 'num' }, r[1]), h('td', { class: 'num muted' }, r[2]))))),
    h('h3', {}, '温度沿高度示意'),
    buildProfileChart(f),
    h('h3', {}, '建模说明'),
    h('p', { class: 'muted' },
      '加热器为朝内圆柱面并按周向/轴向分段;挡板为带开孔的圆环(含厚度与孔内壁);结晶器含顶面圆盘与侧面;外壁封闭炉腔并作为环境兜底边界。抽拉时仅模组下移,炉体静止。'),
  );
  return side;
}

function buildProfileChart(f: FurnaceDef): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: 'height:180px' });
  queueMicrotask(() => {
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 300, hgt = 180;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    ctx.scale(dpr, dpr);
    const pts: [number, number][] = [
      [0, f.chillTemp],
      [f.baffleZ * 1000, f.baffleTemp],
    ];
    for (const z of f.zones) {
      pts.push([(z.zCenter - z.height / 2) * 1000, z.temperature]);
      pts.push([(z.zCenter + z.height / 2) * 1000, z.temperature]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const zmax = f.wallHeight * 1000, tmax = Math.max(...pts.map(p => p[1])) * 1.05;
    const sx = (z: number) => 40 + (z / zmax) * (w - 52);
    const sy = (t: number) => hgt - 24 - (t / tmax) * (hgt - 40);
    ctx.strokeStyle = '#ff7a45'; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])));
    ctx.stroke();
    ctx.fillStyle = '#8aa0b4'; ctx.font = '10px monospace';
    ctx.fillText('T/K →', 4, 12);
    ctx.fillText('z mm →', w - 44, hgt - 6);
    // 液相线参考
    ctx.strokeStyle = '#35d0ba'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(40, sy(1623)); ctx.lineTo(w - 12, sy(1623)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#35d0ba'; ctx.fillText('液相线 1623K', w - 110, sy(1623) - 4);
  });
  return canvas;
}
