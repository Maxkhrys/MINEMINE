/// <reference lib="webworker" />
import { TerrainGenerator, type SpawnPoint } from './generator';

type InMsg =
  | { type: 'init'; worldId: number; seed: number; spawn: SpawnPoint }
  | { type: 'gen'; worldId: number; cx: number; cz: number };

let gen: TerrainGenerator | null = null;
let currentWorld = -1;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new TerrainGenerator(msg.seed, msg.spawn);
    currentWorld = msg.worldId;
    return;
  }
  if (msg.type === 'gen') {
    if (!gen || msg.worldId !== currentWorld) {
      (self as unknown as Worker).postMessage({ type: 'skip', worldId: msg.worldId, cx: msg.cx, cz: msg.cz });
      return;
    }
    const blocks = gen.generateColumn(msg.cx, msg.cz);
    (self as unknown as Worker).postMessage({ type: 'chunk', worldId: msg.worldId, cx: msg.cx, cz: msg.cz, blocks }, [blocks.buffer]);
  }
};
