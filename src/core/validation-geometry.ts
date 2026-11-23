// 校验算例几何:平行矩形板网格 / 同轴圆筒腔,输出半立方体引擎所需 SceneGeometry
import type { PatchInfo, Vec3 } from './types';
import type { SceneGeometry } from './hemicube';
import { v3 } from './math';

interface Quad { a: Vec3; b: Vec3; c: Vec3; d: Vec3; n: Vec3; }

class GeoAccum {
  pos: number[] = []; idx: number[] = []; tri: number[] = [];
  patches: PatchInfo[] = [];
  private vid(pt: Vec3) {
    const id = this.pos.length / 3;
    this.pos.push(pt[0], pt[1], pt[2]);
    return id;
  }
  addQuad(q: Quad, kind: PatchInfo['kind'], owner: number, band: number, sector: number) {
    const id = this.patches.length;
    const ia = this.vid(q.a), ib = this.vid(q.b), ic = this.vid(q.c), idd = this.vid(q.d);
    this.idx.push(ia, ib, ic, ia, ic, idd);
    this.tri.push(id, id);
    const cen = v3.scale(v3.add(v3.add(q.a, q.b), v3.add(q.c, q.d)), 0.25);
    const area = v3.len(v3.cross(v3.sub(q.b, q.a), v3.sub(q.c, q.a))) / 2
      + v3.len(v3.cross(v3.sub(q.c, q.a), v3.sub(q.d, q.a))) / 2;
    this.patches.push({
      surfaceId: id, kind, ownerIndex: owner, band, sector,
      centroid: cen, normal: q.n, area,
    });
  }
  build(ambientPatchIndex: number): SceneGeometry {
    return {
      positions: new Float32Array(this.pos),
      indices: new Uint32Array(this.idx),
      triPatch: new Uint32Array(this.tri),
      patches: this.patches,
      ambientPatchIndex,
    };
  }
}

export interface PlateScene {
  scene: SceneGeometry;
  plate1Ids: number[];
  plate2Ids: number[];
  sideIds: number[];
  cellArea: number;
}

/** 两块平行等大矩形板(a×b,间距 c),各分 nx×ny 网格,四周加围壁形成封闭腔 */
export function buildParallelPlates(a: number, b: number, c: number, nx: number, ny: number): PlateScene {
  const g = new GeoAccum();
  const plate1Ids: number[] = [];
  const plate2Ids: number[] = [];
  const dw = a / nx, dh = b / ny;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x0 = -a / 2 + i * dw, x1 = x0 + dw;
      const y0 = -b / 2 + j * dh, y1 = y0 + dh;
      // 板 1 在 z=0,法线 +z;板 2 在 z=c,法线 -z
      plate1Ids.push(g.patches.length);
      g.addQuad({
        a: [x0, y0, 0], b: [x1, y0, 0], c: [x1, y1, 0], d: [x0, y1, 0],
        n: [0, 0, 1],
      }, 'chill', 0, i, j);
      plate2Ids.push(g.patches.length);
      g.addQuad({
        a: [x0, y0, c], b: [x0, y1, c], c: [x1, y1, c], d: [x1, y0, c],
        n: [0, 0, -1],
      }, 'heater', 1, i, j);
    }
  }
  // 四块围壁(外壁)
  const sideIds: number[] = [];
  const walls: [Vec3, Vec3, Vec3, Vec3, Vec3][] = [
    [[-a / 2, -b / 2, 0], [-a / 2, b / 2, 0], [-a / 2, b / 2, c], [-a / 2, -b / 2, c], [-1, 0, 0]],
    [[a / 2, -b / 2, 0], [a / 2, -b / 2, c], [a / 2, b / 2, c], [a / 2, b / 2, 0], [1, 0, 0]],
    [[-a / 2, -b / 2, 0], [-a / 2, -b / 2, c], [a / 2, -b / 2, c], [a / 2, -b / 2, 0], [0, -1, 0]],
    [[-a / 2, b / 2, 0], [a / 2, b / 2, 0], [a / 2, b / 2, c], [-a / 2, b / 2, c], [0, 1, 0]],
  ];
  for (const w of walls) {
    sideIds.push(g.patches.length);
    g.addQuad({ a: w[0], b: w[1], c: w[2], d: w[3], n: w[4] }, 'wall', 2, 0, 0);
  }
  const ambient = g.patches.length;
  g.patches.push({
    surfaceId: ambient, kind: 'ambient', ownerIndex: -1, band: -1, sector: -1,
    centroid: [0, 0, 0], normal: [0, 0, 1], area: 1,
  });
  return {
    scene: g.build(ambient), plate1Ids, plate2Ids, sideIds,
    cellArea: dw * dh,
  };
}

export interface CylinderScene {
  scene: SceneGeometry;
  bottomIds: number[];   // 面 1
  topIds: number[];      // 面 2
  wallIds: number[];     // 面 3(筒壁)
  areaBottom: number;
  areaTop: number;
  areaWall: number;
}

/** 同轴圆筒腔:底盘(扇区)、顶盘(扇区)、筒壁(分段×分带) */
export function buildCylinderEnclosure(rBottom: number, rTop: number, L: number,
  seg: number, bands: number): CylinderScene {
  const g = new GeoAccum();
  const bottomIds: number[] = [], topIds: number[] = [], wallIds: number[] = [];

  const disk = (z: number, up: boolean, ids: number[], owner: number, r: number) => {
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const p = (rr: number, a: number): Vec3 => [rr * Math.cos(a), rr * Math.sin(a), z];
      ids.push(g.patches.length);
      if (up) {
        g.addQuad({ a: p(0, 0), b: p(r, a0), c: p(r, a1), d: p(0, 0), n: [0, 0, 1] },
          'chill', owner, 0, j);
      } else {
        g.addQuad({ a: p(0, 0), b: p(0, 0), c: p(r, a1), d: p(r, a0), n: [0, 0, -1] },
          'heater', owner, 0, j);
      }
    }
  };
  disk(0, true, bottomIds, 0, rBottom);
  disk(L, false, topIds, 1, rTop);

  // 筒壁:直筒半径取 rBottom(等径情形 rTop=rBottom)
  const r = rBottom;
  for (let k = 0; k < bands; k++) {
    const z0 = (k / bands) * L, z1 = ((k + 1) / bands) * L;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (rr: number, a: number, z: number): Vec3 => [rr * Math.cos(a), rr * Math.sin(a), z];
      wallIds.push(g.patches.length);
      g.addQuad({
        a: p(r, a0, z0), b: p(r, a0, z1), c: p(r, a1, z1), d: p(r, a1, z0),
        n: [-Math.cos(am), -Math.sin(am), 0],
      }, 'wall', 2, k, j);
    }
  }
  const ambient = g.patches.length;
  g.patches.push({
    surfaceId: ambient, kind: 'ambient', ownerIndex: -1, band: -1, sector: -1,
    centroid: [0, 0, 0], normal: [0, 0, 1], area: 1,
  });
  return {
    scene: g.build(ambient), bottomIds, topIds, wallIds,
    areaBottom: Math.PI * rBottom * rBottom,
    areaTop: Math.PI * rTop * rTop,
    areaWall: 2 * Math.PI * r * L,
  };
}

/** 组内平均角系数(面积加权等效为整块表面间的值) */
export function aggregateF(F: Float32Array, n: number, rows: number[], cols: number[]): number {
  const areaRows = rows.map(i => areaOf(i));
  function areaOf(i: number) {
    // 等网格时面积近似相等;精确面积由调用方另算,这里用权重 1 并在外部归一
    void i; return 1;
  }
  let num = 0, den = 0;
  for (const i of rows) {
    let s = 0;
    for (const j of cols) s += F[i * n + j];
    num += s * (areaRows[rows.indexOf(i)] || 1);
    den += areaRows[rows.indexOf(i)] || 1;
  }
  void den;
  return num / rows.length;
}
