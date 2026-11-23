// 直接测引擎 computeOne:不同位置接收面片的行和与板间 F
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';
import { parallelRectanglesF } from '../src/core/reference';

const engine = new HemicubeEngine(64);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const n = built.scene.patches.length;

const probe = (ri: number) => {
  const r = engine.computeOne(ri);
  let toPlate2 = 0;
  for (const j of built.plate2Ids) toPlate2 += r.accum[j];
  return { ri, rowSum: r.rowSum, toPlate2, nonzero: r.accum.filter(v => v > 0).length };
};

const results = [
  probe(built.plate1Ids[0]),   // 角
  probe(built.plate1Ids[27]),  // 近中心
  probe(built.plate1Ids[9]),   // 边中
];
// 解析:整板 F=0.4153
(window as unknown as { __DEBUG5__: unknown }).__DEBUG5__ = {
  results,
  exactWholePlate: parallelRectanglesF(0.1, 0.1, 0.05),
  plate1Count: built.plate1Ids.length,
};
