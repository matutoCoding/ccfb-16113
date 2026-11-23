// 半立方体渲染调试:查 FBO 完整性、GL 错误、MVP 变换、中心像素
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';
import { mat4Multiply, mat4Perspective, hemicubeViewMats } from '../src/core/math';

const engine = new HemicubeEngine(64);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const gl = engine.gl;

const dbg = {
  fboComplete: gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
  indexCount: engine.indexCount,
  patchCount: built.scene.patches.length,
  ambient: built.scene.ambientPatchIndex,
  glErrorAfterUpload: gl.getError(),
  steps: [],
};

// 手动渲染接收面片 0 的面 0
const patch = built.scene.patches[built.plate1Ids[0]];
const views = hemicubeViewMats(patch.normal);
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0,
  -patch.centroid[0], -patch.centroid[1], -patch.centroid[2], 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 0.008, 60);
const mvp = mat4Multiply(proj, mat4Multiply(views[0].view, trans));

// 把板 2 中心顶点经 MVP 变换
const p2center = [0, 0, 0.05, 1];
const clip = [0, 0, 0, 0];
for (let r = 0; r < 4; r++) {
  clip[r] = mvp[r] * p2center[0] + mvp[4 + r] * p2center[1] + mvp[8 + r] * p2center[2] + mvp[12 + r];
}
dbg.plate2CenterClip = clip;
dbg.ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
dbg.receiver = { centroid: patch.centroid, normal: patch.normal, id: patch.surfaceId };

gl.useProgram(engine.program);
gl.bindVertexArray(engine.vao);
gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
gl.viewport(64, 0, 64, 64);
gl.disable(gl.SCISSOR_TEST);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.uniform1ui(engine.uSkip, 0); // 不跳过任何面片
gl.uniformMatrix4fv(engine.uMVP, false, mvp);
gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
dbg.glErrorAfterDraw = gl.getError();

const px = new Uint8Array(64 * 64 * 4);
gl.readPixels(64, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
let nonZero = 0, firstId = 0;
for (let i = 0; i < px.length; i += 4) {
  const id = px[i] | (px[i + 1] << 8) | (px[i + 2] << 16);
  if (id !== 0) { nonZero++; if (!firstId) firstId = id; }
}
dbg.face0NoSkip = { nonZeroPixels: nonZero, firstId, total: 64 * 64 };
dbg.centerPixel = [px[(32 * 64 + 32) * 4], px[(32 * 64 + 32) * 4 + 1], px[(32 * 64 + 32) * 4 + 2]];

// 完整 computeOne 验证
const one = engine.computeOne(built.plate1Ids[0]);
dbg.computeOne = {
  rowSum: one.rowSum,
  nonzeroTargets: [...one.accum.map((v, i) => ({ i, v }))].filter(x => x.v > 0).slice(0, 6),
};

// 带 skip 的 face0 渲染(复现 computeAll 行为)
gl.useProgram(engine.program);
gl.bindVertexArray(engine.vao);
gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
gl.viewport(64, 0, 64, 64);
gl.disable(gl.SCISSOR_TEST);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.uniform1ui(engine.uSkip, built.plate1Ids[0] + 1);
gl.uniformMatrix4fv(engine.uMVP, false, mvp);
gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
const px2 = new Uint8Array(64 * 64 * 4);
gl.readPixels(64, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px2);
let nz2 = 0; const idCount = new Map();
for (let i = 0; i < px2.length; i += 4) {
  const id = px2[i] | (px2[i + 1] << 8) | (px2[i + 2] << 16);
  if (id !== 0) { nz2++; idCount.set(id, (idCount.get(id) ?? 0) + 1); }
}
dbg.face0WithSkip = {
  nonZeroPixels: nz2,
  idHistogram: [...idCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
};
// 检查 attribute 绑定状态
const attrEnabled = [gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
  gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED)];
dbg.attrs = { enabled: attrEnabled, type1: gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_TYPE) };
dbg.program = gl.getParameter(gl.CURRENT_PROGRAM) === engine.program;
dbg.vaoBound = true;

// 完整 computeAll,直接检查矩阵
const all = engine.computeAll();
const n = built.scene.patches.length;
const row0 = [];
for (let j = 0; j < n; j++) {
  const v = all.matrix.rows[built.plate1Ids[0] * n + j];
  if (v > 0) row0.push({ j, v });
}
dbg.computeAllRow0 = { count: row0.length, top: row0.sort((a, b) => b.v - a.v).slice(0, 8) };
dbg.computeAllResidual = all.matrix.rowResidual[built.plate1Ids[0]];
// 检查图集回读:全图集非零像素数
let atlasNz = 0;
for (let i = 0; i < engine.pixelBuf.length; i += 4) {
  const id = engine.pixelBuf[i] | (engine.pixelBuf[i + 1] << 8) | (engine.pixelBuf[i + 2] << 16);
  if (id !== 0) atlasNz++;
}
dbg.atlasNonZeroPixels = atlasNz;
dbg.atlasSize = engine.pixelBuf.length / 4;
// 检查 weightLut
let wsum = 0;
for (const w of engine.weightLut) wsum += w;
dbg.weightLutSumFace0 = wsum;
dbg.weightLutLen = engine.weightLut.length;

(window as unknown as { __DEBUG__: unknown }).__DEBUG__ = dbg;
