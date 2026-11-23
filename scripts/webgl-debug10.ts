// 单接收面片 vs 解析微元角系数,逐面分解
import { HemicubeEngine, type SceneGeometry } from '../src/core/hemicube';
import type { PatchInfo } from '../src/core/types';

const dw = 0.0125, a = 0.1, c = 0.05;
const pos: number[] = [], idx: number[] = [], tri: number[] = [];
const patches: PatchInfo[] = [];
const quad = (p0:number[],p1:number[],p2:number[],p3:number[],n:number[],kind:PatchInfo['kind']) => {
  const base = pos.length/3;
  pos.push(...p0,...p1,...p2,...p3);
  idx.push(base,base+1,base+2,base,base+2,base+3);
  const id = patches.length; tri.push(id,id);
  patches.push({ surfaceId:id, kind, ownerIndex:0, band:0, sector:0,
    centroid:[0,0,0] as [number,number,number], normal:n as [number,number,number], area:dw*dw });
};
quad([-dw/2,-dw/2,0],[dw/2,-dw/2,0],[dw/2,dw/2,0],[-dw/2,dw/2,0],[0,0,1],'chill');
quad([-a/2,-a/2,c],[a/2,-a/2,c],[a/2,a/2,c],[-a/2,a/2,c],[0,0,-1],'heater');
const ambient = patches.length;
patches.push({ surfaceId:ambient, kind:'ambient', ownerIndex:-1, band:-1, sector:-1,
  centroid:[0,0,0], normal:[0,0,1], area:1 });
const scene: SceneGeometry = { positions:new Float32Array(pos), indices:new Uint32Array(idx),
  triPatch:new Uint32Array(tri), patches, ambientPatchIndex:ambient };

// 解析微元-有限面 F(数值积分)
const M = 200;
let fAnalytic = 0;
for (let i=0;i<M;i++) for (let j=0;j<M;j++) {
  const x = -a/2+(i+0.5)*a/M, y = -a/2+(j+0.5)*a/M;
  const r2 = x*x+y*y+c*c;
  const cosT = c/Math.sqrt(r2);
  fAnalytic += (cosT*cosT/(Math.PI*r2)) * (a/M)*(a/M);
}

const out: Record<string, unknown> = { fAnalytic, byRes: {}, perFace: {} };
{
  const N = 64;
  const engine = new HemicubeEngine(N);
  engine.uploadScene(scene);
  const { frames, bufs } = (engine as unknown as {
    renderFaces: (i: number) => { frames: { weight: Float32Array; width: number }[]; bufs: Uint8Array[] };
  }).renderFaces(0);
  const perFace = frames.map((frame, f) => {
    const buf = bufs[f];
    let plateW = 0, platePx = 0, totalW = 0;
    for (let p = 0, idx = 0; p < buf.length; p += 4, idx++) {
      const id = buf[p] | (buf[p+1]<<8) | (buf[p+2]<<16);
      const w = frame.weight[idx];
      totalW += w;
      if (id === 2) { plateW += w; platePx++; }
    }
    return { face: f, width: frame.width, totalWeight: totalW, plateWeight: plateW, platePixels: platePx };
  });
  out.perFace = perFace;
}
for (const N of [48, 64, 96, 128]) {
  const engine = new HemicubeEngine(N);
  engine.uploadScene(scene);
  const r = engine.computeOne(0);
  (out.byRes as Record<string, unknown>)[`HC${N}`] = {
    F_toPlate: r.accum[1], rowSum: r.rowSum, pixels: r.pixelCount[1],
    errPct: (r.accum[1]-fAnalytic)/fAnalytic*100,
  };
}
(window as unknown as { __DEBUG10__: unknown }).__DEBUG10__ = out;
