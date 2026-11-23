// 干净最小场景:单个接收面片 + 单块正对板,验证顶面 F
import { HemicubeEngine, type SceneGeometry } from '../src/core/hemicube';
import { parallelRectanglesF } from '../src/core/reference';
import type { PatchInfo } from '../src/core/types';

// 场景:接收小面片(0.0125×0.0125)在 z=0,大板(0.1×0.1)在 z=0.05
const dw = 0.0125, a = 0.1, c = 0.05;
const pos: number[] = [];
const idx: number[] = [];
const tri: number[] = [];
const patches: PatchInfo[] = [];
const quad = (p0: number[], p1: number[], p2: number[], p3: number[], n: number[], kind: PatchInfo['kind']) => {
  const base = pos.length / 3;
  pos.push(...p0, ...p1, ...p2, ...p3);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  const id = patches.length;
  tri.push(id, id);
  const cen = p0.map((v, k) => (v + p1[k] + p2[k] + p3[k]) / 4);
  patches.push({
    surfaceId: id, kind, ownerIndex: 0, band: 0, sector: 0,
    centroid: cen as [number, number, number], normal: n as [number, number, number], area: dw * dw,
  });
};
// 接收面片,法线 +z
quad([-dw/2,-dw/2,0],[dw/2,-dw/2,0],[dw/2,dw/2,0],[-dw/2,dw/2,0],[0,0,1],'chill');
// 大板用一个 patch(粗),法线 -z
quad([-a/2,-a/2,c],[a/2,-a/2,c],[a/2,a/2,c],[-a/2,a/2,c],[0,0,-1],'heater');
const ambient = patches.length;
patches.push({
  surfaceId: ambient, kind: 'ambient', ownerIndex: -1, band: -1, sector: -1,
  centroid: [0,0,0], normal: [0,0,1], area: 1,
});
const scene: SceneGeometry = {
  positions: new Float32Array(pos), indices: new Uint32Array(idx),
  triPatch: new Uint32Array(tri), patches, ambientPatchIndex: ambient,
};

const engine = new HemicubeEngine(96);
engine.uploadScene(scene);
const r = engine.computeOne(0);

// 检查 computeOne 之后 pixelBuf 面0(96,96)区域
const diag: Record<string, unknown> = {};
{
  const N = 96;
  let nz = 0; const ids = new Set();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = ((N + y) * engine.atlasW + (N + x)) * 4;
    const id = engine.pixelBuf[p] | (engine.pixelBuf[p+1]<<8) | (engine.pixelBuf[p+2]<<16);
    if (id) { nz++; ids.add(id); }
  }
  diag.pixelBufFace0 = { nz, ids: [...ids], atlasW: engine.atlasW };
  let wsum = 0; for (const w of engine.topWeightLut) wsum += w;
  diag.topWeightSum = wsum;
  let allNz = 0;
  for (let p = 0; p < engine.pixelBuf.length; p += 4) {
    const id = engine.pixelBuf[p] | (engine.pixelBuf[p+1]<<8) | (engine.pixelBuf[p+2]<<16);
    if (id) allNz++;
  }
  diag.atlasTotalNonZero = allNz;
}

// 手动控制渲染变体
const gl2 = engine.gl;
const views = engine['hemicubeViewMatsExternal'] ? null : null;
void views;
const { hemicubeViewMats, mat4Multiply, mat4Perspective } = await import('../src/core/math');
const vms = hemicubeViewMats([0, 0, 1]);
const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0, 1]);
const proj = mat4Perspective(Math.PI / 2, 1, 1e-5, 60);
const variants: Record<string, number> = {};
for (const [name, skip, depth] of [
  ['skipDepth', 1, true], ['noSkipDepth', 0, true],
  ['skipNoDepth', 1, false], ['noSkipNoDepth', 0, false],
] as [string, number, boolean][]) {
  gl2.bindFramebuffer(gl2.FRAMEBUFFER, engine.fbo);
  gl2.viewport(0, 0, 96, 96);
  gl2.disable(gl2.SCISSOR_TEST);
  gl2.clearColor(0, 0, 0, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
  gl2.useProgram(engine.program);
  gl2.bindVertexArray(engine.vao);
  depth ? gl2.enable(gl2.DEPTH_TEST) : gl2.disable(gl2.DEPTH_TEST);
  gl2.disable(gl2.CULL_FACE);
  gl2.uniform1ui(engine.uSkip, skip);
  gl2.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(vms[0].view, trans)));
  gl2.drawElements(gl2.TRIANGLES, engine.indexCount, gl2.UNSIGNED_INT, 0);
  const px = new Uint8Array(96 * 96 * 4);
  gl2.readPixels(0, 0, 96, 96, gl2.RGBA, gl2.UNSIGNED_BYTE, px);
  let nz = 0; const ids = new Set();
  for (let p = 0; p < px.length; p += 4) {
    const id = px[p] | (px[p+1]<<8) | (px[p+2]<<16);
    if (id) { nz++; ids.add(id); }
  }
  variants[name] = nz;
  (variants as Record<string, unknown>)[name + 'Ids'] = [...ids];
}
// 图集视口 (96,96) 测试
{
  gl2.bindFramebuffer(gl2.FRAMEBUFFER, engine.fbo);
  gl2.viewport(96, 96, 96, 96);
  gl2.disable(gl2.SCISSOR_TEST);
  gl2.clearColor(0, 0, 0, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
  gl2.useProgram(engine.program);
  gl2.bindVertexArray(engine.vao);
  gl2.enable(gl2.DEPTH_TEST);
  gl2.disable(gl2.CULL_FACE);
  gl2.uniform1ui(engine.uSkip, 1);
  gl2.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(vms[0].view, trans)));
  gl2.drawElements(gl2.TRIANGLES, engine.indexCount, gl2.UNSIGNED_INT, 0);
  const px = new Uint8Array(96 * 96 * 4);
  gl2.readPixels(96, 96, 96, 96, gl2.RGBA, gl2.UNSIGNED_BYTE, px);
  let nz = 0; const ids = new Set();
  for (let p = 0; p < px.length; p += 4) {
    const id = px[p] | (px[p+1]<<8) | (px[p+2]<<16);
    if (id) { nz++; ids.add(id); }
  }
  variants.atlasViewport96 = nz;
  (variants as Record<string, unknown>).atlasIds = [...ids];
  variants.fboSize = { w: engine.atlasW, h: engine.atlasH };
}

// 逐面用引擎同款视图矩阵(含 trans)在图集视口渲染
const faceByFace: Record<string, unknown> = {};
for (let face = 0; face < 5; face++) {
  const [vx, vy] = engine.faceViewportGLPublic(face);
  gl2.bindFramebuffer(gl2.FRAMEBUFFER, engine.fbo);
  gl2.viewport(vx, vy, 96, 96);
  gl2.disable(gl2.SCISSOR_TEST);
  gl2.clearColor(0, 0, 0, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
  gl2.useProgram(engine.program);
  gl2.bindVertexArray(engine.vao);
  gl2.enable(gl2.DEPTH_TEST);
  gl2.disable(gl2.CULL_FACE);
  gl2.uniform1ui(engine.uSkip, 1);
  const tmat = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0, 1]);
  gl2.uniformMatrix4fv(engine.uMVP, false,
    mat4Multiply(proj, mat4Multiply(vms[face].view, tmat)));
  gl2.drawElements(gl2.TRIANGLES, engine.indexCount, gl2.UNSIGNED_INT, 0);
  const px = new Uint8Array(96 * 96 * 4);
  gl2.readPixels(vx, vy, 96, 96, gl2.RGBA, gl2.UNSIGNED_BYTE, px);
  let nz = 0; const ids = new Set();
  for (let p = 0; p < px.length; p += 4) {
    const id = px[p] | (px[p+1]<<8) | (px[p+2]<<16);
    if (id) { nz++; ids.add(id); }
  }
  faceByFace['face' + face] = { nz, ids: [...ids] };
}
variants.faceByFace = faceByFace;
variants.view0 = Array.from(vms[0].view);

// 解析:微元 dA1 对有限矩形板(立体角积分),用 8×8 细分平均近似
let analytic = 0;
const N = 8;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const cx = -a/2 + (i+0.5)*a/N, cy = -a/2 + (j+0.5)*a/N;
  const d2 = cx*cx + cy*cy + c*c;
  analytic += (c / (Math.PI * d2)) * (dw*dw) / (dw*dw); // 单位立体角贡献
}
analytic = analytic / (N*N) * (a*a) / (dw*dw) * 0 + analytic;
// 正确的微元-有限面:F = ∫ cosθ1 cosθ2/(π r²) dA2,数值积分
let fNum = 0;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const cx = -a/2 + (i+0.5)*a/N, cy = -a/2 + (j+0.5)*a/N;
  const r2 = cx*cx + cy*cy + c*c;
  const cos1 = c / Math.sqrt(r2), cos2 = cos1;
  fNum += (cos1*cos2/(Math.PI*r2)) * (a/N)*(a/N);
}
(window as unknown as { __DEBUG8__: unknown }).__DEBUG8__ = {
  hemiF: r.accum[1],
  analyticDifferential: fNum,
  rowSum: r.rowSum,
  ambient: r.accum[ambient],
  pixelCountToPlate: r.pixelCount[1],
  variants,
  diag,
};
