// 逐面诊断:每个 hemicube 面分别回读,统计像素数与权重和(理论:top 0.554,侧 0.182,底 0.082)
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';
import { mat4Multiply, mat4Perspective, hemicubeViewMats } from '../src/core/math';

const N = 64;
const engine = new HemicubeEngine(N);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const gl = engine.gl;
const ri = built.plate1Ids[0];
const patch = built.scene.patches[ri];
const views = hemicubeViewMats(patch.normal);
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0,
  -patch.centroid[0], -patch.centroid[1], -patch.centroid[2], 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 0.008, 60);

// 单像素权重查询
const wAt = (x: number, y: number) => {
  const du = 2 / N, dA = du * du;
  const u = -1 + (x + 0.5) * du, v = -1 + (y + 0.5) * du;
  const r2 = 1 + u * u + v * v;
  return dA / (Math.PI * r2 * r2);
};

gl.useProgram(engine.program);
gl.bindVertexArray(engine.vao);
gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
const faceReport = [];
for (let face = 0; face < 5; face++) {
  const [vx, vy] = engine.faceViewportGL(face);
  gl.viewport(vx, vy, N, N);
  gl.scissor(vx, vy, N, N);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1ui(engine.uSkip, ri + 1);
  gl.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(views[face].view, trans)));
  gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(N * N * 4);
  gl.readPixels(vx, vy, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nz = 0, wsum = 0;
  const idHist = new Map();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = (y * N + x) * 4;
    const id = px[p] | (px[p + 1] << 8) | (px[p + 2] << 16);
    if (id !== 0) {
      nz++; wsum += wAt(x, y);
      idHist.set(id, (idHist.get(id) ?? 0) + 1);
    }
  }
  faceReport.push({
    face, viewport: [vx, vy], nz, wsum,
    topIds: [...idHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
  });
}
// 理论覆盖:top 0.5542,每个侧面 0.1817,底面 0.0824(总和=1)
// 面 1 专项:把板 2 面片中心与围壁角点变换到 NDC
const f1 = views[1];
const probe = (p: number[]) => {
  const mv = mat4Multiply(f1.view, trans);
  const clip = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    clip[r] = mv[r] * p[0] + mv[4 + r] * p[1] + mv[8 + r] * p[2] + mv[12 + r];
  }
  return { eye: [clip[0], clip[1], clip[2], clip[3]], ndc: [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]] };
};
const f1Probes = {
  plate2Center: probe([0, 0, 0.05, 1]),
  plate2Corner: probe([0.05, 0.05, 0.05, 1]),
  wallPointY: probe([0, -0.05, 0.025, 1]),
  ownPlatePoint: probe([-0.04375, -0.04375, 0, 1]),
};
// 隔离渲染面 1:全状态重置 + 关闭 scissor,排除状态残留
gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
gl.viewport(128, 64, N, N);
gl.disable(gl.SCISSOR_TEST);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.useProgram(engine.program);
gl.bindVertexArray(engine.vao);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.disable(gl.CULL_FACE);
gl.uniform1ui(engine.uSkip, ri + 1);
gl.uniformMatrix4fv(engine.uMVP, false,
  mat4Multiply(proj, mat4Multiply(f1.view, trans)));
gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
const isolatedErr = gl.getError();
const pxIso = new Uint8Array(N * N * 4);
gl.readPixels(128, 64, N, N, gl.RGBA, gl.UNSIGNED_BYTE, pxIso);
let nzIso = 0;
for (let i = 0; i < pxIso.length; i += 4) {
  if (pxIso[i] || pxIso[i + 1] || pxIso[i + 2]) nzIso++;
}
// 再用不 skip 任何面片的方式渲面 1
gl.viewport(0, 0, N, N);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.uniform1ui(engine.uSkip, 0);
gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
const pxNoSkip = new Uint8Array(N * N * 4);
gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, pxNoSkip);
let nzNoSkip = 0;
for (let i = 0; i < pxNoSkip.length; i += 4) {
  if (pxNoSkip[i] || pxNoSkip[i + 1] || pxNoSkip[i + 2]) nzNoSkip++;
}
(window as unknown as { __DEBUG2__: unknown }).__DEBUG2__ = {
  faceReport,
  expected: { top: 0.5542, side: 0.1817, bottom: 0.0824 },
  isolatedFace1: { nz: nzIso, glError: isolatedErr },
  face1NoSkip: { nz: nzNoSkip },
  viewAxes: views.map(v => {
    const m = v.view;
    return {
      face: v.face,
      right: [m[0], m[1], m[2]],
      up: [m[4], m[5], m[6]],
      look: [-m[8], -m[9], -m[10]],
    };
  }),
  f1Probes,
};
