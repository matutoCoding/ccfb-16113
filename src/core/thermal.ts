// 热工求解:辐射网络(灰体迭代) -> 模壳导热 -> 合金柱列一维温度场
// 输出:每片叶片沿高度四列温度、梯度、固液界面倾斜、内外温差、杂晶/雀斑风险
import type {
  BladeDef, BladeInstance, FurnaceDef, PatchInfo, ViewFactorMatrix,
  BladeSimResult, BandThermalState, BandRisk, RiskType,
} from './types';
import { rad2deg, interp1 } from './math';
import { classifyColumn } from './scene';

export const SIGMA = 5.670374419e-8;

export interface ThermalParams {
  tiltLimitDeg: number;
  gradientMin: number;        // K/m
  freckleIndexLimit: number;  // V/G^2 临界 (m·s·K) 量级
  pourTemp: number;
}

interface ShellPatchCtx {
  patch: PatchInfo;
  blade: BladeDef;
  instance: BladeInstance;
  airfoilBand: number;        // -1 表示非叶身
  column: 0 | 1 | 2 | 3;
  eps: number;
}

export interface ThermalResult {
  blades: BladeSimResult[];
  shellHeatFlux: Float32Array; // 与场景 patch 对齐
  irradiation: Float32Array;
}

/** 炉体表面的温度/黑度查表 */
function boundaryTemp(p: PatchInfo, f: FurnaceDef): { t: number; eps: number } {
  switch (p.kind) {
    case 'heater': {
      const z = p.centroid[2];
      const zc = f.zones[p.ownerIndex];
      // 跨带线性近似:用所属区温度(分段界面处按最近区)
      void z;
      return { t: zc.temperature, eps: zc.emissivity };
    }
    case 'baffle': return { t: f.baffleTemp, eps: f.baffleEmissivity };
    case 'chill': return { t: f.chillTemp, eps: f.chillEmissivity };
    case 'wall': return { t: f.ambientTemp, eps: f.wallEmissivity };
    case 'ambient': return { t: f.ambientTemp, eps: 1 };
    default: return { t: f.ambientTemp, eps: 1 };
  }
}

export function solveThermal(
  vf: ViewFactorMatrix,
  patches: PatchInfo[],
  shellCtx: ShellPatchCtx[],
  ctxByPatch: Map<number, ShellPatchCtx>,
  furnace: FurnaceDef,
  speed: number,
  params: ThermalParams,
): ThermalResult {
  const n = patches.length;
  const F = vf.rows;
  const T = new Float32Array(n);
  const eps = new Float32Array(n);
  const isShell = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p = patches[i];
    if (p.kind === 'shell') {
      const ctx = ctxByPatch.get(i)!;
      T[i] = params.pourTemp; // 初值
      eps[i] = ctx.eps;
      isShell[i] = 1;
    } else {
      const b = boundaryTemp(p, furnace);
      T[i] = b.t;
      eps[i] = b.eps;
    }
  }

  // 灰体辐射迭代(只迭代模壳面片温度,炉体边界恒定)
  const Eb = (t: number) => SIGMA * t ** 4;
  const J = new Float32Array(n);
  for (let i = 0; i < n; i++) J[i] = Eb(T[i]);
  const irradiation = new Float32Array(n);

  for (let iter = 0; iter < 6; iter++) {
    // G_i = Σ F_ij J_j
    for (let i = 0; i < n; i++) {
      if (!isShell[i]) continue;
      let g = 0;
      const base = i * n;
      for (let j = 0; j < n; j++) g += F[base + j] * J[j];
      irradiation[i] = g;
    }
    // 模壳表面能量平衡:辐射净热流 = 向合金侧导热(用显式松弛)
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      if (!isShell[i]) continue;
      const ctx = ctxByPatch.get(i)!;
      const shell = ctx.blade.shell;
      const hCond = shell.conductivity / Math.max(shell.layers * shell.layerThickness, 1e-4);
      const TmetalGuess = T[i] - 80; // 合金侧略冷
      const qCond = hCond * (T[i] - TmetalGuess);
      // q_rad_net = (J - G); J = eps Eb(T) + (1-eps) G
      const G = irradiation[i];
      const Jnew = eps[i] * Eb(T[i]) + (1 - eps[i]) * G;
      const qRad = Jnew - G;
      // 平衡:qRad = qCond -> 修正 T
      const resid = qRad - qCond;
      const dT = resid / (4 * eps[i] * SIGMA * T[i] ** 3 + hCond + 1e-9);
      const Tnew = Math.max(furnace.chillTemp, T[i] - 0.6 * dT);
      maxDelta = Math.max(maxDelta, Math.abs(Tnew - T[i]));
      T[i] = Tnew;
      J[i] = eps[i] * Eb(T[i]) + (1 - eps[i]) * G;
    }
    if (maxDelta < 0.5) break;
  }

  const shellHeatFlux = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (isShell[i]) shellHeatFlux[i] = J[i] - irradiation[i];
  }

  // ---------- 按叶片聚合:叶身 band × 4 列(ownerIndex = 叶片序号) ----------
  const bladeMap = new Map<number, {
    bandColT: number[][]; bandColShell: number[][]; bandColIrr: number[][]; zs: number[];
    bladeDef: BladeDef; instance: BladeInstance;
  }>();
  for (const ctx of shellCtx) {
    if (ctx.airfoilBand < 0) continue;
    const bi = ctx.patch.ownerIndex;
    let entry = bladeMap.get(bi);
    if (!entry) {
      const B = ctx.blade.airfoil.bands;
      entry = {
        bandColT: Array.from({ length: B }, () => [0, 0, 0, 0]),
        bandColShell: Array.from({ length: B }, () => [0, 0, 0, 0]),
        bandColIrr: Array.from({ length: B }, () => [0, 0, 0, 0]),
        zs: [],
        bladeDef: ctx.blade,
        instance: ctx.instance,
      };
      bladeMap.set(bi, entry);
    }
    const b = ctx.airfoilBand, c = ctx.column;
    entry.bandColShell[b][c] = T[ctx.patch.surfaceId];
    entry.bandColIrr[b][c] = (irradiation[ctx.patch.surfaceId] / SIGMA) ** 0.25;
  }

  const bladeResults: BladeSimResult[] = [];
  for (const [bi, entry] of bladeMap) {
    void bi;
    const res = solveBlade(entry, speed, params, furnace);
    bladeResults.push(res);
  }
  bladeResults.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return { blades: bladeResults, shellHeatFlux, irradiation };
}

function solveBlade(
  entry: {
    bandColT: number[][]; bandColShell: number[][]; bandColIrr: number[][]; zs: number[];
    bladeDef: BladeDef; instance: BladeInstance;
  },
  speed: number,
  params: ThermalParams,
  furnace: FurnaceDef,
): BladeSimResult {
  const def = entry.bladeDef;
  const B = def.airfoil.bands;
  const H = def.airfoil.height;
  const dz = H / B;
  const z0 = 0; // band 局部高度由 bandZs 给出,这里用相对值
  void z0;

  // 每列解一维稳态导热:d/dz(k dT/dz) + 径向冷却项 = 0
  // 径向项由模壳辐射温度驱动:q_rad = hR (T_shell - T)
  const k = def.materialConductivity;
  const shell = def.shell;
  const hShell = shell.conductivity / Math.max(shell.layers * shell.layerThickness, 1e-4);
  const hRadEff = 4 * SIGMA * eps_eff(shell.emissivity) * params.pourTemp ** 3;
  const h = hShell * hRadEff / (hShell + hRadEff); // 串联等效换热系数
  // 特征尺度:叶身厚度
  const Lc = Math.max(def.airfoil.thicknessRoot, 1e-3);

  const bands: BandThermalState[] = [];
  const colTemp: number[][] = [[], [], [], []];

  for (let c = 0; c < 4; c++) {
    const a: number[] = [], b: number[] = [], d: number[] = [], rhs: number[] = [];
    for (let i = 0; i < B; i++) {
      const Tshell = entry.bandColShell[i][c] || params.pourTemp;
      const alpha = (h / Lc) / (k / (dz * dz));
      a.push(1);
      b.push(-(2 + alpha));
      d.push(1);
      rhs.push(-alpha * Tshell);
    }
    // 边界:底部 z=0 接结晶器 T_chill;顶部 Neumann=0(绝热,热量已由径向项表达)
    b[0] = 1; d[0] = 0; rhs[0] = furnace.chillTemp + 60;
    a[B - 1] = -1; b[B - 1] = 1; rhs[B - 1] = 0;
    const T = thomas(a, b, d, rhs);
    for (let i = 0; i < B; i++) colTemp[c][i] = T[i];
  }

  for (let i = 0; i < B; i++) {
    const z = (i + 0.5) * dz;
    const g: [number, number, number, number] = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const up = i + 1 < B ? colTemp[c][i + 1] : colTemp[c][B - 1];
      const dn = i > 0 ? colTemp[c][i - 1] : furnace.chillTemp + 60;
      g[c] = Math.abs((up - dn) / (2 * dz));
    }
    bands.push({
      z,
      colTemp: [colTemp[0][i], colTemp[1][i], colTemp[2][i], colTemp[3][i]],
      colShellTemp: [
        entry.bandColShell[i][0], entry.bandColShell[i][1],
        entry.bandColShell[i][2], entry.bandColShell[i][3],
      ],
      gradient: g,
      irrTemp: [
        entry.bandColIrr[i][0], entry.bandColIrr[i][1],
        entry.bandColIrr[i][2], entry.bandColIrr[i][3],
      ],
    });
  }

  // ---------- 固液界面:液相线等高面 ----------
  const Tliq = def.liquidus;
  const interfaceZ: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    interfaceZ[c] = findLevel(colTemp[c], dz, Tliq);
  }
  const zMin = Math.min(...interfaceZ), zMax = Math.max(...interfaceZ);
  // 倾斜角:界面高差 / 叶身宽度
  const width = Math.max(def.airfoil.chordRoot, 1e-3);
  const maxTilt = Math.atan2(zMax - zMin, width);

  // ---------- 风险 ----------
  const risks: BandRisk[] = [];
  let maxDeltaT = 0, worstBand = 0;
  for (let i = 0; i < B; i++) {
    const inner = colTemp[0][i], outer = colTemp[1][i];
    const deltaT = Math.abs(inner - outer);
    if (deltaT > maxDeltaT) { maxDeltaT = deltaT; worstBand = i; }
    const gMin = Math.min(...bands[i].gradient);
    const gAvg = bands[i].gradient.reduce((s, x) => s + x, 0) / 4;
    // 界面在本 band 附近时用界面倾斜,否则用局部温差折算
    const z = bands[i].z;
    const nearIface = Math.abs(z - (zMin + zMax) / 2) < dz;
    const tiltDeg = nearIface ? rad2deg(maxTilt)
      : rad2deg(Math.atan2(deltaT * dz / width * 4, width));
    // 雀斑指标 V/G^2(取平均 G)
    const freckleIndex = speed / Math.max(gAvg, 1) ** 2;
    const strayRisk = clamp01(
      0.6 * Math.max(0, tiltDeg / params.tiltLimitDeg - 0.7) / 0.3 +
      0.4 * Math.max(0, params.gradientMin / Math.max(gMin, 1) - 0.7) / 0.3);
    const freckleRisk = clamp01(Math.max(0,
      freckleIndex / params.freckleIndexLimit - 0.7) / 0.3);
    let risk: RiskType = 'none';
    if (freckleRisk >= 0.5) risk = 'freckle';
    else if (strayRisk >= 0.5) risk = 'stray';
    risks.push({
      band: i, z, tiltDeg, innerOuterDeltaT: deltaT, minGradient: gMin,
      pullSpeed: speed, freckleIndex, strayRisk, freckleRisk, risk,
    });
  }

  return {
    instanceId: entry.instance.id,
    bands,
    risks,
    maxInnerOuterDeltaT: maxDeltaT,
    maxTiltDeg: rad2deg(maxTilt),
    worstBand,
  };
}

function eps_eff(eps: number): number {
  return eps / (2 - eps);
}

function thomas(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = b.length;
  const cp = new Array(n), dp = new Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = i < n - 1 ? c[i] / m : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

function findLevel(T: number[], dz: number, level: number): number {
  for (let i = 0; i < T.length - 1; i++) {
    if ((T[i] - level) * (T[i + 1] - level) <= 0) {
      const u = (level - T[i]) / (T[i + 1] - T[i] || 1e-9);
      return (i + u) * dz;
    }
  }
  return T[0] > level ? (T.length - 1) * dz : 0;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 把场景 patches 与叶片上下文关联起来 */
export function buildShellContext(
  patches: PatchInfo[],
  instances: BladeInstance[],
  blades: BladeDef[],
): { ctx: ShellPatchCtx[]; map: Map<number, ShellPatchCtx> } {
  const ctx: ShellPatchCtx[] = [];
  const map = new Map<number, ShellPatchCtx>();
  for (const p of patches) {
    if (p.kind !== 'shell') continue;
    const inst = instances[p.ownerIndex];
    const def = blades.find(b => b.id === inst.bladeDefId)!;
    const column = classifyColumn(p.normal, inst.azimuth);
    const c: ShellPatchCtx = {
      patch: p, blade: def, instance: inst,
      airfoilBand: p.part === 'airfoil' ? p.band : -1,
      column, eps: def.shell.emissivity,
    };
    ctx.push(c);
    map.set(p.surfaceId, c);
  }
  return { ctx, map };
}

export { interp1 };
