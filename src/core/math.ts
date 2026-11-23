// 最小三维数学库:全是纯函数,避免对象分配热点
import type { Vec3 } from './types';

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

/** 4x4 列主序矩阵(直接喂 WebGL uniform) */
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function mat4Translation(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function mat4RotationX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a), m = mat4Identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function mat4RotationY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a), m = mat4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function mat4RotationZ(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a), m = mat4Identity();
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

export function mat4Scale(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

/** 透视投影(fovy 弧度,近平面 n=1 归一化) */
export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** 视角矩阵:eye 看向 center,up 为世界上方向 */
export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = v3.norm(v3.sub(center, eye));
  const s = v3.norm(v3.cross(f, up));
  const u = v3.cross(s, f);
  const m = mat4Identity();
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -v3.dot(s, eye);
  m[13] = -v3.dot(u, eye);
  m[14] = v3.dot(f, eye);
  return m;
}

/** 半立方体 5 个面的视图矩阵:面片局部右手正交基(t,b,n),b = t×n
 *  五面相机分别沿 +n、±t、±b 观察,up 取与视线严格垂直的基向量 */
export function hemicubeViewMats(nIn: Vec3): { view: Mat4; proj: Mat4; face: number }[] {
  const n = v3.norm(nIn);
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const t = v3.norm(v3.cross(ref, n));
  const b = v3.norm(v3.cross(t, n));
  const proj = mat4Perspective(Math.PI / 2, 1, 1e-5, 100);
  // 标准 lookAt:eye=原点,center=视线方向,up 必须与 d 垂直(取正交基中的另两个轴)
  const V = (d: Vec3, up: Vec3) => mat4LookAt([0, 0, 0], d, up);
  return [
    { view: V(n, b), proj, face: 0 },                // 顶
    { view: V(t, n), proj, face: 1 },                // +t,up=n(⊥t)
    { view: V(v3.scale(t, -1), n), proj, face: 2 },  // -t
    { view: V(b, n), proj, face: 3 },                // +b,up=n(⊥b)
    { view: V(v3.scale(b, -1), n), proj, face: 4 },  // -b
  ];
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function deg2rad(d: number): number { return (d * Math.PI) / 180; }
export function rad2deg(r: number): number { return (r * 180) / Math.PI; }

export function interp1(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const u = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * u;
    }
  }
  return ys[ys.length - 1];
}

/** 抽拉曲线:返回位移与速度 */
export function samplePullCurve(points: { t: number; displacement: number }[], t: number) {
  const ts = points.map(p => p.t), ds = points.map(p => p.displacement);
  const d = interp1(ts, ds, t);
  // 中心差分速度
  const eps = 1e-3;
  const v = (interp1(ts, ds, t + eps) - interp1(ts, ds, Math.max(0, t - eps))) /
    (t < eps ? eps : 2 * eps);
  return { displacement: d, speed: v };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
