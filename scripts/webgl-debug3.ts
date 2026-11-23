// 面1 渲染根因:对比面0/面1 MVP,逐状态排查
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';
import { mat4Multiply, mat4Perspective } from '../src/core/math';

const N = 64;
const engine = new HemicubeEngine(N);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const gl = engine.gl;
const ri = built.plate1Ids[0];
const patch = built.scene.patches[ri];
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0,
  -patch.centroid[0], -patch.centroid[1], -patch.centroid[2], 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 0.008, 60);
const projNear = mat4Perspective(Math.PI / 2, 1, 0.0001, 60);
const views = engine.hemicubeViewMatsExternal
  ? engine.hemicubeViewMatsExternal(patch.normal) : null;

// 直接从模块路径重建(调试脚本内联导入)
const { hemicubeViewMats } = await import('../src/core/math');
const vms = hemicubeViewMats(patch.normal);

const renderFace = (face: number, vx: number, vy: number, depthTest: boolean) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
  gl.viewport(vx, vy, N, N);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(engine.program);
  gl.bindVertexArray(engine.vao);
  if (depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.uniform1ui(engine.uSkip, 0);
  gl.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(vms[face].view, trans)));
  gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(N * N * 4);
  gl.readPixels(vx, vy, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nz = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) nz++;
  return { nz, glError: gl.getError() };
};

// 面 1 用大视场(整个 atlas 视口 192×128)排除视口裁剪问题
const renderFaceWide = (face: number) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
  gl.viewport(0, 0, 192, 128);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(engine.program);
  gl.bindVertexArray(engine.vao);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.uniform1ui(engine.uSkip, 0);
  gl.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(vms[face].view, trans)));
  gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(192 * 128 * 4);
  gl.readPixels(0, 0, 192, 128, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nz = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) nz++;
  return nz;
};

const out = {
  face0: renderFace(0, 0, 0, true),
  face1: renderFace(1, N, 0, true),
  face1NoDepth: renderFace(1, 2 * N, 0, false),
  face2: renderFace(2, 0, N, true),
  face3: renderFace(3, N, N, true),
  face4: renderFace(4, 2 * N, N, true),
  face1Wide: renderFaceWide(1),
  face3Wide: renderFaceWide(3),
  face1TinyNear: (() => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
    gl.viewport(0, 0, N, N);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(engine.program);
    gl.bindVertexArray(engine.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.uniform1ui(engine.uSkip, 0);
    gl.uniformMatrix4fv(engine.uMVP, false,
      mat4Multiply(projNear, mat4Multiply(vms[1].view, trans)));
    gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
    const px = new Uint8Array(N * N * 4);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nz = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) nz++;
    return nz;
  })(),
  mvpFace1: Array.from(mat4Multiply(proj, mat4Multiply(vms[1].view, trans))),
  viewFace1: Array.from(vms[1].view),
  viewFace0: Array.from(vms[0].view),
};

// 基向量与已知点探针
const n3 = patch.normal;
const ref3: number[] = Math.abs(n3[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a: number[]): number[] => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const t3 = norm3(cross(ref3, n3));
const b3 = norm3(cross(t3, n3));
const mv1 = mat4Multiply(vms[1].view, trans);
const toEye = (p: number[]) => {
  const e = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    e[r] = mv1[r] * p[0] + mv1[4 + r] * p[1] + mv1[8 + r] * p[2] + mv1[12 + r];
  }
  return e;
};
const cen = patch.centroid;
const plusT = [cen[0] + t3[0] * 0.05, cen[1] + t3[1] * 0.05, cen[2] + t3[2] * 0.05, 1];
out.basis = { t: t3, b: b3, n: Array.from(n3) };
out.pointPlusT = { world: plusT, eye: toEye(plusT) };
// 场景中实际存在的围壁顶点采样
out.sceneBounds = (() => {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < built.scene.positions.length; i += 3) {
    minY = Math.min(minY, built.scene.positions[i]);
    maxY = Math.max(maxY, built.scene.positions[i]);
  }
  return { minY, maxY };
})();

// 面 1 眼空间:统计所有顶点的 eye-z(应为负才可见)
const eyeZs: number[] = [];
const eyeXs: number[] = [];
for (let i = 0; i < built.scene.positions.length; i += 3) {
  const p = [built.scene.positions[i], built.scene.positions[i + 1], built.scene.positions[i + 2], 1];
  const e = toEye(p);
  eyeZs.push(e[2]); eyeXs.push(e[0]);
}
out.face1EyeRange = {
  zMin: Math.min(...eyeZs), zMax: Math.max(...eyeZs),
  xMin: Math.min(...eyeXs), xMax: Math.max(...eyeXs),
  visibleCount: eyeZs.filter(z => z < -0.001).length,
  totalVerts: eyeZs.length,
};
// 围壁面片(后 64 个 patch 之前是 128 个板 patch)的法线在面 1 朝向
out.wallNormalSample = built.scene.patches[128]?.normal;
out.wallPatchCount = built.scene.patches.length - 1;
// 抽一块围壁三角形的实际顶点
const wallIdxStart = 128 * 6; // 每个 quad 6 个 index
out.wallTriIndices = Array.from(built.scene.indices.slice(wallIdxStart, wallIdxStart + 3));
const wi = built.scene.indices[wallIdxStart];
out.wallTriVerts = [
  [built.scene.positions[wi * 3], built.scene.positions[wi * 3 + 1], built.scene.positions[wi * 3 + 2]],
];
(window as unknown as { __DEBUG3__: unknown }).__DEBUG3__ = out;
