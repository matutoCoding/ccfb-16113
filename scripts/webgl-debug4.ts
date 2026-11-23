// 最小复现:已知三角形在面 1 相机下能否渲染,隔离是几何/缓冲还是视图问题
import { HemicubeEngine } from '../src/core/hemicube';
import { mat4Multiply, mat4Perspective, hemicubeViewMats } from '../src/core/math';

const N = 64;
const engine = new HemicubeEngine(N);
const gl = engine.gl;

// 手工构造一个位于 -Y 方向(面 1 视线)的三角形
const positions = new Float32Array([
  -0.02, -0.1, 0.02,  0.02, -0.1, 0.02,  0, -0.1, -0.02,
]);
const ids = new Float32Array([5, 5, 5]);
const indices = new Uint32Array([0, 1, 2]);
gl.bindVertexArray(engine.vao);
gl.bindBuffer(gl.ARRAY_BUFFER, engine['posBuf']);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
gl.bindBuffer(gl.ARRAY_BUFFER, engine['idBuf']);
gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine['idxBuf']);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

const views = hemicubeViewMats([0, 0, 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 0.008, 60);
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0, 1]);

const renderOne = (face: number) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine.fbo);
  gl.viewport(0, 0, N, N);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(engine.program);
  gl.bindVertexArray(engine.vao);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.uniform1ui(engine['uSkip'], 0);
  gl.uniformMatrix4fv(engine['uMVP'], false,
    mat4Multiply(proj, mat4Multiply(views[face].view, trans)));
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(N * N * 4);
  gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nz = 0; const found = new Set();
  for (let i = 0; i < px.length; i += 4) {
    const id = px[i] | (px[i + 1] << 8) | (px[i + 2] << 16);
    if (id) { nz++; found.add(id); }
  }
  return { nz, ids: [...found], glError: gl.getError() };
};

(window as unknown as { __DEBUG4__: unknown }).__DEBUG4__ = {
  triangleFace0: renderOne(0),
  triangleFace1: renderOne(1),
  triangleFace2: renderOne(2),
  triangleFace3: renderOne(3),
  triangleFace4: renderOne(4),
  attrib0: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
  attrib1: gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
  view1: Array.from(views[1].view),
};
