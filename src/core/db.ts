// IndexedDB 持久化:六类实体 + TypedArray 序列化
import type {
  BladeDef, ClusterDef, FurnaceDef, PourRecord, PullCurve, SimulationRun, ViewFactorMatrix,
} from './types';

const DB_NAME = 'dsf-radiation-db';
const DB_VERSION = 1;
export const STORES = ['blade', 'cluster', 'furnace', 'curve', 'sim', 'record'] as const;
export type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function put<T extends { id: string }>(store: StoreName, entity: T): Promise<void> {
  await tx(store, 'readwrite', s => s.put(encode(entity) as never));
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const raw = await tx<unknown>(store, 'readonly', s => s.get(id));
  return raw === undefined ? undefined : decode(raw) as T;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const raw = await tx<unknown[]>(store, 'readonly', s => s.getAll());
  return raw.map(d => decode(d) as T);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await tx(store, 'readwrite', s => s.delete(id));
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  await Promise.all(STORES.map(name => tx(name, 'readwrite', s => s.clear())));
  void db;
}

// ---------- TypedArray 编解码 ----------

interface Encoded { __ta?: { ctor: string; data: number[] }[]; [k: string]: unknown }

function encode(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_k, v) => {
    if (v instanceof Float32Array || v instanceof Uint32Array || v instanceof Int32Array) {
      return { __typed: true, ctor: v.constructor.name, data: Array.from(v as ArrayLike<number>) };
    }
    return v;
  }));
}

function decode(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  const o = obj as Record<string, unknown>;
  if (o.__typed === true && typeof o.ctor === 'string' && Array.isArray(o.data)) {
    switch (o.ctor) {
      case 'Float32Array': return new Float32Array(o.data as number[]);
      case 'Uint32Array': return new Uint32Array(o.data as number[]);
      case 'Int32Array': return new Int32Array(o.data as number[]);
    }
  }
  for (const k of Object.keys(o)) o[k] = decode(o[k]);
  return o;
}

// ---------- 业务便捷方法 ----------

export const db = {
  saveBlade: (b: BladeDef) => put('blade', b),
  listBlades: () => getAll<BladeDef>('blade'),
  saveCluster: (c: ClusterDef) => put('cluster', c),
  listClusters: () => getAll<ClusterDef>('cluster'),
  saveFurnace: (f: FurnaceDef) => put('furnace', f),
  listFurnaces: () => getAll<FurnaceDef>('furnace'),
  saveCurve: (c: PullCurve) => put('curve', c),
  listCurves: () => getAll<PullCurve>('curve'),
  saveRun: (r: SimulationRun) => put('sim', r),
  listRuns: () => getAll<SimulationRun>('sim'),
  saveRecord: (r: PourRecord) => put('record', r),
  listRecords: () => getAll<PourRecord>('record'),
  remove,
};

/** 角系数矩阵导出 CSV:面片 id 行列头 */
export function matrixToCSV(vf: ViewFactorMatrix, patchLabels: string[]): string {
  const n = vf.sourceIds.length;
  const lines: string[] = [];
  lines.push(',' + vf.sourceIds.map((_, j) => patchLabels[j] ?? `P${j}`).join(','));
  for (let i = 0; i < n; i++) {
    const row: string[] = [patchLabels[i] ?? `P${i}`];
    for (let j = 0; j < n; j++) row.push(vf.rows[i * n + j].toExponential(6));
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
