/** Horizontal size of a chunk column, in blocks. */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
/** Total world height. The column is split into 16-block tall sections for meshing. */
export const WORLD_HEIGHT = 128;
export const SECTION_SIZE = 16;
export const SECTION_COUNT = WORLD_HEIGHT / SECTION_SIZE;
export const COLUMN_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const SEA_LEVEL = 46;

/** Index into a column's block array. Layout is y-major so each section is contiguous. */
export function columnIndex(lx: number, y: number, lz: number): number {
  return (y << 8) | (lz << 4) | lx;
}

/** Stable numeric key for a chunk column (valid for |cx|,|cz| < 32768). */
export function columnKey(cx: number, cz: number): number {
  return (((cx & 0xffff) << 16) | (cz & 0xffff)) >>> 0;
}
