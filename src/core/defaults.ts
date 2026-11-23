// 出厂默认工况:12 片组树(第 7 片故意摆歪)+ 双区加热炉 + 标准抽拉曲线
import type {
  BladeDef, ClusterDef, FurnaceDef, PourRecord, PullCurve,
} from './types';
import { uid } from './math';

export function defaultBlade(): BladeDef {
  return {
    id: 'blade_default_dsx',
    name: 'DS 涡轮叶片(标准件)',
    updatedAt: Date.now(),
    tenon: { length: 0.028, width: 0.034, thickness: 0.014, taper: 0.25, serrations: 3 },
    platform: { chord: 0.062, width: 0.046, thickness: 0.006 },
    airfoil: {
      height: 0.095, chordRoot: 0.048, chordTip: 0.030,
      thicknessRoot: 0.010, thicknessTip: 0.005,
      twistRoot: 0.25, twistTip: 0.55, camber: 0.03,
      bands: 12, sectors: 12,
    },
    selector: { kind: 'spiral', height: 0.028, turns: 1.5, radius: 0.018, tubeRadius: 0.0055 },
    starter: { kind: 'cylinder', height: 0.025, radius: 0.011 },
    shell: {
      layers: 8, layerThickness: 0.0009, conductivity: 2.2,
      emissivity: 0.82, density: 2650, specificHeat: 1050,
    },
    materialConductivity: 28,
    liquidus: 1623,
    solidus: 1553,
  };
}

export function defaultCluster(bladeDefId: string): ClusterDef {
  const N = 12;
  const radius = 0.135;
  const instances = Array.from({ length: N }, (_, i) => {
    const az = (i / N) * Math.PI * 2;
    // 0 yaw = 叶背朝炉心;第 7 片(i=6)摆歪 28°,倾角也带 4°
    const misorient = i === 6;
    return {
      id: uid('inst'),
      bladeDefId,
      radius,
      azimuth: az,
      yaw: misorient ? (28 * Math.PI) / 180 : 0,
      tilt: misorient ? (4 * Math.PI) / 180 : 0,
      tiltDir: az,
    };
  });
  return {
    id: 'cluster_12_demo',
    name: '12 片圆周组树(含 1 片朝向异常)',
    updatedAt: Date.now(),
    chillDiskRadius: 0.18,
    instances,
  };
}

export function defaultFurnace(): FurnaceDef {
  return {
    id: 'furnace_dual_zone',
    name: '双区定向凝固炉(标准)',
    updatedAt: Date.now(),
    wallRadius: 0.26,
    wallHeight: 0.62,
    wallEmissivity: 0.75,
    zones: [
      {
        id: 'zone_low', name: '下加热区',
        zCenter: 0.16, height: 0.16, radius: 0.225,
        temperature: 1733, emissivity: 0.85, segments: 16, bands: 2,
      },
      {
        id: 'zone_high', name: '上加热区',
        zCenter: 0.36, height: 0.20, radius: 0.225,
        temperature: 1793, emissivity: 0.85, segments: 16, bands: 2,
      },
    ],
    baffleZ: 0.085,
    baffleThickness: 0.020,
    baffleOpeningRadius: 0.165,
    baffleEmissivity: 0.70,
    baffleTemp: 900,
    pullGap: 0.012,
    chillRadius: 0.19,
    chillTemp: 423,
    chillEmissivity: 0.65,
    ambientTemp: 1500,
  };
}

export function defaultPullCurve(): PullCurve {
  return {
    id: 'curve_standard',
    name: '标准抽拉曲线(5 mm/min 中段)',
    points: [
      { t: 0, displacement: 0 },
      { t: 120, displacement: 0.004 },
      { t: 600, displacement: 0.040 },
      { t: 1200, displacement: 0.082 },
      { t: 1500, displacement: 0.098 },
      { t: 1680, displacement: 0.105 },
    ],
  };
}

/** 演示浇注记录:12 片报废 4 片,杂晶/雀斑集中在朝炉心面,且包含摆歪的第 7 片 */
export function demoPourRecord(clusterId: string, furnaceId: string, curveId: string): PourRecord {
  const defects = [
    { bladeIndex: 2, heightRatio: 0.35, side: 'inner' as const, type: 'freckle' as const, note: '炉心面雀斑链' },
    { bladeIndex: 5, heightRatio: 0.5, side: 'inner' as const, type: 'stray' as const, note: '缘板上方杂晶' },
    { bladeIndex: 6, heightRatio: 0.42, side: 'inner' as const, type: 'stray' as const, note: '朝向异常片,杂晶起始位置低' },
    { bladeIndex: 6, heightRatio: 0.68, side: 'left' as const, type: 'freckle' as const, note: '雀斑伴生' },
    { bladeIndex: 9, heightRatio: 0.45, side: 'inner' as const, type: 'stray' as const, note: '杂晶' },
  ];
  return {
    id: uid('pour'),
    pourDate: Date.now() - 86400000 * 3,
    furnaceHeatNo: 'DS-20261121-07',
    clusterId, furnaceId, curveId,
    totalBlades: 12,
    scrapped: 4,
    defects,
    macroEtchNote: '宏观腐蚀:4 片报废,缺陷均起于朝炉心面;第 7 片组树时 yaw 偏差约 28°。',
    createdAt: Date.now() - 86400000 * 3,
  };
}

export const DEFAULT_THERMAL = {
  tiltLimitDeg: 12,
  gradientMin: 4000,
  freckleIndexLimit: 6e-10,
  pourTemp: 1773,
};
