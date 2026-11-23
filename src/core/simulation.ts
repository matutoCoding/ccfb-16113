// 抽拉推演编排:按抽拉曲线分步,每步重建场景 -> 半立方体角系数 -> 热工求解
import type {
  BladeDef, ClusterDef, FurnaceDef, PullCurve, SimulationRun, SimulationStep,
} from './types';
import { HemicubeEngine, type HemicubeOptions } from './hemicube';
import { SceneBuilder } from './scene';
import { samplePullCurve } from './math';
import { buildShellContext, solveThermal, type ThermalParams } from './thermal';
import { uid } from './math';

export interface RunOptions {
  stepCount: number;
  hemicubeRes: number;
  params: ThermalParams;
  shellOnly?: boolean;       // 只对模壳面片计算接收行(加速)
  onStep?: (step: SimulationStep, idx: number, total: number) => void;
  log?: (msg: string) => void;
}

export function runSimulation(
  cluster: ClusterDef,
  blades: BladeDef[],
  furnace: FurnaceDef,
  curve: PullCurve,
  opts: RunOptions,
): SimulationRun {
  const builder = new SceneBuilder(cluster, blades, furnace);
  const engine = new HemicubeEngine(opts.hemicubeRes);
  const tEnd = curve.points[curve.points.length - 1].t;
  const steps: SimulationStep[] = [];

  try {
    for (let s = 0; s < opts.stepCount; s++) {
      const t = (s / Math.max(1, opts.stepCount - 1)) * tEnd;
      const { displacement, speed } = samplePullCurve(curve.points, t);
      const t0 = performance.now();
      const scene = builder.build(displacement);
      engine.uploadScene(scene);
      const filter = opts.shellOnly
        ? (p: { kind: string }) => p.kind === 'shell'
        : undefined;
      const { matrix } = engine.computeAll({
        log: opts.log,
        receiverFilter: filter as HemicubeOptions['receiverFilter'],
      });
      matrix.displacement = displacement;

      const { ctx, map } = buildShellContext(scene.patches, cluster.instances, blades);
      const thermal = solveThermal(matrix, scene.patches, ctx, map, furnace, speed, opts.params);
      const computeMs = performance.now() - t0;
      steps.push({
        index: s, t, displacement, speed,
        viewFactor: matrix,
        blades: thermal.blades,
        computeMs,
      });
      opts.onStep?.(steps[s], s, opts.stepCount);
    }
  } finally {
    engine.dispose();
  }

  return {
    id: uid('sim'),
    name: `推演 ${new Date().toLocaleString('zh-CN')}`,
    createdAt: Date.now(),
    clusterId: cluster.id,
    furnaceId: furnace.id,
    curveId: curve.id,
    hemicubeRes: opts.hemicubeRes,
    stepCount: opts.stepCount,
    steps,
    tiltLimitDeg: opts.params.tiltLimitDeg,
    gradientMin: opts.params.gradientMin,
    freckleIndexLimit: opts.params.freckleIndexLimit,
  };
}

/** 风险改善建议:基于最差叶片朝向与速度敏感性 */
export function advise(run: SimulationStep, cluster: ClusterDef): {
  bladeIndex: number; advice: string;
}[] {
  const out: { bladeIndex: number; advice: string }[] = [];
  const sorted = run.blades
    .map((b, i) => ({ b, i }))
    .sort((x, y) =>
      Math.max(...y.b.risks.map(r => Math.max(r.strayRisk, r.freckleRisk))) -
      Math.max(...x.b.risks.map(r => Math.max(r.strayRisk, r.freckleRisk))));
  for (const { b, i } of sorted.slice(0, 3)) {
    const worst = b.risks.reduce((a, c) =>
      Math.max(c.strayRisk, c.freckleRisk) > Math.max(a.strayRisk, a.freckleRisk) ? c : a);
    const inst = cluster.instances[i];
    const tips: string[] = [];
    if (worst.risk === 'freckle') {
      tips.push(`雀斑风险段位于叶高 ${(worst.z * 1000).toFixed(1)} mm 附近,V/G²=${worst.freckleIndex.toExponential(2)};建议抽拉速度下调 20%~30%(当前 ${(worst.pullSpeed * 1e6).toFixed(0)} μm/s),先做 ${(inst.yaw * 180 / Math.PI + 15).toFixed(0)}° 朝向对比炉次。`);
    } else if (worst.risk === 'stray') {
      tips.push(`杂晶风险段位于叶高 ${(worst.z * 1000).toFixed(1)} mm,界面倾斜 ${worst.tiltDeg.toFixed(1)}°,内外温差 ${worst.innerOuterDeltaT.toFixed(1)} K;建议该叶片 yaw 旋转 10°~20° 使叶背正对炉心方向,或降低抽拉速度并提高上区温度 10~20 K。`);
    } else {
      tips.push(`风险裕度偏低(综合风险 ${Math.max(worst.strayRisk, worst.freckleRisk).toFixed(2)}),建议抽拉速度下调 10% 并复核挡板开孔与模壳间隙。`);
    }
    out.push({ bladeIndex: i, advice: tips[0] });
  }
  return out;
}
