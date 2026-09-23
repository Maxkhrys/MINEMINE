import * as THREE from 'three';
import { SECTION_SIZE } from '../world/constants';
import type { GeometryBuffers, SectionGeometry } from '../world/mesher';
import type { SectionSink } from '../world/ChunkManager';
import type { Column, SectionMeshes } from '../world/World';

export interface TerrainMaterials {
  solid: THREE.Material;
  cutout: THREE.Material;
  water: THREE.Material;
  cutoutDepth: THREE.Material;
}

const SECTION_SPHERE_RADIUS = Math.sqrt(3) * (SECTION_SIZE / 2) + 1;

/** Turns mesher output into three.js meshes: at most three draw calls per 16³ section. */
export class ChunkRenderer implements SectionSink {
  readonly group = new THREE.Group();
  meshCount = 0;
  triangleCount = 0;

  constructor(private materials: TerrainMaterials) {
    this.group.name = 'terrain';
  }

  private makeGeometry(buf: GeometryBuffers): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3, true));
    g.setAttribute('aUv', new THREE.BufferAttribute(buf.uvs, 2, true));
    g.setAttribute('aData', new THREE.BufferAttribute(buf.data, 4, false));
    g.setIndex(new THREE.BufferAttribute(buf.indices, 1));
    // Every section fits in the same sphere; skip the per-vertex bounds computation.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(SECTION_SIZE / 2, SECTION_SIZE / 2, SECTION_SIZE / 2), SECTION_SPHERE_RADIUS);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(SECTION_SIZE + 1, SECTION_SIZE + 1, SECTION_SIZE + 1));
    return g;
  }

  private place(
    slot: THREE.Mesh | null,
    buf: GeometryBuffers | null,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    kind: 'solid' | 'cutout' | 'water',
  ): THREE.Mesh | null {
    if (slot) {
      this.triangleCount -= (slot.geometry.index?.count ?? 0) / 3;
      slot.geometry.dispose();
    }
    if (!buf) {
      if (slot) {
        this.group.remove(slot);
        this.meshCount--;
      }
      return null;
    }
    const geo = this.makeGeometry(buf);
    this.triangleCount += buf.indices.length / 3;
    if (slot) {
      slot.geometry = geo;
      return slot;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = kind !== 'water';
    mesh.receiveShadow = true;
    if (kind === 'cutout') mesh.customDepthMaterial = this.materials.cutoutDepth;
    if (kind === 'water') mesh.renderOrder = 2;
    this.group.add(mesh);
    this.meshCount++;
    return mesh;
  }

  applySection(col: Column, sy: number, geometry: SectionGeometry): void {
    const x = col.cx * 16;
    const y = sy * SECTION_SIZE;
    const z = col.cz * 16;
    let slot: SectionMeshes | null = col.meshes[sy];
    if (!slot) {
      if (!geometry.solid && !geometry.cutout && !geometry.water) return;
      slot = { solid: null, cutout: null, water: null };
      col.meshes[sy] = slot;
    }
    slot.solid = this.place(slot.solid, geometry.solid, this.materials.solid, x, y, z, 'solid');
    slot.cutout = this.place(slot.cutout, geometry.cutout, this.materials.cutout, x, y, z, 'cutout');
    slot.water = this.place(slot.water, geometry.water, this.materials.water, x, y, z, 'water');
    if (!slot.solid && !slot.cutout && !slot.water) col.meshes[sy] = null;
  }

  disposeColumn(col: Column): void {
    for (let sy = 0; sy < col.meshes.length; sy++) {
      const slot = col.meshes[sy];
      if (!slot) continue;
      slot.solid = this.place(slot.solid, null, this.materials.solid, 0, 0, 0, 'solid');
      slot.cutout = this.place(slot.cutout, null, this.materials.cutout, 0, 0, 0, 'cutout');
      slot.water = this.place(slot.water, null, this.materials.water, 0, 0, 0, 'water');
      col.meshes[sy] = null;
    }
  }
}
