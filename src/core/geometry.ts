// 参数化几何生成:叶片(榫头/缘板/叶身 loft)、选晶器、引晶段、模壳外表面、炉体
// 局部坐标系:z 向上,原点在引晶段底面(底盘顶面)
import type { BladeDef, FurnaceDef, Mesh, Vec3 } from './types';
import { v3, mat4RotationY, mat4RotationZ, mat4Multiply, mat4Translation, clamp } from './math';

export interface LocalPatch {
  id: number;
  part: 'starter' | 'selector' | 'tenon' | 'platform' | 'airfoil' | 'cap';
  band: number;
  sector: number;
  centroid: Vec3;
  normal: Vec3;
  area: number;
}

export interface GeneratedBlade {
  displayMesh: Mesh;          // 合金/蜡模外形
  shellMesh: Mesh;            // 模壳外表面(triPatch 与 patches 对齐)
  patches: LocalPatch[];      // 局部坐标面片
  shellThickness: number;
  height: number;             // 总高
  airfoilZ0: number;
  airfoilHeight: number;
  bandZs: number[];           // 叶身各 band 中心高度(局部)
  boundRadius: number;        // 模壳最大外接半径(碰撞检测用)
}

class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];
  triPatch: number[] = [];
  patchId = 0;

  vertex(p: Vec3, n: Vec3) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    return this.pos.length / 3 - 1;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, nrm: Vec3, patch: LocalPatch[]) {
    const pid = this.patchId++;
    const cen: Vec3 = [
      (a[0] + b[0] + c[0] + d[0]) / 4,
      (a[1] + b[1] + c[1] + d[1]) / 4,
      (a[2] + b[2] + c[2] + d[2]) / 4,
    ];
    const e1 = v3.sub(b, a), e2 = v3.sub(d, a);
    const n = v3.norm(v3.cross(e1, e2));
    // 调用者给的 nrm 是朝外的稳健法线
    void n;
    const area = v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2 +
      v3.len(v3.cross(v3.sub(c, a), v3.sub(d, a))) / 2;
    patch.push({ id: pid, part: 'airfoil', band: 0, sector: 0, centroid: cen, normal: nrm, area });
    const i0 = this.vertex(a, nrm), i1 = this.vertex(b, nrm), i2 = this.vertex(c, nrm), i3 = this.vertex(d, nrm);
    this.idx.push(i0, i1, i2, i0, i2, i3);
    this.triPatch.push(pid, pid);
    return pid;
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      indices: new Uint32Array(this.idx),
      triPatch: new Uint32Array(this.triPatch),
    };
  }
}

/** NACA 对称厚度 + 圆弧弯度的闭合截面,返回 M 个点(偶数),x 弦向,y 厚度向 */
export function airfoilSection(chord: number, thick: number, camber: number, m: number): Vec3[] {
  const half = m / 2;
  const pts: Vec3[] = [];
  const naca = (u: number) =>
    5 * thick * (0.2969 * Math.sqrt(u) - 0.1260 * u - 0.3516 * u * u +
      0.2843 * u ** 3 - 0.1015 * u ** 4);
  const cam = (u: number) => {
    if (camber <= 0) return 0;
    const p = 0.4;
    return u < p
      ? (camber * chord * (2 * p * u - u * u)) / (p * p)
      : (camber * chord * ((1 - 2 * p) + 2 * p * u - u * u)) / ((1 - p) * (1 - p));
  };
  for (let i = 0; i <= half; i++) {
    const u = i / half;
    pts.push([(u - 0.5) * chord, naca(u) + cam(u), 0]);
  }
  for (let i = half - 1; i >= 1; i--) {
    const u = i / half;
    pts.push([(u - 0.5) * chord, -naca(u) + cam(u), 0]);
  }
  return pts;
}

function ringNormals(ring: Vec3[]): Vec3[] {
  // 截面平面内的外法线:相邻边叉积 z 轴取反方向
  const m = ring.length;
  return ring.map((p, i) => {
    const prev = ring[(i - 1 + m) % m], next = ring[(i + 1) % m];
    const tan = v3.norm(v3.sub(next, prev));
    let n = v3.norm(v3.cross(tan, [0, 0, 1]));
    // 保证朝外:点乘 中心->p 方向
    const radial: Vec3 = [p[0], p[1], 0];
    if (v3.dot(n, radial) < 0) n = v3.scale(n, -1);
    return n;
  });
}

function twistSection(ring: Vec3[], ang: number): Vec3[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return ring.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]] as Vec3);
}

/** 沿 z 轴 loft 若干环,生成四边面片;返回 zBase 用于 band 编号 */
function loftRings(b: MeshBuilder, rings: Vec3[][], zs: number[], part: LocalPatch['part'],
  bandOffset: number, patches: LocalPatch[], capBottom = false, capTop = false): number {
  const m = rings[0].length;
  for (let k = 0; k < rings.length - 1; k++) {
    const nr0 = ringNormals(rings[k]);
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const pid = b.quad(rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j], nr0[j], patches);
      patches[pid].part = part;
      patches[pid].band = bandOffset + k;
      patches[pid].sector = j;
    }
  }
  const lastBand = bandOffset + rings.length - 2;
  if (capBottom) capRing(b, rings[0], zs[0], -1, part, lastBand, patches);
  if (capTop) capRing(b, rings[rings.length - 1], zs[zs.length - 1], 1, part, lastBand, patches);
  return bandOffset + rings.length - 1;
}

function capRing(b: MeshBuilder, ring: Vec3[], z: number, dir: 1 | -1,
  part: LocalPatch['part'], band: number, patches: LocalPatch[]) {
  const center: Vec3 = [0, 0, z];
  const n: Vec3 = [0, 0, dir];
  for (let j = 0; j < ring.length; j++) {
    const j2 = (j + 1) % ring.length;
    const a = dir > 0 ? center : center;
    const p1 = dir > 0 ? ring[j] : ring[j2];
    const p2 = dir > 0 ? ring[j2] : ring[j];
    const pid = b.quad(a, p1, p2, a, n, patches);
    patches[pid].part = 'cap';
    patches[pid].band = band;
    patches[pid].sector = j;
  }
}

/** 圆管/棱柱沿路径扫掠(选晶器螺旋/折线用) */
function tubeAlongPath(b: MeshBuilder, path: Vec3[], radius: number, sides: number,
  part: LocalPatch['part'], bandOffset: number, patches: LocalPatch[]) {
  const rings: Vec3[][] = path.map((p, k) => {
    const tan = k === 0 ? v3.norm(v3.sub(path[1], p))
      : k === path.length - 1 ? v3.norm(v3.sub(p, path[k - 1]))
        : v3.norm(v3.sub(path[k + 1], path[k - 1]));
    const ref: Vec3 = Math.abs(tan[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = v3.norm(v3.cross(tan, ref)), w = v3.cross(u, tan);
    const ring: Vec3[] = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      ring.push(v3.add(p, v3.add(v3.scale(u, Math.cos(a) * radius), v3.scale(w, Math.sin(a) * radius))));
    }
    return ring;
  });
  const zs = path.map(p => p[2]);
  return loftRings(b, rings, zs, part, bandOffset, patches, true, true);
}

function boxRings(cx: number, cy: number, w: number, d: number, z0: number, z1: number): { rings: Vec3[][]; zs: number[] } {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const mk = (z: number): Vec3[] => c.map(([sx, sy]) => [cx + sx * w / 2, cy + sy * d / 2, z]);
  return { rings: [mk(z0), mk(z1)], zs: [z0, z1] };
}

function cylRings(r: number, sides: number, z0: number, z1: number): { rings: Vec3[][]; zs: number[] } {
  const mk = (z: number): Vec3[] => {
    const ring: Vec3[] = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      ring.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    return ring;
  };
  return { rings: [mk(z0), mk(z1)], zs: [z0, z1] };
}

export function generateBlade(def: BladeDef): GeneratedBlade {
  const b = new MeshBuilder();
  const patches: LocalPatch[] = [];
  const sides = Math.max(8, def.airfoil.sectors);
  let bandOffset = 0;
  let z = 0;

  // 1. 引晶段
  const h0 = z;
  if (def.starter.kind === 'cylinder') {
    const r = def.starter.radius ?? 0.012;
    const c = cylRings(r, sides, z, z + def.starter.height);
    bandOffset = loftRings(b, c.rings, c.zs, 'starter', bandOffset, patches, true, false);
  } else {
    const w = def.starter.width ?? 0.02;
    const c = boxRings(0, 0, w, w, z, z + def.starter.height);
    bandOffset = loftRings(b, c.rings, c.zs, 'starter', bandOffset, patches, true, false);
  }
  z += def.starter.height;

  // 2. 选晶器
  const sp = def.selector;
  const tubeR = sp.tubeRadius ?? 0.006;
  if (sp.kind === 'spiral') {
    const turns = sp.turns ?? 1.5, rad = sp.radius ?? 0.02;
    const steps = Math.max(16, Math.round(turns * 20));
    const path: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, a = u * turns * Math.PI * 2;
      path.push([rad * Math.cos(a), rad * Math.sin(a), z + u * sp.height]);
    }
    bandOffset = tubeAlongPath(b, path, tubeR, sides, 'selector', bandOffset, patches);
  } else if (sp.kind === 'zigzag') {
    const n = sp.zigCount ?? 3, w = sp.width ?? 0.03;
    const path: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      path.push([(i % 2 ? 1 : -1) * w / 2, 0, z + u * sp.height]);
    }
    bandOffset = tubeAlongPath(b, path, tubeR, sides, 'selector', bandOffset, patches);
  } else {
    const w = sp.width ?? 0.02;
    const c = boxRings(0, 0, w, w, z, z + sp.height);
    bandOffset = loftRings(b, c.rings, c.zs, 'selector', bandOffset, patches, false, true);
  }
  z += sp.height;

  // 3. 榫头(收缩方锥 + 锯齿视觉凸起)
  const t0 = z;
  const ten = def.tenon;
  {
    const nSeg = 4;
    const rings: Vec3[][] = [];
    const zs: number[] = [];
    for (let k = 0; k <= nSeg; k++) {
      const u = k / nSeg;
      const shrink = 1 - u * ten.taper;
      const serr = 1 + (ten.serrations > 0 && k > 0 && k < nSeg ? 0.06 * Math.sin(u * ten.serrations * Math.PI * 2) : 0);
      const zz = t0 + u * ten.length;
      rings.push([
        [-ten.width / 2 * shrink * serr, -ten.thickness / 2 * shrink, zz],
        [ten.width / 2 * shrink * serr, -ten.thickness / 2 * shrink, zz],
        [ten.width / 2 * shrink * serr, ten.thickness / 2 * shrink, zz],
        [-ten.width / 2 * shrink * serr, ten.thickness / 2 * shrink, zz],
      ]);
      zs.push(zz);
    }
    bandOffset = loftRings(b, rings, zs, 'tenon', bandOffset, patches, false, false);
    z += ten.length;
  }

  // 4. 缘板
  {
    const pf = def.platform;
    const c = boxRings(0, 0, pf.chord, pf.width, z, z + pf.thickness);
    bandOffset = loftRings(b, c.rings, c.zs, 'platform', bandOffset, patches, false, false);
    z += pf.thickness;
  }

  // 5. 叶身 loft
  const airfoilZ0 = z;
  const af = def.airfoil;
  const bandZs: number[] = [];
  {
    const rings: Vec3[][] = [];
    const zs: number[] = [];
    const B = af.bands;
    for (let k = 0; k <= B; k++) {
      const u = k / B;
      const chord = af.chordRoot + (af.chordTip - af.chordRoot) * u;
      const th = af.thicknessRoot + (af.thicknessTip - af.thicknessRoot) * u;
      const tw = af.twistRoot + (af.twistTip - af.twistRoot) * u;
      const ring = twistSection(airfoilSection(chord, th, af.camber, sides), tw)
        .map(p => [p[0], p[1], airfoilZ0 + u * af.height] as Vec3);
      rings.push(ring);
      zs.push(airfoilZ0 + u * af.height);
      if (k < B) bandZs.push(airfoilZ0 + (u + 0.5 / B) * af.height);
    }
    bandOffset = loftRings(b, rings, zs, 'airfoil', bandOffset, patches, false, true);
    z += af.height;
  }

  const displayMesh = b.build();

  // 6. 模壳外表面:沿顶点法线外扩 shellThickness;底面除外(与底盘接触)
  const shellThickness = def.shell.layers * def.shell.layerThickness;
  const shell = offsetMesh(displayMesh, shellThickness);
  // 修正 shell 面片几何信息(面积/质心/法线随外扩更新)
  const patchesOut = recomputePatches(shell, patches);

  let boundRadius = 0;
  for (let i = 0; i < shell.positions.length; i += 3) {
    boundRadius = Math.max(boundRadius, Math.hypot(shell.positions[i], shell.positions[i + 1]));
  }

  return {
    displayMesh, shellMesh: shell, patches: patchesOut, shellThickness,
    height: z, airfoilZ0, airfoilHeight: af.height, bandZs, boundRadius,
  };
}

/** 沿平滑顶点法线外扩(模壳等厚偏置的离散近似) */
function offsetMesh(mesh: Mesh, dist: number): Mesh {
  const { positions, normals, indices, triPatch } = mesh;
  // 顶点法线平滑:累加相邻面法线
  const vn = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const n = v3.norm(v3.cross(
      v3.sub([positions[b], positions[b + 1], positions[b + 2]], [positions[a], positions[a + 1], positions[a + 2]]),
      v3.sub([positions[c], positions[c + 1], positions[c + 2]], [positions[a], positions[a + 1], positions[a + 2]]),
    ));
    for (const o of [a, b, c]) { vn[o] += n[0]; vn[o + 1] += n[1]; vn[o + 2] += n[2]; }
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const n = v3.norm([vn[i], vn[i + 1], vn[i + 2]]);
    // 底面(z≈0 的点)不外扩
    const isBottom = positions[i + 2] <= 1e-9;
    const d = isBottom ? 0 : dist;
    out[i] = positions[i] + n[0] * d;
    out[i + 1] = positions[i + 1] + n[1] * d;
    out[i + 2] = positions[i + 2] + n[2] * d;
  }
  return { positions: out, normals: normals.slice(), indices: indices.slice(), triPatch: triPatch ? triPatch.slice() : undefined };
}

function recomputePatches(mesh: Mesh, base: LocalPatch[]): LocalPatch[] {
  const out = base.map(p => ({ ...p }));
  const acc = new Map<number, { area: number; cen: Vec3; n: Vec3 }>();
  const { positions, indices, triPatch } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const pid = triPatch ? triPatch[i / 3] : i / 3;
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const A: Vec3 = [positions[ia], positions[ia + 1], positions[ia + 2]];
    const B: Vec3 = [positions[ib], positions[ib + 1], positions[ib + 2]];
    const C: Vec3 = [positions[ic], positions[ic + 1], positions[ic + 2]];
    const cr = v3.cross(v3.sub(B, A), v3.sub(C, A));
    const area = v3.len(cr) / 2;
    const cen = v3.scale(v3.add(A, v3.add(B, C)), 1 / 3);
    const cur = acc.get(pid) ?? { area: 0, cen: [0, 0, 0] as Vec3, n: [0, 0, 0] as Vec3 };
    cur.area += area;
    cur.cen = v3.add(cur.cen, v3.scale(cen, area));
    cur.n = v3.add(cur.n, cr);
    acc.set(pid, cur);
  }
  for (const [pid, v] of acc) {
    const p = out[pid];
    if (!p) continue;
    p.area = v.area;
    p.centroid = v3.scale(v.cen, 1 / v.area);
    p.normal = v3.norm(v.n);
  }
  return out;
}

// ---------- 炉体几何 ----------

export interface FurnaceGeometry {
  mesh: Mesh;
  patches: LocalPatch[];      // 面片 kind 由调用方按 id 区间标注
  ranges: {
    heater: { idBase: number; count: number; zone: number }[];
    baffle: { idBase: number; count: number };
    chill: { idBase: number; count: number };
    wall: { idBase: number; count: number };
  };
}

function cylWallRings(rIn: number, rOut: number, seg: number, z0: number, z1: number, inward = false) {
  const mk = (r: number, z: number): Vec3[] => {
    const ring: Vec3[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    return ring;
  };
  return { rings: [mk(rIn, z0), mk(rIn, z1)], zs: [z0, z1], ringsOut: [mk(rOut, z0), mk(rOut, z1)] };
}

/** 圆环面(挡板)面片:annulus 在 z 平面,厚度沿 z */
function annulusPatches(b: MeshBuilder, rIn: number, rOut: number, seg: number,
  zLow: number, zHigh: number, patches: LocalPatch[], idNote: string): number {
  void idNote;
  const start = b.patchId;
  const mk = (r: number, z: number): Vec3[] => {
    const ring: Vec3[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    return ring;
  };
  // 上下面
  for (const [z, dir] of [[zHigh, 1], [zLow, -1]] as [number, number][]) {
    const ri = mk(rIn, z), ro = mk(rOut, z);
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const n: Vec3 = [0, 0, dir];
      if (dir > 0) b.quad(ri[j], ri[j2], ro[j2], ro[j], n, patches);
      else b.quad(ro[j], ro[j2], ri[j2], ri[j], n, patches);
    }
  }
  // 内外圆柱面
  const zs = [zLow, zHigh];
  for (const [r, inward] of [[rOut, false], [rIn, true]] as [number, boolean][]) {
    const ring = mk(r, zLow), ring2 = mk(r, zHigh);
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = (j + 0.5) / seg * Math.PI * 2;
      const n: Vec3 = inward ? [-Math.cos(a), -Math.sin(a), 0] : [Math.cos(a), Math.sin(a), 0];
      b.quad(ring[j], ring2[j], ring2[j2], ring[j2], n, patches);
    }
  }
  void zs;
  return b.patchId - start;
}

export function generateFurnace(f: FurnaceDef): FurnaceGeometry {
  const b = new MeshBuilder();
  const patches: LocalPatch[] = [];
  const ranges = {
    heater: [] as { idBase: number; count: number; zone: number }[],
    baffle: { idBase: 0, count: 0 },
    chill: { idBase: 0, count: 0 },
    wall: { idBase: 0, count: 0 },
  };

  // 加热区:内圆柱面(法线朝内),分段×分带
  for (let zi = 0; zi < f.zones.length; zi++) {
    const zc = f.zones[zi];
    const idBase = b.patchId;
    const seg = zc.segments, bands = zc.bands;
    for (let k = 0; k < bands; k++) {
      const z0 = zc.zCenter - zc.height / 2 + (k / bands) * zc.height;
      const z1 = zc.zCenter - zc.height / 2 + ((k + 1) / bands) * zc.height;
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const n: Vec3 = [-Math.cos(am), -Math.sin(am), 0];
        const p = (r: number, a: number, z: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), z];
        b.quad(p(zc.radius, a0, z0), p(zc.radius, a1, z0), p(zc.radius, a1, z1), p(zc.radius, a0, z1), n, patches);
      }
    }
    ranges.heater.push({ idBase, count: b.patchId - idBase, zone: zi });
  }

  // 水冷结晶器:顶面圆盘(分扇区)+ 侧面
  ranges.chill = { idBase: b.patchId, count: 0 };
  {
    const seg = 24, r = f.chillRadius;
    const center = (z: number): Vec3 => [0, 0, z];
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      b.quad(center(0), [r * Math.cos(a0), r * Math.sin(a0), 0],
        [r * Math.cos(a1), r * Math.sin(a1), 0], center(0), [0, 0, 1], patches);
    }
    const h = 0.04;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      b.quad([r * Math.cos(a0), r * Math.sin(a0), 0], [r * Math.cos(a0), r * Math.sin(a0), -h],
        [r * Math.cos(a1), r * Math.sin(a1), -h], [r * Math.cos(a1), r * Math.sin(a1), 0],
        [Math.cos(am), Math.sin(am), 0], patches);
    }
    ranges.chill.count = b.patchId - ranges.chill.idBase;
  }

  // 隔热挡板(带开孔的圆环)
  ranges.baffle = { idBase: b.patchId, count: 0 };
  ranges.baffle.count = annulusPatches(b, f.baffleOpeningRadius, f.wallRadius * 0.98,
    32, f.baffleZ - f.baffleThickness / 2, f.baffleZ + f.baffleThickness / 2, patches, 'baffle');

  // 外壁:圆筒内表面 + 顶盖
  ranges.wall = { idBase: b.patchId, count: 0 };
  {
    const seg = 32, bands = 6, r = f.wallRadius;
    for (let k = 0; k < bands; k++) {
      const z0 = (k / bands) * f.wallHeight, z1 = ((k + 1) / bands) * f.wallHeight;
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const n: Vec3 = [-Math.cos(am), -Math.sin(am), 0];
        const p = (a: number, z: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), z];
        b.quad(p(a0, z0), p(a0, z1), p(a1, z1), p(a1, z0), n, patches);
      }
    }
    // 顶盖(朝下)
    const z = f.wallHeight;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      b.quad([0, 0, z], [r * Math.cos(a1), r * Math.sin(a1), z],
        [r * Math.cos(a0), r * Math.sin(a0), z], [0, 0, z], [0, 0, -1], patches);
    }
    ranges.wall.count = b.patchId - ranges.wall.idBase;
  }

  return { mesh: b.build(), patches, ranges };
}

/** 实例世界变换:极坐标排布 + yaw(绕自身轴)+ tilt 倾斜 */
export function instanceTransform(rad: number, az: number, yaw: number, tilt: number, tiltDir: number): Float32Array {
  const t = mat4Translation(rad * Math.cos(az), rad * Math.sin(az), 0);
  const rz = mat4RotationZ(az);                 // 局部 -Y 朝炉心
  const ry = mat4RotationY(yaw);               // 自身朝向
  // 倾角:绕 tiltDir 水平轴
  const tiltAxis = mat4RotationZ(tiltDir);
  const tiltRot = mat4Multiply(tiltAxis, mat4RotationY(tilt));
  return mat4Multiply(mat4Multiply(t, rz), mat4Multiply(ry, tiltRot));
}

export function transformPoint(m: Float32Array, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function transformDir(m: Float32Array, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return v3.norm([
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ]);
}

// ---------- STL 解析(二进制/ASCII) ----------

export function parseSTL(buf: ArrayBuffer): Mesh {
  const bytes = new Uint8Array(buf);
  const isAscii = bytes.length > 5 && new TextDecoder().decode(bytes.slice(0, 5)) === 'solid' &&
    !looksBinary(bytes);
  if (isAscii) return parseASCII(new TextDecoder().decode(bytes));
  return parseBinary(buf);
}

function looksBinary(b: Uint8Array): boolean {
  if (b.length < 84) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(80, true);
  return 84 + n * 50 === b.length;
}

function parseBinary(buf: ArrayBuffer): Mesh {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  let off = 84;
  for (let i = 0; i < n; i++) {
    const nx = dv.getFloat32(off + 0, true), ny = dv.getFloat32(off + 4, true), nz = dv.getFloat32(off + 8, true);
    off += 12;
    const base = pos.length / 3;
    for (let k = 0; k < 3; k++) {
      pos.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true));
      nrm.push(nx, ny, nz);
      off += 12;
      idx.push(base + k);
    }
    off += 2;
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

function parseASCII(text: string): Mesh {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const vertRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const normRe = /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/;
  for (const line of text.split('\n')) {
    const vm = line.match(vertRe);
    if (vm) {
      idx.push(pos.length / 3);
      pos.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]));
      const nm = line.match(normRe);
      if (nm) nrm.push(parseFloat(nm[1]), parseFloat(nm[2]), parseFloat(nm[3]));
      else nrm.push(0, 1, 0);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/** 把导入 STL 归一化到叶身局部坐标系:底面落到 z0,缩放到目标高度 */
export function normalizeSTLMesh(mesh: Mesh, targetHeight: number, z0: number): Mesh {
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minZ = Math.min(minZ, mesh.positions[i + 2]); maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    minX = Math.min(minX, mesh.positions[i]); maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]); maxY = Math.max(maxY, mesh.positions[i + 1]);
  }
  const h = maxZ - minZ || 1;
  const s = targetHeight / h;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out[i] = (mesh.positions[i] - cx) * s;
    out[i + 1] = (mesh.positions[i + 1] - cy) * s;
    out[i + 2] = (mesh.positions[i + 2] - minZ) * s + z0;
  }
  return { ...mesh, positions: out };
}

