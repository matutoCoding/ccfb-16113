// 页面共享:把叶片/炉体几何送进查看器
import type { BladeDef, ClusterDef, FurnaceDef } from '../core/types';
import { generateBlade, generateFurnace, instanceTransform } from '../core/geometry';
import { SceneBuilder } from '../core/scene';
import { GLViewer, type ViewerMesh } from './viewer';
import { mat4Identity, mat4Scale, mat4Translation, mat4Multiply } from '../core/math';

export function bladeViewerMeshes(def: BladeDef, showShell: boolean, shellAlpha = false): ViewerMesh[] {
  const g = generateBlade(def);
  void shellAlpha;
  const meshes: ViewerMesh[] = [{
    mesh: showShell ? g.shellMesh : g.displayMesh,
    model: mat4Identity(),
    baseColor: showShell ? [0.72, 0.66, 0.5] : [0.55, 0.68, 0.85],
  }];
  return meshes;
}

export function clusterViewerMeshes(
  cluster: ClusterDef, blades: BladeDef[], showShell: boolean,
  collisionOwners: Set<number> = new Set(),
  colorByOwner?: Map<number, Float32Array>,
): ViewerMesh[] {
  const out: ViewerMesh[] = [];
  cluster.instances.forEach((inst, i) => {
    const def = blades.find(b => b.id === inst.bladeDefId)!;
    const g = generateBlade(def);
    const model = instanceTransform(inst.radius, inst.azimuth, inst.yaw, inst.tilt, inst.tiltDir);
    const collided = collisionOwners.has(i);
    out.push({
      mesh: showShell ? g.shellMesh : g.displayMesh,
      model,
      baseColor: collided ? [1, 0.25, 0.25] : showShell ? [0.72, 0.66, 0.5] : [0.55, 0.68, 0.85],
      colorByVertex: colorByOwner?.get(i),
    });
  });
  return out;
}

export function furnaceViewerMeshes(f: FurnaceDef): ViewerMesh[] {
  const fg = generateFurnace(f);
  return [{
    mesh: fg.mesh,
    model: mat4Identity(),
    baseColor: [0.85, 0.45, 0.3],
  }];
}

export function fullSceneMeshes(
  cluster: ClusterDef, blades: BladeDef[], furnace: FurnaceDef, displacement: number,
): ViewerMesh[] {
  const builder = new SceneBuilder(cluster, blades, furnace);
  const scene = builder.build(displacement);
  const pull = mat4Translation(0, 0, 0); // 位移已烘焙进场景
  void pull;
  const bladeMeshes = clusterViewerMeshes(cluster, blades, true);
  for (const m of bladeMeshes) {
    m.model = mat4Multiply(m.model, mat4Translation(0, 0, -displacement));
  }
  return [
    ...bladeMeshes,
    ...furnaceViewerMeshes(furnace).map(m => ({ ...m, model: mat4Multiply(mat4Scale(1, 1, 1), m.model) })),
    {
      mesh: {
        positions: scene.positions,
        normals: new Float32Array(scene.positions.length),
        indices: scene.indices,
      },
      model: mat4Identity(),
      baseColor: [0.5, 0.5, 0.5],
    },
  ];
}

export function attachViewer(canvas: HTMLCanvasElement): GLViewer {
  return new GLViewer(canvas);
}
