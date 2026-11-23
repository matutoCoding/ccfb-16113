// 验证五面相机帧正交性 + 每面渲染覆盖方向
import { HemicubeEngine } from '../src/core/hemicube';
import type { SceneGeometry } from '../src/core/hemicube';
import type { PatchInfo } from '../src/core/types';

const N = 64;
const engine = new HemicubeEngine(N);
// 访问私有帧构造(通过渲染一个简单场景)
const pos = new Float32Array([
  -0.01,-0.01,0, 0.01,-0.01,0, 0.01,0.01,0, -0.01,0.01,0,
]);
const idx = new Uint32Array([0,1,2,0,2,3]);
const tri = new Uint32Array([0,0]);
const patches: PatchInfo[] = [{
  surfaceId: 0, kind: 'chill', ownerIndex: 0, band: 0, sector: 0,
  centroid: [0,0,0], normal: [0,0,1], area: 0.0004,
}];
const ambient = 1;
patches.push({
  surfaceId: 1, kind: 'ambient', ownerIndex: -1, band: -1, sector: -1,
  centroid: [0,0,0], normal: [0,0,1], area: 1,
});
const scene: SceneGeometry = { positions: pos, indices: idx, triPatch: tri, patches, ambientPatchIndex: ambient };
engine.uploadScene(scene);

// 通过反射访问 faceFrames
const frames = (engine as unknown as {
  faceFrames: (n: [number,number,number]) => { d:number[]; s:number[]; u:number[]; width:number; height:number }[];
}).faceFrames([0,0,1]);

const dot = (a:number[], b:number[]) => a.reduce((s,x,i)=>s+x*b[i],0);
const frameCheck = frames.map(f => ({
  d: f.d, s: f.s, u: f.u, w: f.width, h: f.height,
  sDotU: dot(f.s,f.u), sDotD: dot(f.s,f.d), uDotD: dot(f.u,f.d),
  sLen: Math.hypot(...f.s), uLen: Math.hypot(...f.u),
  // 右手系:s × u 应 = -d(相机看向 -Z)
  crossSU: [
    f.s[1]*f.u[2]-f.s[2]*f.u[1],
    f.s[2]*f.u[0]-f.s[0]*f.u[2],
    f.s[0]*f.u[1]-f.s[1]*f.u[0],
  ],
}));

// 权重总和
const totalW = frames.reduce((s,f) => s + f.weight.reduce((a,b)=>a+b,0), 0);

(window as unknown as { __DEBUG9__: unknown }).__DEBUG9__ = { frameCheck, totalW, N };
