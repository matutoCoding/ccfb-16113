// 双向互换诊断:正对两面片 F(i->j) vs F(j->i),及顶面覆盖率
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';

const engine = new HemicubeEngine(96);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const n = built.scene.patches.length;

const i = built.plate1Ids[27]; // 近中心
const j = built.plate2Ids[27]; // 正对
const ri = engine.computeOne(i);
const rj = engine.computeOne(j);

// 板1中心面片看到板2各面片的分布
const toPlate2Entries = built.plate2Ids.map(k => ({ k, f: ri.accum[k] }))
  .filter(x => x.f > 0).sort((a, b) => b.f - a.f);
const totalToPlate2 = toPlate2Entries.reduce((s, x) => s + x.f, 0);
const totalToWalls = built.sideIds.reduce((s, k) => s + ri.accum[k], 0);
const totalToSelf = built.plate1Ids.reduce((s, k) => s + ri.accum[k], 0);

(window as unknown as { __DEBUG6__: unknown }).__DEBUG6__ = {
  i, j,
  Fij: ri.accum[j], Fji: rj.accum[i],
  rowSumI: ri.rowSum, rowSumJ: rj.rowSum,
  totalToPlate2, totalToWalls, totalToSelf,
  ambientI: ri.accum[built.scene.ambientPatchIndex],
  topPlate2Hits: toPlate2Entries.slice(0, 5),
  plate2VisibleCells: toPlate2Entries.length,
  plate2TotalCells: built.plate2Ids.length,
  normals: { i: built.scene.patches[i].normal, j: built.scene.patches[j].normal },
};
