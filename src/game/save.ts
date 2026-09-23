import type { SpawnPoint } from '../world/generator';
import type { GameMode } from './Inventory';

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
}

export interface SaveData {
  version: 1;
  seed: number;
  seedText: string;
  mode: GameMode;
  spawn: SpawnPoint;
  createdAt: number;
  player: PlayerSave | null;
  inventory: { slots: ([number, number] | null)[]; selected: number } | null;
  /** Column key → flat list of [column index, block id] pairs. */
  edits: Record<string, number[]>;
}

const KEY = 'minemine.world.v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1 || typeof data.seed !== 'number' || !data.spawn) return null;
    if (data.mode !== 'survival' && data.mode !== 'creative') data.mode = 'survival';
    data.edits = data.edits && typeof data.edits === 'object' ? data.edits : {};
    return data;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store the data (quota or privacy mode). */
export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function editsToRecord(edits: Map<number, Map<number, number>>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [key, m] of edits) {
    if (m.size === 0) continue;
    const arr: number[] = [];
    for (const [idx, id] of m) arr.push(idx, id);
    out[String(key)] = arr;
  }
  return out;
}

export function recordToEdits(rec: Record<string, number[]>): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const [k, arr] of Object.entries(rec)) {
    const key = Number(k);
    if (!Number.isFinite(key) || !Array.isArray(arr)) continue;
    const m = new Map<number, number>();
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const idx = arr[i];
      const id = arr[i + 1];
      if (Number.isInteger(idx) && idx >= 0 && idx < 16 * 16 * 128 && Number.isInteger(id) && id >= 0 && id < 256) m.set(idx, id);
    }
    out.set(key, m);
  }
  return out;
}
