// 页面 6:角系数验收(平行平板/同轴圆筒解析解对照、行和=1、互换关系、配对累加明细)
import { HemicubeEngine, symmetrize, rowSum } from '../../core/hemicube';
import {
  parallelRectanglesF, coaxialDisksF, cylinderEnclosure, contourViewFactor,
  checkMatrix, rectPoly, diskPoly,
} from '../../core/reference';
import { buildParallelPlates, buildCylinderEnclosure } from '../../core/validation-geometry';
import { h, clear, toast, selectField } from '../dom';
import { db, downloadText } from '../../core/db';
import type { ViewFactorMatrix } from '../../core/types';

let lastCase: {
  engine: HemicubeEngine;
  matrix: ViewFactorMatrix;
  labels: string[];
  receiverList: number[];
} | null = null;

export function renderValidationPage(root: HTMLElement): void {
  root.classList.remove('with-viewer');
  root.classList.add('single');
  const wrap = h('div', { class: 'scrollbox', style: 'padding:18px;max-width:1200px' });
  root.append(wrap);
  wrap.append(
    h('h3', {}, '验收算例(解析解误差 ≤ 1%)'),
    h('div', { class: 'grid2' },
      h('div', { class: 'kpi' },
        h('div', { class: 'l' }, '算例 1:平行等大矩形平板'),
        h('div', { class: 'v', style: 'font-size:14px' }, 'a=b=0.1 m,间距 c=0.05 m,8×8 网格 + 围壁封闭腔'),
        h('div', { class: 'muted' }, '闭式解:平行正对矩形角系数公式')),
      h('div', { class: 'kpi' },
        h('div', { class: 'l' }, '算例 2:同轴圆筒腔'),
        h('div', { class: 'v', style: 'font-size:14px' }, 'R=0.1 m,L=0.15 m;底盘/顶盘/筒壁三表面'),
        h('div', { class: 'muted' }, '闭式解:同轴平行圆盘 + 封闭腔守恒关系')),
    ),
    h('div', { class: 'row', style: 'margin:12px 0;align-items:flex-end' },
      (() => {
        const opts = [
          { value: '48', text: '48 px' }, { value: '64', text: '64 px' },
          { value: '96', text: '96 px' }, { value: '128', text: '128 px(验收)' },
        ];
        return selectField('半立方体分辨率', '96', opts, () => undefined);
      })(),
      h('button', { class: 'primary', id: 'btn-plate', onclick: () => runPlate(wrap) }, '运行算例 1:平行平板'),
      h('button', { class: 'primary', id: 'btn-cyl', onclick: () => runCylinder(wrap) }, '运行算例 2:同轴圆筒'),
      h('button', { onclick: () => runContourCrossCheck(wrap) }, '围道积分交叉验证'),
    ),
    h('div', { id: 'case-out' }),
    h('div', { id: 'pair-out' }),
  );
}

function resultTable(title: string, rows: { label: string; value: string; pass: boolean }[]): HTMLElement {
  return h('div', {},
    h('h3', {}, title),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '检查项'), h('th', {}, '结果'), h('th', {}, '判定'))),
      h('tbody', {}, ...rows.map(r => h('tr', {},
        h('td', {}, r.label),
        h('td', { class: 'num mono' }, r.value),
        h('td', {}, h('span', { class: `tag ${r.pass ? 'none' : 'stray'}` }, r.pass ? 'PASS' : 'FAIL')))))),
  );
}

async function runPlate(wrap: HTMLElement) {
  const out = wrap.querySelector('#case-out') as HTMLElement;
  clear(out);
  const resSel = (wrap.querySelector('select') as HTMLSelectElement).value;
  const N = parseInt(resSel, 10);
  const a = 0.1, b = 0.1, c = 0.05, nx = 8, ny = 8;
  const t0 = performance.now();
  const engine = new HemicubeEngine(N);
  const built = buildParallelPlates(a, b, c, nx, ny);
  engine.uploadScene(built.scene);
  const { matrix } = engine.computeAll({ log: m => console.info(m) });
  const ms = performance.now() - t0;

  const n = built.scene.patches.length;
  // 板间平均角系数
  let fNum = 0;
  for (const i of built.plate1Ids) {
    for (const j of built.plate2Ids) fNum += matrix.rows[i * n + j];
  }
  const fHemi = fNum / built.plate1Ids.length;
  const fExact = parallelRectanglesF(a, b, c);
  const err = Math.abs(fHemi - fExact) / fExact;

  // 行和检查(板 1 面片)
  let maxRowErr = 0;
  for (const i of built.plate1Ids) maxRowErr = Math.max(maxRowErr, Math.abs(rowSum(matrix.rows, i, n) - 1));

  // 互换关系:Ai Fij = Aj Fji(等网格面积相等,直接比较)
  let maxRecip = 0;
  for (const i of built.plate1Ids) {
    for (const j of built.plate2Ids) {
      const lhs = matrix.rows[i * n + j], rhs = matrix.rows[j * n + i];
      const denom = Math.max(1e-12, 0.5 * (lhs + rhs));
      maxRecip = Math.max(maxRecip, Math.abs(lhs - rhs) / denom);
    }
  }

  // 对称化后
  const areas = new Float32Array(n);
  built.scene.patches.forEach((p, i) => { areas[i] = p.area; });
  const sym = symmetrize(matrix.rows, areas, n);
  let maxRecipSym = 0;
  for (const i of built.plate1Ids) {
    for (const j of built.plate2Ids) {
      const lhs = sym[i * n + j], rhs = sym[j * n + i];
      const denom = Math.max(1e-12, 0.5 * (lhs + rhs));
      maxRecipSym = Math.max(maxRecipSym, Math.abs(lhs - rhs) / denom);
    }
  }

  const labels = built.scene.patches.map((p, i) =>
    built.plate1Ids.includes(i) ? `板1_${i}` :
      built.plate2Ids.includes(i) ? `板2_${i}` : `壁_${i}`);

  const rows = [
    { label: '半立方体板间角系数 F₁₂', value: fHemi.toFixed(5), pass: true },
    { label: '解析解(平行矩形闭式)', value: fExact.toFixed(5), pass: true },
    { label: '相对误差', value: `${(err * 100).toFixed(3)} %`, pass: err <= 0.01 },
    { label: '每行求和最大偏差 |ΣF−1|', value: maxRowErr.toExponential(2), pass: maxRowErr <= 0.01 },
    { label: '互换关系最大误差(原始)', value: `${(maxRecip * 100).toFixed(3)} %`, pass: maxRecip <= 0.02 },
    { label: '互换关系最大误差(对称化后)', value: `${(maxRecipSym * 100).toFixed(4)} %`, pass: maxRecipSym <= 0.01 },
    { label: '面片总数 / 计算耗时', value: `${n} 面 / ${ms.toFixed(0)} ms`, pass: ms < 1000 },
  ];
  out.append(resultTable('算例 1 结果', rows));
  lastCase = { engine, matrix, labels, receiverList: built.plate1Ids };
  addPairBrowser(wrap, built.plate1Ids, built.plate2Ids);
  addExport(wrap, matrix, labels, 'parallel-plates');
  if (err <= 0.01) toast('平行平板算例 PASS', 'ok'); else toast('平行平板误差超 1%,请提高分辨率', 'err');
}

async function runCylinder(wrap: HTMLElement) {
  const out = wrap.querySelector('#case-out') as HTMLElement;
  clear(out);
  const N = parseInt((wrap.querySelector('select') as HTMLSelectElement).value, 10);
  const R = 0.1, L = 0.15, seg = 16, bands = 4;
  const t0 = performance.now();
  const engine = new HemicubeEngine(N);
  const built = buildCylinderEnclosure(R, R, L, seg, bands);
  engine.uploadScene(built.scene);
  const { matrix } = engine.computeAll({ log: m => console.info(m) });
  const ms = performance.now() - t0;
  const n = built.scene.patches.length;

  const avg = (rows: number[], cols: number[]) => {
    let s = 0;
    for (const i of rows) for (const j of cols) s += matrix.rows[i * n + j];
    return s / rows.length;
  };
  const F12 = avg(built.bottomIds, built.topIds);
  const F13 = avg(built.bottomIds, built.wallIds);
  const exact = cylinderEnclosure(R, R, L);
  const err12 = Math.abs(F12 - exact.F[0][1]) / exact.F[0][1];
  const err13 = Math.abs(F13 - exact.F[0][2]) / exact.F[0][2];

  // 筒壁自见 F33
  const F33 = avg(built.wallIds, built.wallIds);
  const err33 = Math.abs(F33 - exact.F[2][2]) / exact.F[2][2];

  let maxRowErr = 0;
  for (let i = 0; i < n - 1; i++) maxRowErr = Math.max(maxRowErr, Math.abs(rowSum(matrix.rows, i, n) - 1));

  // 互换(用真实面积):A1 F13 vs A3 F31
  const F31 = avg(built.wallIds, built.bottomIds);
  const lhs = built.areaBottom * F13;
  const rhs = built.areaWall * F31;
  const recipErr = Math.abs(lhs - rhs) / Math.max(1e-12, 0.5 * (Math.abs(lhs) + Math.abs(rhs)));

  const labels = built.scene.patches.map((p, i) =>
    built.bottomIds.includes(i) ? `底盘_${i}` :
      built.topIds.includes(i) ? `顶盘_${i}` : `筒壁_${i}`);

  const rows = [
    { label: 'F(底盘→顶盘) 半立方体', value: F12.toFixed(5), pass: true },
    { label: 'F(底盘→顶盘) 解析解', value: exact.F[0][1].toFixed(5), pass: true },
    { label: 'F₁₂ 相对误差', value: `${(err12 * 100).toFixed(3)} %`, pass: err12 <= 0.01 },
    { label: 'F(底盘→筒壁) 相对误差', value: `${(err13 * 100).toFixed(3)} %`, pass: err13 <= 0.01 },
    { label: 'F(筒壁→筒壁) 自见角系数误差', value: `${(err33 * 100).toFixed(3)} %`, pass: err33 <= 0.01 },
    { label: '每行求和最大偏差', value: maxRowErr.toExponential(2), pass: maxRowErr <= 0.01 },
    { label: '互换 A₁F₁₃ = A₃F₃₁ 误差', value: `${(recipErr * 100).toFixed(3)} %`, pass: recipErr <= 0.01 },
    { label: '面片总数 / 计算耗时', value: `${n} 面 / ${ms.toFixed(0)} ms`, pass: ms < 1000 },
  ];
  out.append(resultTable('算例 2 结果', rows));
  lastCase = { engine, matrix, labels, receiverList: built.bottomIds };
  addPairBrowser(wrap, built.bottomIds, built.topIds.concat(built.wallIds));
  addExport(wrap, matrix, labels, 'cylinder');
  if (Math.max(err12, err13, err33) <= 0.01) toast('同轴圆筒算例 PASS', 'ok');
  else toast('圆筒算例部分指标超差,请提高分辨率', 'err');
}

async function runContourCrossCheck(wrap: HTMLElement) {
  const out = wrap.querySelector('#case-out') as HTMLElement;
  // 平行板:整块 vs 围道积分
  const a = 0.1, c = 0.05;
  const p1 = rectPoly(0, 0, 0, a, a);
  const p2 = rectPoly(0, 0, c, a, a);
  const fContour = contourViewFactor(p1, p2);
  const fFormula = parallelRectanglesF(a, a, c);
  // 同轴圆盘
  const d1 = diskPoly(0.1, 0, 48), d2 = diskPoly(0.1, 0.15, 48);
  const fDiskContour = contourViewFactor(d1, d2);
  const fDiskFormula = coaxialDisksF(0.1, 0.1, 0.15);
  const rows = [
    { label: '平行矩形:围道二重积分', value: fContour.toFixed(6), pass: true },
    { label: '平行矩形:闭式公式', value: fFormula.toFixed(6), pass: true },
    { label: '两者偏差', value: `${(Math.abs(fContour - fFormula) / fFormula * 100).toFixed(4)} %`,
      pass: Math.abs(fContour - fFormula) / fFormula < 0.002 },
    { label: '同轴圆盘:围道积分(48 边)', value: fDiskContour.toFixed(6), pass: true },
    { label: '同轴圆盘:闭式公式', value: fDiskFormula.toFixed(6), pass: true },
    { label: '两者偏差', value: `${(Math.abs(fDiskContour - fDiskFormula) / fDiskFormula * 100).toFixed(3)} %`,
      pass: Math.abs(fDiskContour - fDiskFormula) / fDiskFormula < 0.01 },
  ];
  out.append(resultTable('围道积分(高精度参考)交叉验证', rows));
}

function addPairBrowser(wrap: HTMLElement, receivers: number[], sources: number[]) {
  const box = wrap.querySelector('#pair-out') as HTMLElement;
  clear(box);
  if (!lastCase) return;
  const { engine, labels } = lastCase;
  const rSel = h('select', {}, ...receivers.map(i => h('option', { value: String(i) }, labels[i]))) as HTMLSelectElement;
  const sSel = h('select', {}, ...sources.map(i => h('option', { value: String(i) }, labels[i]))) as HTMLSelectElement;
  const detail = h('div', {});
  const runPair = () => {
    const ri = parseInt(rSel.value, 10);
    const si = parseInt(sSel.value, 10);
    const { accum, pixelCount, rowSum: rs } = engine.computeOne(ri);
    clear(detail);
    const top: { i: number; v: number; px: number }[] = [];
    for (let i = 0; i < accum.length; i++) {
      if (accum[i] > 0) top.push({ i, v: accum[i], px: pixelCount[i] });
    }
    top.sort((x, y) => y.v - x.v);
    top.splice(8);
    const rows = top.map(t => h('tr',
      { style: t.i === si ? 'background:rgba(78,161,255,0.15)' : '' },
      h('td', {}, labels[t.i] ?? `P${t.i}`),
      h('td', { class: 'num' }, String(t.px)),
      h('td', { class: 'num mono' }, t.v.toExponential(5)),
      h('td', { class: 'num' }, `${(t.v / rs * 100).toFixed(2)} %`)));
    detail.append(
      h('p', { class: 'muted' },
        `接收面片 ${labels[ri]}:5 个方向半立方体像素按 ΔF=ΔA/(πr⁴) 权重累加,行和=${rs.toFixed(5)}(理论 1.0)`),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '目标面片'), h('th', {}, '命中像素'),
          h('th', {}, '累加角系数'), h('th', {}, '占行和'))),
        h('tbody', {}, ...rows)),
      h('p', { class: 'mono muted', style: 'font-size:11px' },
        `指定对 ${labels[ri]} → ${labels[si]}:F = ${accum[si].toExponential(5)},像素 ${pixelCount[si]} 个`),
    );
  };
  box.append(
    h('h3', {}, '面片对累加明细(点开看像素如何加权)'),
    h('div', { class: 'row' },
      h('label', { style: 'flex:1' }, '接收面片', rSel),
      h('label', { style: 'flex:1' }, '目标面片', sSel),
      h('button', { class: 'primary', onclick: runPair }, '计算累加明细')),
    detail,
  );
  runPair();
}

function addExport(wrap: HTMLElement, matrix: ViewFactorMatrix, labels: string[], name: string) {
  const out = wrap.querySelector('#case-out') as HTMLElement;
  out.append(h('div', { style: 'margin:10px 0' },
    h('button', {
      onclick: () => {
        const csv = matrixToCSVLocal(matrix, labels);
        downloadText(`viewfactor-${name}.csv`, csv);
        toast('矩阵 CSV 已导出', 'ok');
      },
    }, '导出完整角系数矩阵 CSV'),
    h('button', {
      onclick: async () => {
        await db.saveRun({
          id: `validation_${name}_${Date.now()}`,
          name: `校验矩阵 ${name}`,
          createdAt: Date.now(), clusterId: '', furnaceId: '', curveId: '',
          hemicubeRes: matrix.hemicubeRes, stepCount: 1,
          steps: [{
            index: 0, t: 0, displacement: 0, speed: 0,
            viewFactor: matrix, blades: [], computeMs: 0,
          }],
          tiltLimitDeg: 12, gradientMin: 4000, freckleIndexLimit: 6e-10,
        });
        toast('校验矩阵已存入 IndexedDB', 'ok');
      },
    }, '矩阵入库'),
  ));
}

function matrixToCSVLocal(vf: ViewFactorMatrix, labels: string[]): string {
  const n = vf.sourceIds.length;
  const lines: string[] = [',' + labels.join(',')];
  for (let i = 0; i < n; i++) {
    lines.push(labels[i] + ',' + Array.from({ length: n },
      (_, j) => vf.rows[i * n + j].toExponential(6)).join(','));
  }
  return lines.join('\n');
}

// 全局矩阵检查(供控制台/后续扩展)
export function fullMatrixCheck(matrix: ViewFactorMatrix, areas: number[]) {
  return checkMatrix(matrix.rows, matrix.sourceIds.length, areas);
}
