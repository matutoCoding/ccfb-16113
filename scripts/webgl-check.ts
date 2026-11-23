// 无头数值验证入口:被 Playwright 加载,把结果写到 window.__TEST_RESULT__
import { HemicubeEngine, symmetrize, rowSum } from '../src/core/hemicube';
import {
  parallelRectanglesF, coaxialDisksF, cylinderEnclosure, contourViewFactor,
  rectPoly, diskPoly,
} from '../src/core/reference';
import { buildParallelPlates, buildCylinderEnclosure } from '../src/core/validation-geometry';

interface TestOutcome {
  name: string;
  pass: boolean;
  details: Record<string, number | string>;
}

function plateCase(res: number): TestOutcome {
  const a = 0.1, b = 0.1, c = 0.05, nx = 8, ny = 8;
  const engine = new HemicubeEngine(res);
  const built = buildParallelPlates(a, b, c, nx, ny);
  engine.uploadScene(built.scene);
  const { matrix } = engine.computeAll();
  const n = built.scene.patches.length;
  let fNum = 0;
  for (const i of built.plate1Ids) for (const j of built.plate2Ids) fNum += matrix.rows[i * n + j];
  const fHemi = fNum / built.plate1Ids.length;
  const fExact = parallelRectanglesF(a, b, c);
  const err = Math.abs(fHemi - fExact) / fExact;
  let maxRowErr = 0;
  for (const i of built.plate1Ids) maxRowErr = Math.max(maxRowErr, Math.abs(rowSum(matrix.rows, i, n) - 1));
  let maxRecip = 0;
  for (const i of built.plate1Ids) for (const j of built.plate2Ids) {
    const lhs = matrix.rows[i * n + j], rhs = matrix.rows[j * n + i];
    maxRecip = Math.max(maxRecip, Math.abs(lhs - rhs) / Math.max(1e-12, 0.5 * (lhs + rhs)));
  }
  const areas = new Float32Array(built.scene.patches.map(p => p.area));
  const sym = symmetrize(matrix.rows, areas, n);
  let maxRecipSym = 0;
  for (const i of built.plate1Ids) for (const j of built.plate2Ids) {
    const lhs = sym[i * n + j], rhs = sym[j * n + i];
    maxRecipSym = Math.max(maxRecipSym, Math.abs(lhs - rhs) / Math.max(1e-12, 0.5 * (lhs + rhs)));
  }
  engine.dispose();
  return {
    name: `平行平板 HC${res}`,
    pass: err <= 0.01 && maxRowErr <= 0.01,
    details: {
      fHemi, fExact, relErrPct: err * 100,
      maxRowErr, maxRecipPct: maxRecip * 100, maxRecipSymPct: maxRecipSym * 100,
      patches: n,
    },
  };
}

function cylinderCase(res: number): TestOutcome {
  const R = 0.1, L = 0.15, seg = 16, bands = 4;
  const engine = new HemicubeEngine(res);
  const built = buildCylinderEnclosure(R, R, L, seg, bands);
  engine.uploadScene(built.scene);
  const { matrix } = engine.computeAll();
  const n = built.scene.patches.length;
  const avg = (rows: number[], cols: number[]) => {
    let s = 0;
    for (const i of rows) for (const j of cols) s += matrix.rows[i * n + j];
    return s / rows.length;
  };
  const F12 = avg(built.bottomIds, built.topIds);
  const F13 = avg(built.bottomIds, built.wallIds);
  const F33 = avg(built.wallIds, built.wallIds);
  const F31 = avg(built.wallIds, built.bottomIds);
  const exact = cylinderEnclosure(R, R, L);
  const err12 = Math.abs(F12 - exact.F[0][1]) / exact.F[0][1];
  const err13 = Math.abs(F13 - exact.F[0][2]) / exact.F[0][2];
  const err33 = Math.abs(F33 - exact.F[2][2]) / exact.F[2][2];
  let maxRowErr = 0;
  for (let i = 0; i < n - 1; i++) maxRowErr = Math.max(maxRowErr, Math.abs(rowSum(matrix.rows, i, n) - 1));
  const lhs = built.areaBottom * F13, rhs = built.areaWall * F31;
  const recipErr = Math.abs(lhs - rhs) / Math.max(1e-12, 0.5 * (Math.abs(lhs) + Math.abs(rhs)));
  engine.dispose();
  return {
    name: `同轴圆筒 HC${res}`,
    pass: Math.max(err12, err13, err33) <= 0.01 && maxRowErr <= 0.01,
    details: {
      F12, F12exact: exact.F[0][1], err12pct: err12 * 100,
      F13, F13exact: exact.F[0][2], err13pct: err13 * 100,
      F33, F33exact: exact.F[2][2], err33pct: err33 * 100,
      maxRowErr, recipErrPct: recipErr * 100, patches: n,
    },
  };
}

function contourCheck(): TestOutcome {
  const fRect = contourViewFactor(rectPoly(0, 0, 0, 0.1, 0.1), rectPoly(0, 0, 0.05, 0.1, 0.1));
  const fRectExact = parallelRectanglesF(0.1, 0.1, 0.05);
  const fDisk = contourViewFactor(diskPoly(0.1, 0, 48), diskPoly(0.1, 0.15, 48));
  const fDiskExact = coaxialDisksF(0.1, 0.1, 0.15);
  const e1 = Math.abs(fRect - fRectExact) / fRectExact;
  const e2 = Math.abs(fDisk - fDiskExact) / fDiskExact;
  return {
    name: '围道积分交叉验证',
    pass: e1 < 0.002 && e2 < 0.01,
    details: {
      fRect, fRectExact, rectErrPct: e1 * 100,
      fDisk, fDiskExact, diskErrPct: e2 * 100,
      diskClosedForm: fDiskExact,
    },
  };
}

async function main() {
  const outcomes: TestOutcome[] = [];
  try {
    outcomes.push(contourCheck());
    for (const r of [48, 64, 96]) outcomes.push(plateCase(r));
    for (const r of [48, 64, 96]) outcomes.push(cylinderCase(r));
    (window as unknown as { __TEST_RESULT__: unknown }).__TEST_RESULT__ = {
      ok: outcomes.every(o => o.pass),
      outcomes,
      ua: navigator.userAgent,
    };
  } catch (e) {
    (window as unknown as { __TEST_RESULT__: unknown }).__TEST_RESULT__ = {
      ok: false, error: String((e as Error).stack || e), outcomes,
    };
  }
}

main();
