// Dump 顶面(面0)ID 缓冲:中心面片看到的到底是什么
import { HemicubeEngine } from '../src/core/hemicube';
import { buildParallelPlates } from '../src/core/validation-geometry';
import { mat4Multiply, mat4Perspective, hemicubeViewMats } from '../src/core/math';

const N = 32;
const engine = new HemicubeEngine(N);
const built = buildParallelPlates(0.1, 0.1, 0.05, 8, 8);
engine.uploadScene(built.scene);
const gl = engine.gl;
const i = built.plate1Ids[27];
const patch = built.scene.patches[i];
const views = hemicubeViewMats(patch.normal);
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0,
  -patch.centroid[0], -patch.centroid[1], -patch.centroid[2], 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 1e-5, 60);

gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
gl.viewport(0, 0, N, N);
gl.disable(gl.SCISSOR_TEST);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.useProgram(engine.program);
gl.bindVertexArray(engine.vao);
gl.enable(gl.DEPTH_TEST);
gl.disable(gl.CULL_FACE);
gl.uniform1ui(engine.uSkip, i + 1);
gl.uniformMatrix4fv(engine.uMVP, false, mat4Multiply(proj, mat4Multiply(views[0].view, trans)));
gl.drawElements(gl.TRIANGLES, engine.indexCount, gl.UNSIGNED_INT, 0);
const px = new Uint8Array(N * N * 4);
gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);

// 统计 ID 直方图
const hist = new Map();
for (let p = 0; p < px.length; p += 4) {
  const id = px[p] | (px[p + 1] << 8) | (px[p + 2] << 16);
  if (id) hist.set(id, (hist.get(id) ?? 0) + 1);
}
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([encoded, cnt]) => {
    const patchId = encoded - 1;
    const kind = built.plate1Ids.includes(patchId) ? 'plate1'
      : built.plate2Ids.includes(patchId) ? 'plate2' : 'wall';
    return { encoded, patchId, kind, cnt };
  });
// 中心 8×8 区域
const centerIds = new Set();
for (let y = N / 2 - 4; y < N / 2 + 4; y++) for (let x = N / 2 - 4; x < N / 2 + 4; x++) {
  const p = (y * N + x) * 4;
  centerIds.add((px[p] | (px[p + 1] << 8) | (px[p + 2] << 16)) - 1);
}
(window as unknown as { __DEBUG7__: unknown }).__DEBUG7__ = {
  receiver: i, receiverCentroid: patch.centroid,
  topHist: top,
  centerPatchIds: [...centerIds],
  oppositePatch: built.plate2Ids[27],
};
