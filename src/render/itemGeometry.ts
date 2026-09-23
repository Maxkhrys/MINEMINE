import * as THREE from 'three';
import { B, blockDef } from '../world/blocks';
import { FLAG_EMISSIVE, FLAG_PLANT, FLAG_TINT } from '../world/mesher';

/**
 * Stand-alone geometry for a single block (used for the held item), with the same
 * vertex attributes as chunk meshes so it can share the terrain materials.
 * The block is centred on the origin with unit size.
 */
export function buildItemGeometry(id: number): THREE.BufferGeometry {
  const def = blockDef(id);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const data: number[] = [];
  const idx: number[] = [];
  const quad = (corners: number[][], n: number[], layer: number, flags: number) => {
    const b = pos.length / 3;
    const uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let i = 0; i < 4; i++) {
      pos.push(def.box[0] + corners[i][0]*(def.box[3]-def.box[0]) - .5, def.box[1] + corners[i][1]*(def.box[4]-def.box[1]) - .5, def.box[2] + corners[i][2]*(def.box[5]-def.box[2]) - .5);
      nor.push(n[0] * 127, n[1] * 127, n[2] * 127);
      uv.push(uvs[i][0] * 255, uvs[i][1] * 255);
      data.push(layer, 255, 255, flags);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };

  if (def.render === 'plant') {
    const flags = FLAG_PLANT | (def.tint ? FLAG_TINT : 0);
    quad(
      [
        [0, 0, 0.5],
        [1, 0, 0.5],
        [1, 1, 0.5],
        [0, 1, 0.5],
      ],
      [0, 0, 1],
      def.faces[0],
      flags,
    );
  } else {
    // +X, -X, +Y, -Y, +Z, -Z with the same corner order as the chunk mesher.
    const faces: [number[][], number[]][] = [
      [[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [1, 0, 0]],
      [[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [-1, 0, 0]],
      [[[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [0, 1, 0]],
      [[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, -1, 0]],
      [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1]],
      [[[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], [0, 0, -1]],
    ];
    faces.forEach(([corners, n], f) => {
      let flags = 0;
      if (def.tint && (id !== B.GRASS || f === 2)) flags |= FLAG_TINT;
      if (def.emissive) flags |= FLAG_EMISSIVE;
      quad(corners, n, def.faces[f], flags);
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nor), 3, true));
  g.setAttribute('aUv', new THREE.BufferAttribute(new Uint8Array(uv), 2, true));
  g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array(data), 4, false));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

