// 全局应用状态与数据加载
import type { BladeDef, ClusterDef, FurnaceDef, PourRecord, PullCurve, SimulationRun } from '../core/types';
import { db } from '../core/db';
import {
  defaultBlade, defaultCluster, defaultFurnace, defaultPullCurve, demoPourRecord,
} from '../core/defaults';

export interface AppState {
  blades: BladeDef[];
  clusters: ClusterDef[];
  furnaces: FurnaceDef[];
  curves: PullCurve[];
  runs: SimulationRun[];
  records: PourRecord[];
  selectedBladeId: string;
  selectedClusterId: string;
  selectedFurnaceId: string;
  selectedRunId: string;
  ready: boolean;
}

export const state: AppState = {
  blades: [], clusters: [], furnaces: [], curves: [], runs: [], records: [],
  selectedBladeId: '', selectedClusterId: '', selectedFurnaceId: '', selectedRunId: '',
  ready: false,
};

export async function bootstrap(): Promise<void> {
  state.blades = await db.listBlades();
  state.clusters = await db.listClusters();
  state.furnaces = await db.listFurnaces();
  state.curves = await db.listCurves();
  state.runs = await db.listRuns();
  state.records = await db.listRecords();

  if (!state.blades.length) {
    const b = defaultBlade();
    await db.saveBlade(b);
    state.blades = [b];
  }
  if (!state.clusters.length) {
    const c = defaultCluster(state.blades[0].id);
    await db.saveCluster(c);
    state.clusters = [c];
  }
  if (!state.furnaces.length) {
    const f = defaultFurnace();
    await db.saveFurnace(f);
    state.furnaces = [f];
  }
  if (!state.curves.length) {
    const cu = defaultPullCurve();
    await db.saveCurve(cu);
    state.curves = [cu];
  }
  if (!state.records.length) {
    const r = demoPourRecord(state.clusters[0].id, state.furnaces[0].id, state.curves[0].id);
    await db.saveRecord(r);
    state.records = [r];
  }
  state.selectedBladeId = state.blades[0].id;
  state.selectedClusterId = state.clusters[0].id;
  state.selectedFurnaceId = state.furnaces[0].id;
  state.ready = true;
}

export function currentBlade(): BladeDef {
  return state.blades.find(b => b.id === state.selectedBladeId) ?? state.blades[0];
}
export function currentCluster(): ClusterDef {
  return state.clusters.find(c => c.id === state.selectedClusterId) ?? state.clusters[0];
}
export function currentFurnace(): FurnaceDef {
  return state.furnaces.find(f => f.id === state.selectedFurnaceId) ?? state.furnaces[0];
}
export function currentRun(): SimulationRun | undefined {
  return state.runs.find(r => r.id === state.selectedRunId);
}
