// 场景装配:叶片模壳实例 + 炉体 -> 单缓冲 SceneGeometry;碰撞检测
import type {
  BladeDef, BladeInstance, ClusterDef, FurnaceDef, Mesh, PatchInfo, Vec3,
} from './types';
import {
  generateBlade, generateFurnace, instanceTransform, transformDir, transformPoint,
  type GeneratedBlade,
} from './geometry';
import type { SceneGeometry } from './hemicube';
import { v3 } from './math';

export interface CollisionInfo {
  a: number;
  b: number;
  minGap: number;   // 负=干涉量
  location: Vec3;
}

export class SceneBuilder {
  bladeCache = new Map<string, GeneratedBlade>();
  furnaceGeo: ReturnType<typeof generateFurnace>;
  furnace: FurnaceDef;

  constructor(public cluster: ClusterDef, public blades: BladeDef[], furnace: FurnaceDef) {
    this.furnace = furnace;
    this.furnaceGeo = generateFurnace(furnace);
  }

  bladeGeometry(def: BladeDef): GeneratedBlade {
    let g = this.bladeCache.get(def.id);
    if (!g) {
      g = generateBlade(def);
      this.bladeCache.set(def.id, g);
    }
    return g;
  }

  /** 碰撞检测:用模壳圆柱包围体做粗检,再对最近面片做精检 */
  checkCollisions(): CollisionInfo[] {
    const out: CollisionInfo[] = [];
    const inst = this.cluster.instances;
    const placed = inst.map((it) => {
      const def = this.blades.find(b => b.id === it.bladeDefId)!;
      const g = this.bladeGeometry(def);
      const m = instanceTransform(it.radius, it.azimuth, it.yaw, it.tilt, it.tiltDir);
      const center = transformPoint(m, [0, 0, g.height / 2]);
      return { it, g, m, center, r: g.boundRadius, h: g.height };
    });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j];
        const d = Math.hypot(A.center[0] - B.center[0], A.center[1] - B.center[1]);
        const zOverlap = Math.min(A.center[2] + A.h / 2, B.center[2] + B.h / 2)
          - Math.max(A.center[2] - A.h / 2, B.center[2] - B.h / 2);
        if (zOverlap <= 0) continue;
        const gap = d - (A.r + B.r);
        if (gap < 0.02) {
          const loc: Vec3 = [
            (A.center[0] + B.center[0]) / 2,
            (A.center[1] + B.center[1]) / 2,
            Math.min(A.center[2], B.center[2]),
          ];
          out.push({ a: i, b: j, minGap: gap, location: loc });
        }
      }
    }
    return out;
  }

  /** 构造指定抽拉位移下的辐射场景 */
  build(displacement: number): SceneGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const triPatch: number[] = [];
    const patches: PatchInfo[] = [];
    let vertexBase = 0;

    const appendMesh = (mesh: Mesh, mat: Float32Array | null, kind: PatchInfo['kind'],
      ownerIndex: number, zOffset: number, localPatches: GeneratedBlade['patches'] | null) => {
      const base = patches.length;
      const nVerts = mesh.positions.length / 3;
      for (let v = 0; v < nVerts; v++) {
        let p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2] - zOffset];
        let n: Vec3 = [mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]];
        if (mat) {
          p = transformPoint(mat, p);
          n = transformDir(mat, n);
        }
        positions.push(p[0], p[1], p[2]);
        void n;
      }
      // 法线以面片为准(局部 patches 里有),顶点法线仅显示用
      for (let t = 0; t < mesh.indices.length / 3; t++) {
        indices.push(
          vertexBase + mesh.indices[t * 3],
          vertexBase + mesh.indices[t * 3 + 1],
          vertexBase + mesh.indices[t * 3 + 2],
        );
        const localId = mesh.triPatch ? mesh.triPatch[t] : t;
        triPatch.push(base + localId);
      }
      if (localPatches) {
        for (const lp of localPatches) {
          let cen = lp.centroid, nrm = lp.normal;
          if (mat) {
            cen = transformPoint(mat, [lp.centroid[0], lp.centroid[1], lp.centroid[2] - zOffset]);
            nrm = transformDir(mat, lp.normal);
          }
          patches.push({
            surfaceId: base + lp.id,
            kind, ownerIndex, part: lp.part, band: lp.band, sector: lp.sector,
            centroid: cen, normal: nrm, area: lp.area,
          });
        }
      }
      vertexBase += nVerts;
    };

    // 1. 各叶片模壳(抽拉:整体 z 减 displacement)
    this.cluster.instances.forEach((it: BladeInstance, idx: number) => {
      const def = this.blades.find(b => b.id === it.bladeDefId)!;
      const g = this.bladeGeometry(def);
      const mat = instanceTransform(it.radius, it.azimuth, it.yaw, it.tilt, it.tiltDir);
      appendMesh(g.shellMesh, mat, 'shell', idx, displacement, g.patches);
    });

    // 2. 炉体(静止)
    const fg = this.furnaceGeo;
    const kindById = new Map<number, PatchInfo['kind']>();
    const ownerById = new Map<number, number>();
    fg.ranges.heater.forEach(r => {
      for (let i = 0; i < r.count; i++) {
        kindById.set(r.idBase + i, 'heater');
        ownerById.set(r.idBase + i, r.zone);
      }
    });
    for (let i = 0; i < fg.ranges.baffle.count; i++) {
      kindById.set(fg.ranges.baffle.idBase + i, 'baffle');
      ownerById.set(fg.ranges.baffle.idBase + i, 0);
    }
    for (let i = 0; i < fg.ranges.chill.count; i++) {
      kindById.set(fg.ranges.chill.idBase + i, 'chill');
      ownerById.set(fg.ranges.chill.idBase + i, 0);
    }
    for (let i = 0; i < fg.ranges.wall.count; i++) {
      kindById.set(fg.ranges.wall.idBase + i, 'wall');
      ownerById.set(fg.ranges.wall.idBase + i, 0);
    }
    const furnaceBase = patches.length;
    appendMesh(fg.mesh, null, 'wall', 0, 0, fg.patches);
    for (let k = 0; k < fg.patches.length; k++) {
      const p = patches[furnaceBase + k];
      p.kind = kindById.get(k) ?? 'wall';
      p.ownerIndex = ownerById.get(k) ?? 0;
    }

    // 3. 环境兜底面片(不参与渲染,承接未命中射线)
    const ambientIndex = patches.length;
    patches.push({
      surfaceId: ambientIndex,
      kind: 'ambient', ownerIndex: -1, band: -1, sector: -1,
      centroid: [0, 0, 0], normal: [0, 0, 1], area: 1,
    });

    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      triPatch: new Uint32Array(triPatch),
      patches,
      ambientPatchIndex: ambientIndex,
    };
  }
}

/** 叶片周向四列归并:sector 角平均方向 -> inner(朝炉心)/outer/left/right */
export function classifyColumn(normalWorld: Vec3, instanceAzimuth: number): 0 | 1 | 2 | 3 {
  // 叶片在半径 R 方位 az 处,朝炉心方向 = -(cos az, sin az)
  const inward: Vec3 = [-Math.cos(instanceAzimuth), -Math.sin(instanceAzimuth), 0];
  const tang: Vec3 = [-Math.sin(instanceAzimuth), Math.cos(instanceAzimuth), 0];
  const dn = v3.dot(normalWorld, inward);
  const dt = v3.dot(normalWorld, tang);
  if (Math.abs(dn) >= Math.abs(dt)) return dn > 0 ? 0 : 1; // inner : outer
  return dt > 0 ? 2 : 3; // left : right
}
