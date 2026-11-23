// 角系数解析/高精度参考解:用于半立方体法验收
// 1) 平行等大矩形闭式解  2) 同轴平行圆盘闭式解  3) 同轴圆筒腔三表面完整矩阵
// 4) Walton 围道二重积分(任意平面多边形,自适应 Gauss-Legendre)
import type { Vec3 } from './types';
import { v3 } from './math';

// ---------- Gauss-Legendre 节点 ----------

const GL5: [number, number][] = [
  [-0.906179845938664, 0.236926885056189],
  [-0.538469310105683, 0.478628670499366],
  [0, 0.568888888888889],
  [0.538469310105683, 0.478628670499366],
  [0.906179845938664, 0.236926885056189],
];

const GL3: [number, number][] = [
  [-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9],
];

// ---------- 平行等大正对矩形(边长 a、b,间距 c) ----------

export function parallelRectanglesF(a: number, b: number, c: number): number {
  const X = a / c, Y = b / c;
  const ln = Math.log;
  const val =
    0.5 * ln(((1 + X * X) * (1 + Y * Y)) / (1 + X * X + Y * Y))
    + X * Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y))
    + Y * Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X))
    - X * Math.atan(X) - Y * Math.atan(Y);
  return (2 / (Math.PI * X * Y)) * val;
}

// ---------- 同轴平行圆盘(半径 r1、r2,间距 L) ----------

export function coaxialDisksF(r1: number, r2: number, L: number): number {
  const R1 = r1 / L, R2 = r2 / L;
  const X = 1 + (1 + R2 * R2) / (R1 * R1);
  return 0.5 * (X - Math.sqrt(X * X - 4 * (R2 / R1) * (R2 / R1)));
}

// ---------- 同轴圆筒腔:底盘 1 / 顶盘 2 / 筒壁 3 ----------

export interface CylinderEnclosure {
  areas: [number, number, number];
  /** F[i][j],i 为发射面 */
  F: number[][];
}

export function cylinderEnclosure(rBottom: number, rTop: number, L: number): CylinderEnclosure {
  const A1 = Math.PI * rBottom * rBottom;
  const A2 = Math.PI * rTop * rTop;
  const A3 = Math.PI * (rBottom + rTop) * L;
  const F12 = coaxialDisksF(rBottom, rTop, L);
  const F13 = 1 - F12;
  const F21 = (A1 * F12) / A2;
  const F23 = 1 - F21;
  const F31 = (A1 * F13) / A3;
  const F32 = (A2 * F23) / A3;
  const F33 = 1 - F31 - F32;
  return {
    areas: [A1, A2, A3],
    F: [
      [0, F12, F13],
      [F21, 0, F23],
      [F31, F32, F33],
    ],
  };
}

// ---------- Walton 围道二重积分:任意平面多边形间角系数 ----------
// F_{1->2} = 1/(2π A1) ∮C1 ∮C2 ln|r2-r1| (dr1·dr2)
// 多边形顶点按逆时针(从法线正方向看)

export function polygonArea(poly: Vec3[]): number {
  let acc: Vec3 = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    acc = v3.add(acc, v3.cross(poly[i], poly[(i + 1) % poly.length]));
  }
  return v3.len(acc) / 2;
}

/** 有向面积向量(由绕序决定法线方向) */
function polygonNormal(poly: Vec3[]): Vec3 {
  let acc: Vec3 = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    acc = v3.add(acc, v3.cross(poly[i], poly[(i + 1) % poly.length]));
  }
  return v3.norm(acc);
}

/** 反转绕序 */
function reversed(poly: Vec3[]): Vec3[] {
  return [...poly].reverse();
}

function edgeIntegrand(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, u: number, v: number): number {
  const r1 = v3.lerp(p1, q1, u);
  const r2 = v3.lerp(p2, q2, v);
  const e1 = v3.sub(q1, p1);
  const e2 = v3.sub(q2, p2);
  const d = v3.len(v3.sub(r2, r1));
  if (d < 1e-12) return 0;
  return Math.log(d) * v3.dot(e1, e2);
}

function edgePairGL(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, nodes: [number, number][]): number {
  // 单位长度参数域 [0,1]:节点从 [-1,1] 映射
  let s = 0;
  for (const [u0, wu] of nodes) {
    const u = (u0 + 1) / 2;
    for (const [v0, wv] of nodes) {
      const v = (v0 + 1) / 2;
      s += wu * wv * edgeIntegrand(p1, q1, p2, q2, u, v);
    }
  }
  return s / 4; // 雅可比 0.5*0.5
}

/** 自适应:边对积分,细分直到 3 点与 5 点结果一致 */
function edgePairAdaptive(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, depth: number): number {
  const coarse = edgePairGL(p1, q1, p2, q2, GL3);
  const fine = edgePairGL(p1, q1, p2, q2, GL5);
  const scale = Math.max(1, Math.abs(fine));
  if (Math.abs(fine - coarse) < 1e-10 * scale || depth > 6) return fine;
  // 把两条边各劈半,四等分递归
  const m1 = v3.lerp(p1, q1, 0.5), m2 = v3.lerp(p2, q2, 0.5);
  let s = 0;
  for (const [a, b] of [[p1, m1], [m1, q1]] as [Vec3, Vec3][]) {
    for (const [c, d] of [[p2, m2], [m2, q2]] as [Vec3, Vec3][]) {
      s += edgePairAdaptive(a, b, c, d, depth + 1);
    }
  }
  return s;
}

export function contourViewFactor(poly1In: Vec3[], poly2In: Vec3[]): number {
  // 围道积分要求两表面法线相对(互相可见),否则结果符号相反。
  // 按质心连线校正 poly2 绕序,使 n1·(c2-c1) 与 n2·(c1-c2) 同为正。
  const c1 = poly1In.reduce((a, p) => v3.add(a, p), [0, 0, 0] as Vec3)
    .map(x => x / poly1In.length) as Vec3;
  const c2 = poly2In.reduce((a, p) => v3.add(a, p), [0, 0, 0] as Vec3)
    .map(x => x / poly2In.length) as Vec3;
  const n1 = polygonNormal(poly1In);
  const poly1 = poly1In;
  let poly2 = poly2In;
  const n2raw = polygonNormal(poly2);
  const d = v3.norm(v3.sub(c2, c1));
  // 两法线应都指向两板之间:n1·d>0 且 n2·(-d)>0
  if (v3.dot(n1, d) < 0 || v3.dot(n2raw, v3.scale(d, -1)) < 0) {
    poly2 = reversed(poly2In);
  }
  const A1 = polygonArea(poly1);
  let integral = 0;
  for (let i = 0; i < poly1.length; i++) {
    const p1 = poly1[i], q1 = poly1[(i + 1) % poly1.length];
    for (let j = 0; j < poly2.length; j++) {
      const p2 = poly2[j], q2 = poly2[(j + 1) % poly2.length];
      integral += edgePairAdaptive(p1, q1, p2, q2, 0);
    }
  }
  // 物理角系数非负;数值噪声下取绝对值并截断到 [0,1]
  return Math.max(0, Math.min(1, integral / (2 * Math.PI * A1)));
}

/** 矩形多边形构造(便于细分比对) */
export function rectPoly(cx: number, cy: number, z: number, w: number, h: number): Vec3[] {
  return [
    [cx - w / 2, cy - h / 2, z],
    [cx + w / 2, cy - h / 2, z],
    [cx + w / 2, cy + h / 2, z],
    [cx - w / 2, cy + h / 2, z],
  ];
}

/** 把一个大矩形划成 nx*ny 个小矩形多边形,返回 {poly, area} 列表 */
export function subdivideRect(cx: number, cy: number, z: number, w: number, h: number,
  nx: number, ny: number): { poly: Vec3[]; area: number }[] {
  const out: { poly: Vec3[]; area: number }[] = [];
  const dw = w / nx, dh = h / ny;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = cx - w / 2 + (i + 0.5) * dw;
      const y = cy - h / 2 + (j + 0.5) * dw * 0 + (j + 0.5) * dh;
      const poly = rectPoly(x, y, z, dw, dh);
      out.push({ poly, area: dw * dh });
    }
  }
  return out;
}

/** 圆盘多边形(用于同轴圆盘的围道积分交叉验证) */
export function diskPoly(r: number, z: number, seg = 64): Vec3[] {
  const poly: Vec3[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    poly.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return poly;
}

// ---------- 校验工具 ----------

export interface ReciprocityReport {
  maxRowSumError: number;
  maxReciprocityError: number;
  pairErrors: { i: number; j: number; lhs: number; rhs: number; err: number }[];
}

export function checkMatrix(F: Float32Array | number[][], n: number,
  areas: number[], tol = 1e-9): ReciprocityReport {
  const get = (i: number, j: number) => Array.isArray(F) ? F[i][j] : F[i * n + j];
  let maxRowSumError = 0;
  const pairErrors: ReciprocityReport['pairErrors'] = [];
  let maxReciprocityError = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    for (let j = 0; j < n; j++) row += get(i, j);
    maxRowSumError = Math.max(maxRowSumError, Math.abs(row - 1));
    for (let j = 0; j < n; j++) {
      const lhs = areas[i] * get(i, j);
      const rhs = areas[j] * get(j, i);
      const denom = Math.max(1e-12, 0.5 * (Math.abs(lhs) + Math.abs(rhs)));
      const err = Math.abs(lhs - rhs) / denom;
      if (err > tol) pairErrors.push({ i, j, lhs, rhs, err });
      maxReciprocityError = Math.max(maxReciprocityError, err);
    }
  }
  pairErrors.sort((a, b) => b.err - a.err);
  return { maxRowSumError, maxReciprocityError, pairErrors: pairErrors.slice(0, 10) };
}
