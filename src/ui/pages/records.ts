// 页面 5:浇注记录(组树方案+抽拉曲线+宏观腐蚀缺陷,叠加仿真风险图对照)
import type { PourRecord, DefectMark } from '../../core/types';
import { state } from '../state';
import { db, downloadText } from '../../core/db';
import { h, clear, toast, selectField, numField } from '../dom';
import { uid } from '../../core/math';
import { runSimulation } from '../../core/simulation';
import { DEFAULT_THERMAL } from '../../core/defaults';

let selectedId = '';
let compareRunId = '';

export function renderRecordsPage(root: HTMLElement): void {
  root.classList.remove('with-viewer');
  root.classList.add('single');
  if (!selectedId && state.records.length) selectedId = state.records[0].id;
  const wrap = h('div', { style: 'display:grid;grid-template-columns:300px 1fr;height:100%' });
  wrap.append(buildList(), buildDetail());
  root.append(wrap);
}

function buildList(): HTMLElement {
  const side = h('div', { class: 'sidebar scrollbox' });
  side.append(
    h('h3', {}, '炉次记录'),
    h('button', {
      class: 'primary', style: 'width:100%', onclick: async () => {
        const rec: PourRecord = {
          id: uid('pour'), pourDate: Date.now(),
          furnaceHeatNo: `DS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-XX`,
          clusterId: state.selectedClusterId, furnaceId: state.selectedFurnaceId,
          curveId: state.curves[0]?.id ?? '', totalBlades: 12, scrapped: 0,
          defects: [], macroEtchNote: '', createdAt: Date.now(),
        };
        state.records.push(rec);
        await db.saveRecord(rec);
        selectedId = rec.id;
        rerender();
      },
    }, '➕ 新建浇注记录'),
    ...state.records.map(r => h('div', {
      class: `list-item ${r.id === selectedId ? 'selected' : ''}`,
      onclick: () => { selectedId = r.id; rerender(); },
    },
      h('div', {}, r.furnaceHeatNo),
      h('div', { class: 'muted' },
        `${new Date(r.pourDate).toLocaleDateString('zh-CN')} · ${r.scrapped}/${r.totalBlades} 报废`),
      h('div', { style: r.scrapped > 0 ? 'color:var(--danger)' : 'color:var(--ok)' },
        r.scrapped > 0 ? `⚠ ${r.defects.length} 处缺陷标记` : '✓ 合格'))),
  );
  return side;
}

function buildDetail(): HTMLElement {
  const rec = state.records.find(r => r.id === selectedId);
  const box = h('div', { class: 'scrollbox', style: 'padding:18px;max-width:1100px' });
  if (!rec) {
    box.append(h('p', { class: 'muted' }, '选择或新建一条记录'));
    return box;
  }
  const save = async () => { await db.saveRecord(rec); toast('记录已保存', 'ok'); };

  box.append(
    h('h3', {}, '炉次信息'),
    h('div', { class: 'grid2' },
      h('label', {}, '炉批号', h('input', { value: rec.furnaceHeatNo,
        oninput: (e: Event) => { rec.furnaceHeatNo = (e.target as HTMLInputElement).value; } })),
      h('label', {}, '浇注日期', h('input', { type: 'date',
        value: new Date(rec.pourDate).toISOString().slice(0, 10),
        onchange: (e: Event) => { rec.pourDate = new Date((e.target as HTMLInputElement).value).getTime(); } })),
      selectField('组树方案', rec.clusterId,
        state.clusters.map(c => ({ value: c.id, text: c.name })),
        v => { rec.clusterId = v; save(); }),
      selectField('炉型', rec.furnaceId,
        state.furnaces.map(f => ({ value: f.id, text: f.name })),
        v => { rec.furnaceId = v; save(); }),
      selectField('抽拉曲线', rec.curveId,
        state.curves.map(c => ({ value: c.id, text: c.name })),
        v => { rec.curveId = v; save(); }),
      h('div', { class: 'row' },
        numField('装炉片数', rec.totalBlades, 1, v => { rec.totalBlades = Math.round(v); }),
        numField('报废片数', rec.scrapped, 1, v => { rec.scrapped = Math.round(v); })),
    ),
    h('label', { style: 'margin-top:10px' }, '宏观腐蚀结论',
      h('textarea', { rows: 3, oninput: (e: Event) => {
        rec.macroEtchNote = (e.target as HTMLTextAreaElement).value;
      } }, rec.macroEtchNote)),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: save }, '保存'),
      h('button', { class: 'danger', onclick: async () => {
        await db.remove('record', rec.id);
        state.records.splice(state.records.indexOf(rec), 1);
        selectedId = state.records[0]?.id ?? '';
        rerender();
      } }, '删除记录'),
      h('button', { onclick: () => downloadText(`${rec.furnaceHeatNo}.json`, JSON.stringify(rec, null, 2), 'application/json') }, '导出 JSON'),
    ),

    h('h3', {}, '宏观腐蚀缺陷标记'),
    buildDefectEditor(rec),
    h('h3', {}, '仿真风险叠加对照'),
    buildCompare(rec),
  );
  return box;
}

function buildDefectEditor(rec: PourRecord): HTMLElement {
  const wrap = h('div');
  const redraw = () => {
    clear(wrap);
    wrap.append(
      h('div', { class: 'row' },
        h('button', { onclick: () => addDefect(rec, redraw) }, '➕ 加缺陷标记'),
      ),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '叶片#'), h('th', {}, '叶高(0~1)'), h('th', {}, '方位'),
          h('th', {}, '类型'), h('th', {}, '备注'), h('th', {}))),
        h('tbody', {}, ...rec.defects.map((d, i) => h('tr', {},
          h('td', { class: 'num' }, String(d.bladeIndex + 1)),
          h('td', { class: 'num' }, d.heightRatio.toFixed(2)),
          h('td', {}, d.side),
          h('td', {}, h('span', { class: `tag ${d.type}` }, d.type === 'stray' ? '杂晶' : '雀斑')),
          h('td', {}, d.note ?? ''),
          h('td', {}, h('button', { class: 'small danger', onclick: () => {
            rec.defects.splice(i, 1); db.saveRecord(rec); redraw();
          } }, '删')))))),
      buildStripMap(rec),
    );
  };
  redraw();
  return wrap;
}

function addDefect(rec: PourRecord, redraw: () => void) {
  const d: DefectMark = {
    bladeIndex: Math.min(rec.totalBlades - 1, rec.defects.length),
    heightRatio: 0.5, side: 'inner', type: 'stray', note: '',
  };
  rec.defects.push(d);
  db.saveRecord(rec);
  redraw();
  // 直接让用户在表格行里编辑:替换为可编辑行(简易 prompt 流程)
  const idx = rec.defects.length - 1;
  const bi = prompt('叶片序号(1 起)', String(d.bladeIndex + 1));
  const hr = prompt('叶高比例 0~1(0=底 1=顶)', String(d.heightRatio));
  const side = prompt('方位 inner/outer/left/right', d.side);
  const type = prompt('类型 stray(杂晶)/freckle(雀斑)', d.type);
  const note = prompt('备注', '');
  if (bi) rec.defects[idx].bladeIndex = Math.max(0, parseInt(bi, 10) - 1);
  if (hr) rec.defects[idx].heightRatio = Math.max(0, Math.min(1, parseFloat(hr)));
  if (side && ['inner', 'outer', 'left', 'right'].includes(side)) rec.defects[idx].side = side as DefectMark['side'];
  if (type && ['stray', 'freckle'].includes(type)) rec.defects[idx].type = type as DefectMark['type'];
  rec.defects[idx].note = note ?? '';
  db.saveRecord(rec);
  redraw();
}

/** 条带图:每片叶片一列,高度方向标实际缺陷;旁边叠加仿真风险带 */
function buildStripMap(rec: PourRecord): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: 'height:240px' });
  queueMicrotask(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 800, hgt = 240;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    const n = rec.totalBlades;
    const pad = 40, cw = (w - pad - 10) / n;
    // 仿真风险叠加
    const run = state.runs.find(r => r.id === (compareRunId || rec.simRunId));
    const cluster = state.clusters.find(c => c.id === rec.clusterId);
    ctx.font = '10px monospace';
    for (let i = 0; i < n; i++) {
      const x = pad + i * cw;
      // 背景叶身条
      ctx.fillStyle = '#1e2936';
      ctx.fillRect(x + 2, 14, cw - 4, hgt - 44);
      if (run && cluster) {
        const inst = cluster.instances[i];
        const res = run.steps[Math.floor(run.steps.length / 2)].blades
          .find(b => b.instanceId === inst.id);
        res?.risks.forEach(rk => {
          const y0 = 14 + (1 - (rk.band + 1) / res.risks.length) * (hgt - 44);
          const bh = (hgt - 44) / res.risks.length;
          const v = Math.max(rk.strayRisk, rk.freckleRisk);
          ctx.fillStyle = rk.risk === 'stray' ? 'rgba(255,93,93,0.55)'
            : rk.risk === 'freckle' ? 'rgba(255,176,32,0.55)'
              : `rgba(70,209,125,${0.12 + v * 0.25})`;
          ctx.fillRect(x + 2, y0, cw - 4, bh);
        });
      }
      // 实际缺陷标记
      rec.defects.filter(d => d.bladeIndex === i).forEach(d => {
        const y = 14 + (1 - d.heightRatio) * (hgt - 44);
        ctx.fillStyle = d.type === 'stray' ? '#ff5d5d' : '#ffb020';
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        const off = { inner: 0.25, outer: 0.75, left: 0.4, right: 0.6 }[d.side];
        ctx.arc(x + cw * off, y, 5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      });
      ctx.fillStyle = '#8aa0b4';
      ctx.fillText(String(i + 1), x + cw / 2 - 4, hgt - 24);
    }
    ctx.fillStyle = '#8aa0b4';
    ctx.save(); ctx.translate(14, hgt / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('叶高 底→顶', -30, 0); ctx.restore();
    ctx.fillStyle = '#ff5d5d'; ctx.fillText('● 杂晶(实测)', pad, 10);
    ctx.fillStyle = '#ffb020'; ctx.fillText('● 雀斑(实测)', 110, 10);
    ctx.fillStyle = 'rgba(70,209,125,0.6)'; ctx.fillText('■ 仿真风险带', 210, 10);
  });
  return canvas;
}

function buildCompare(rec: PourRecord): HTMLElement {
  const wrap = h('div');
  const redraw = () => {
    clear(wrap);
    wrap.append(
      h('div', { class: 'row' },
        selectField('对照推演', compareRunId || rec.simRunId || '',
          [{ value: '', text: '— 不叠加 —' },
          ...state.runs.map(r => ({ value: r.id, text: `${r.name} (${new Date(r.createdAt).toLocaleDateString()})` }))],
          v => { compareRunId = v; rec.simRunId = v || undefined; db.saveRecord(rec); redraw(); }),
        h('button', {
          onclick: async () => {
            const cluster = state.clusters.find(c => c.id === rec.clusterId);
            const furnace = state.furnaces.find(f => f.id === rec.furnaceId);
            const curve = state.curves.find(c => c.id === rec.curveId);
            if (!cluster || !furnace || !curve) return toast('关联数据缺失', 'err');
            toast('正在按该炉次参数重算推演…');
            await new Promise(r => setTimeout(r, 30));
            const r = runSimulation(cluster, state.blades, furnace, curve, {
              stepCount: 6, hemicubeRes: 48, params: { ...DEFAULT_THERMAL }, shellOnly: true,
            });
            r.name = `复算 ${rec.furnaceHeatNo}`;
            state.runs.push(r);
            await db.saveRun(r);
            compareRunId = r.id; rec.simRunId = r.id;
            await db.saveRecord(rec);
            toast('复算完成并已关联', 'ok');
            redraw();
          },
        }, '按本炉参数复算'),
      ),
      buildMatchStats(rec),
    );
  };
  redraw();
  return wrap;
}

/** 命中统计:实测缺陷 band 是否落在仿真高风险带 */
function buildMatchStats(rec: PourRecord): HTMLElement {
  const run = state.runs.find(r => r.id === (compareRunId || rec.simRunId));
  if (!run) return h('p', { class: 'muted' }, '选择推演后显示命中率。条带图中圆点为宏观腐蚀实测位置,色带为仿真风险。');
  const cluster = state.clusters.find(c => c.id === rec.clusterId);
  if (!cluster) return h('span');
  let hit = 0;
  const detail: string[] = [];
  for (const d of rec.defects) {
    const inst = cluster.instances[d.bladeIndex];
    if (!inst) continue;
    const res = run.steps[Math.floor(run.steps.length / 2)].blades
      .find(b => b.instanceId === inst.id);
    if (!res) continue;
    const band = Math.min(res.risks.length - 1, Math.floor(d.heightRatio * res.risks.length));
    const rk = res.risks[band];
    const predicted = rk.risk !== 'none' || Math.max(rk.strayRisk, rk.freckleRisk) > 0.4;
    if (predicted) hit++;
    detail.push(`#${d.bladeIndex + 1} 叶高${(d.heightRatio * 100).toFixed(0)}%:${predicted ? '✓ 命中' : '✗ 漏报'}(${d.type})`);
  }
  const rate = rec.defects.length ? (hit / rec.defects.length * 100).toFixed(0) : '—';
  return h('div', {},
    h('div', { class: 'kpi', style: 'margin:8px 0' },
      h('div', { class: 'l' }, '实测缺陷位置与仿真风险带命中率'),
      h('div', { class: 'v' }, `${rate}${rec.defects.length ? '%' : ''}`),
      h('div', { class: 'muted' }, `${hit}/${rec.defects.length} 处`)),
    h('ul', { class: 'muted mono', style: 'font-size:11px' }, ...detail.map(t => h('li', {}, t))));
}

function rerender() {
  const root = document.getElementById('app-main')!;
  clear(root);
  renderRecordsPage(root);
}
