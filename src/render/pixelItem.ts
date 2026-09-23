import * as THREE from 'three';

/** Extrudes the original pixel art. Hidden pixel edges are omitted. */
export function pixelItemGeometry(canvas: HTMLCanvasElement): THREE.BufferGeometry {
  const { width: w, height: h } = canvas;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const pos: number[] = [], normals: number[] = [], colors: number[] = [];
  const color = new THREE.Color();
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && pixels[(y * w + x) * 4 + 3] > 127;
  const faces = [
    { n: [0,0,1], d: [0,0], p: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
    { n: [0,0,-1], d: [0,0], p: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
    { n: [-1,0,0], d: [-1,0], p: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
    { n: [1,0,0], d: [1,0], p: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
    { n: [0,1,0], d: [0,-1], p: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
    { n: [0,-1,0], d: [0,1], p: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  ];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x,y)) continue;
    const i = (y * w + x) * 4;
    color.setRGB(pixels[i] / 255, pixels[i+1] / 255, pixels[i+2] / 255, THREE.SRGBColorSpace);
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      if (f > 1 && solid(x + face.d[0], y + face.d[1])) continue;
      for (const v of [0,1,2,0,2,3]) {
        const p = face.p[v];
        pos.push((x+p[0])/w-.5, .5-(y+1-p[1])/h, (p[2]-.5)*.065);
        normals.push(...face.n); colors.push(color.r,color.g,color.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geo.computeBoundingSphere();
  return geo;
}
