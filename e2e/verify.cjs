/**
 * End-to-end verification in a real (headless) Chromium.
 *
 *   npm run dev            # in one terminal
 *   npm run verify         # in another (needs `npx playwright install chromium` once)
 *
 * Drives the game through real mouse and keyboard events on the canvas (the pointer
 * lock is simulated with the ?debug hook) and checks movement, collision, targeting,
 * reach, placement, chunk-border rebuilds, persistence, every graphics preset and the
 * console. Screenshots land in e2e/screenshots/.
 */
const fs = require('fs');
const { chromium } = require('playwright');
fs.mkdirSync('e2e/screenshots', { recursive: true });
async function open(opts = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(opts.url || process.env.URL || 'http://localhost:5173/?debug', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__minemine?.state === 'menu', null, { timeout: 120000 });
  return { browser, context, page, logs };
};
const waitMenu = (page) => page.waitForFunction(() => window.__minemine?.state === 'menu', null, { timeout: 120000 });
const settings = async (page, s) => page.evaluate((s) => { const g = window.__minemine; Object.assign(g.settings, s); g.applySettings(g.settings); }, s);
const HIGH = { renderDistance: 6, resolutionScale: 1, shadows: 'high', postprocessing: true, ssao: true, bloom: true, antialias: true, clouds: true };
const LOW = { renderDistance: 4, resolutionScale: 1, shadows: 'off', postprocessing: false, ssao: false, bloom: false, antialias: false, clouds: false };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

(async () => {
  const { browser, page, logs } = await open();
  // Fixed seed, creative so we can hover while testing geometry.
  await page.evaluate(() => window.__minemine.startWorld(424242, 'verify', 'creative', null));
  await waitMenu(page);
  await settings(page, LOW);
  await page.evaluate(() => { window.__minemine.input.forceLocked = true; });
  await page.click('#play-btn');
  await frames(page, 3);
  check('Play button enters playing state', (await page.evaluate(() => window.__minemine.state)) === 'playing');

  // Helpers inside the page.
  await page.evaluate(() => {
    const g = window.__minemine;
    window.T = {
      g,
      pose(x, y, z, yaw, pitch, fly = true) { const p = g.player; p.flying = fly; p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0; p.yaw = yaw; p.pitch = pitch; },
      set(x, y, z, id) { g.world.setBlock(x, y, z, id); g.chunks.flushUrgent(); },
      get(x, y, z) { return g.world.getBlock(x, y, z); },
      fill(x0, y0, z0, x1, y1, z1, id) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g.world.setBlock(x, y, z, id); g.chunks.flushUrgent(); },
      snap(x0, y0, z0, x1, y1, z1) { const a = []; for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) a.push([x, y, z, g.world.getBlock(x, y, z)]); return a; },
      target() { const t = g.target; return t ? { x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, t: t.t, id: t.id } : null; },
      outline() { const o = g.renderer.selection.outline; return o.visible ? [o.position.x, o.position.y, o.position.z] : null; },
    };
  });

  // ---------- 1. movement, jump, collision, look
  const spawnInfo = await page.evaluate(() => { const p = T.g.player; p.flying = false; return { x: p.x, y: p.y, z: p.z }; });
  await page.evaluate(() => { const p = T.g.player; p.yaw = 0; p.pitch = 0; });
  await frames(page, 20);
  const grounded = await page.evaluate(() => T.g.player.onGround);
  check('Player spawns standing on terrain', grounded, JSON.stringify(spawnInfo));
  // Build a clean test pad around spawn so walking is deterministic.
  await page.evaluate(({ x, y, z }) => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    T.fill(fx - 6, fy, fz - 6, fx + 6, fy + 4, fz + 6, 0);
    T.fill(fx - 6, fy - 1, fz - 6, fx + 6, fy - 1, fz + 6, 9);
    T.fill(fx - 2, fy, fz - 5, fx + 2, fy + 2, fz - 5, 11); // wall to the north (-Z)
    T.pose(fx + 0.5, fy, fz + 0.5, 0, 0, false);
  }, spawnInfo);
  await frames(page, 10);
  const before = await page.evaluate(() => ({ x: T.g.player.x, z: T.g.player.z }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await frames(page, 5);
  const after = await page.evaluate(() => { const p = T.g.player; return { x: p.x, z: p.z, b: p.bounds() }; });
  const moved = before.z - after.z;
  check('W moves the player forward', moved > 1.5, `moved ${moved.toFixed(2)} blocks`);
  const wallZ = Math.floor(spawnInfo.z) - 5 + 1; // south face of wall
  check('Collision stops the player at the wall face', Math.abs(after.b[2] - wallZ) < 0.01 && after.b[2] >= wallZ - 1e-6, `player minZ ${after.b[2].toFixed(4)} vs wall face ${wallZ}`);
  // Jump
  const y0 = await page.evaluate(() => T.g.player.y);
  let maxY = y0;
  await page.keyboard.down('Space');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(60); maxY = Math.max(maxY, await page.evaluate(() => T.g.player.y)); }
  await page.keyboard.up('Space');
  await page.waitForTimeout(900);
  const y1 = await page.evaluate(() => T.g.player.y);
  check('Space jumps about 1.3 blocks and lands again', maxY - y0 > 1.0 && maxY - y0 < 1.6 && Math.abs(y1 - y0) < 0.01, `peak +${(maxY - y0).toFixed(2)}, back to ${(y1 - y0).toFixed(3)}`);
  // Mouse look (real mousemove events, movementX from successive positions)
  const yawA = await page.evaluate(() => T.g.player.yaw);
  await page.mouse.move(640, 360);
  await page.mouse.move(700, 360, { steps: 5 });
  await frames(page, 2);
  const yawB = await page.evaluate(() => T.g.player.yaw);
  check('Mouse movement turns the camera', Math.abs(yawB - yawA) > 0.01, `yaw ${yawA.toFixed(3)} → ${yawB.toFixed(3)}`);

  // ---------- test arena in the sky
  const A = { x: -40, y: 100, z: -40 }; // negative coords, spans chunk border at x=-32/-48? use -33..-31
  await page.evaluate((A) => { T.g.player.flying = true; T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0); }, A);

  // ---------- 2. outline == mining target (many random rays at a cluttered block field)
  await page.evaluate((A) => {
    // Random blocks scattered around the camera.
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 700; i++) {
      const x = A.x - 6 + Math.floor(r() * 13), y = A.y - 6 + Math.floor(r() * 13), z = A.z - 6 + Math.floor(r() * 13);
      if (Math.abs(x - A.x) <= 1 && Math.abs(z - A.z) <= 1 && y >= A.y - 1 && y <= A.y + 2) continue;
      T.g.world.setBlock(x, y, z, [3, 4, 9, 11, 10, 2][i % 6]);
    }
    T.g.chunks.flushUrgent();
  }, A);
  let same = 0, total = 0, onlyOne = 0, noHit = 0, detail = '';
  for (let i = 0; i < 60; i++) {
    const yaw = (i * 2.399) % (Math.PI * 2), pitch = Math.sin(i * 1.3) * 1.2;
    await page.evaluate(([A, yaw, pitch]) => T.pose(A.x + 0.5, A.y, A.z + 0.5, yaw, pitch), [A, yaw, pitch]);
    await frames(page, 2);
    const t = await page.evaluate(() => ({ t: T.target(), o: T.outline() }));
    if (!t.t) { noHit++; continue; }
    total++;
    const box = t.t.id === 18 ? [0.5, 0.4, 0.5] : [0.5, 0.5, 0.5];
    if (t.o && Math.abs(t.o[0] - (t.t.x + box[0])) < 1e-6 && Math.abs(t.o[1] - (t.t.y + box[1])) < 1e-6 && Math.abs(t.o[2] - (t.t.z + box[2])) < 1e-6) same++;
    const snapBefore = await page.evaluate((A) => T.snap(A.x - 7, A.y - 7, A.z - 7, A.x + 7, A.y + 7, A.z + 7), A);
    await page.mouse.down({ button: 'left' });
    await frames(page, 1);
    await page.mouse.up({ button: 'left' });
    await frames(page, 1);
    const snapAfter = await page.evaluate((A) => T.snap(A.x - 7, A.y - 7, A.z - 7, A.x + 7, A.y + 7, A.z + 7), A);
    const changed = snapAfter.filter((c, k) => c[3] !== snapBefore[k][3]);
    if (changed.length === 1 && changed[0][0] === t.t.x && changed[0][1] === t.t.y && changed[0][2] === t.t.z && changed[0][3] === 0) onlyOne++;
    else if (!detail) detail = `target ${JSON.stringify(t.t)} changed ${JSON.stringify(changed)}`;
    // restore for next ray
    await page.evaluate(([c]) => { if (c) T.set(c[0], c[1], c[2], c[3]); }, [snapBefore.find((c) => c[0] === t.t.x && c[1] === t.t.y && c[2] === t.t.z)]);
  }
  check('Outline sits on the raycast target every time', same === total && total >= 30, `${same}/${total} (${noHit} rays hit nothing)`);
  check('Each click mines exactly the outlined block and nothing else', onlyOne === total, `${onlyOne}/${total} ${detail}`);

  // ---------- 3. reach 4.5
  await page.evaluate((A) => T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0), A);
  const reach = [];
  for (const d of [4.4, 4.5, 4.6, 5.5]) {
    const r = await page.evaluate(([A, d]) => {
      // Camera eye at (A.x+0.5, A.y+1.62, A.z+0.5), looking along +X; block face at x = eye.x + d.
      const eyeX = A.x + 0.5; const faceX = Math.ceil(eyeX + d - 1e-9);
      const camX = faceX - d; // eye x so that face is exactly d away
      T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
      T.set(faceX, A.y + 1, A.z, 3);
      T.pose(camX, A.y, A.z + 0.5, -Math.PI / 2, 0);
      return faceX;
    }, [A, d]);
    await frames(page, 2);
    const t = await page.evaluate(() => T.target());
    await page.mouse.down(); await frames(page, 1); await page.mouse.up(); await frames(page, 1);
    const still = await page.evaluate(([A, fx]) => T.get(fx, A.y + 1, A.z), [A, r]);
    reach.push({ d, targeted: !!t, dist: t && t.t, mined: still === 0 });
  }
  check('Blocks within 4.5 are targetable and mineable', reach[0].targeted && reach[0].mined && reach[1].targeted && reach[1].mined, JSON.stringify(reach.slice(0, 2)));
  check('Blocks beyond 4.5 cannot be targeted or mined', !reach[2].targeted && !reach[2].mined && !reach[3].targeted && !reach[3].mined, JSON.stringify(reach.slice(2)));

  // ---------- 4. no mining through nearer block (including a grazing corner ray)
  const through = await page.evaluate((A) => {
    T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
    T.set(A.x + 2, A.y + 1, A.z, 2);
    T.set(A.x + 3, A.y + 1, A.z, 3);
    T.pose(A.x + 0.5, A.y, A.z + 0.5, -Math.PI / 2, 0);
    return true;
  }, A);
  await frames(page, 2);
  const tn = await page.evaluate(() => T.target());
  await page.mouse.down(); await frames(page, 1); await page.mouse.up(); await frames(page, 1);
  const nb = await page.evaluate((A) => [T.get(A.x + 2, A.y + 1, A.z), T.get(A.x + 3, A.y + 1, A.z)], A);
  check('Mining hits the nearer block, not the one behind it', through && tn && tn.x === A.x + 2 && nb[0] === 0 && nb[1] === 3, `target ${JSON.stringify(tn)} after ${JSON.stringify(nb)}`);
  // Grazing corner: two blocks diagonal, ray just past the corner of the near one.
  await page.evaluate((A) => {
    T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
    T.set(A.x + 2, A.y + 1, A.z, 2);     // near block
    T.set(A.x + 3, A.y + 1, A.z + 1, 3); // far block, diagonal behind the near block's corner
    const ex = A.x + 0.5, ez = A.z + 0.5;
    // Aim at the near block's corner (A.x+3, A.z+1) from the eye, nudged inside the near block.
    const dx = (A.x + 3) - ex, dz = (A.z + 1) - 0.001 - ez;
    T.pose(ex, A.y, ez, Math.atan2(-dx, -dz), 0);
  }, A);
  await frames(page, 2);
  const tc = await page.evaluate(() => T.target());
  await page.mouse.down(); await frames(page, 1); await page.mouse.up(); await frames(page, 1);
  const nc = await page.evaluate((A) => [T.get(A.x + 2, A.y + 1, A.z), T.get(A.x + 3, A.y + 1, A.z + 1)], A);
  check('Rays grazing a corner still pick the first block they enter', tc && tc.x === A.x + 2 && tc.z === A.z && nc[0] === 0 && nc[1] === 3, `target ${JSON.stringify(tc)} after ${JSON.stringify(nc)}`);

  // ---------- 5. placement on each face + never inside the player
  const faces = [
    ['east face (+X)', [1, 0, 0]], ['west face (-X)', [-1, 0, 0]], ['north face (-Z)', [0, 0, -1]], ['south face (+Z)', [0, 0, 1]], ['top face (+Y)', [0, 1, 0]], ['bottom face (-Y)', [0, -1, 0]],
  ];
  let placedOk = 0; let placeDetail = '';
  for (const [name, n] of faces) {
    const res = await page.evaluate(([A, n]) => {
      T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
      const b = [A.x, A.y + 4, A.z];
      T.set(b[0], b[1], b[2], 3);
      // Stand 3 blocks away along the face normal (plus a little offset) and look at the face centre.
      const fc = [b[0] + 0.5 + n[0] * 0.5, b[1] + 0.5 + n[1] * 0.5, b[2] + 0.5 + n[2] * 0.5];
      const eye = [fc[0] + n[0] * 3 + 0.21, fc[1] + n[1] * 3 + 0.13, fc[2] + n[2] * 3 - 0.17];
      const dx = fc[0] - eye[0], dy = fc[1] - eye[1], dz = fc[2] - eye[2];
      T.pose(eye[0], eye[1] - 1.62, eye[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      T.g.inventory.selected = 1; // stone
      return b;
    }, [A, n]);
    await frames(page, 2);
    const t = await page.evaluate(() => T.target());
    await page.mouse.down({ button: 'right' }); await frames(page, 1); await page.mouse.up({ button: 'right' }); await frames(page, 1);
    const got = await page.evaluate(([b, n]) => ({ at: T.get(b[0] + n[0], b[1] + n[1], b[2] + n[2]), others: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].filter(o => o.join() !== n.join()).map(o => T.get(b[0]+o[0], b[1]+o[1], b[2]+o[2])) }), [res, n]);
    const ok = t && t.nx === n[0] && t.ny === n[1] && t.nz === n[2] && got.at !== 0 && got.others.every((v) => v === 0);
    if (ok) placedOk++; else if (!placeDetail) placeDetail = `${name}: target ${JSON.stringify(t)} result ${JSON.stringify(got)}`;
  }
  check('Right click places on the face that was hit (all 6 faces)', placedOk === 6, placeDetail || '6/6');
  // Inside the player: look straight down at the block under the feet, and at head level.
  const inside = await page.evaluate((A) => {
    T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
    T.set(A.x, A.y - 1, A.z, 3);
    T.pose(A.x + 0.5, A.y, A.z + 0.5, 0, -Math.PI / 2 + 0.01, false);
    return true;
  }, A);
  await frames(page, 3);
  const tdown = await page.evaluate(() => T.target());
  await page.mouse.down({ button: 'right' }); await frames(page, 1); await page.mouse.up({ button: 'right' }); await frames(page, 2);
  const cellFeet = await page.evaluate((A) => T.get(A.x, A.y, A.z), A);
  // Straddling two cells: feet box overlaps x = A.x and A.x+1, place against a wall at head height of the neighbour cell
  await page.evaluate((A) => {
    T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
    T.fill(A.x - 2, A.y - 1, A.z - 2, A.x + 3, A.y - 1, A.z + 2, 3);
    T.set(A.x + 1, A.y + 1, A.z - 1, 3); // block beside the player's head, one cell north-east
    T.pose(A.x + 0.9, A.y, A.z + 0.5, 0, 0.0, false); // player box spans x A.x+0.6..A.x+1.2
    // look at the south face of that block from very close, so the placement cell (A.x+1, A.y+1, A.z) overlaps the player
    const eye = [A.x + 0.9, A.y + 1.62, A.z + 0.5];
    const fc = [A.x + 1.5, A.y + 1.5, A.z];
    const dx = fc[0] - eye[0], dy = fc[1] - eye[1], dz = fc[2] - eye[2];
    T.g.player.yaw = Math.atan2(-dx, -dz); T.g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, A);
  await frames(page, 3);
  const thead = await page.evaluate(() => T.target());
  await page.mouse.down({ button: 'right' }); await frames(page, 1); await page.mouse.up({ button: 'right' }); await frames(page, 2);
  const cellHead = await page.evaluate((A) => T.get(A.x + 1, A.y + 1, A.z), A);
  check('Placement is refused inside the player (feet and head cases)', inside && tdown && tdown.ny === 1 && cellFeet === 0 && thead && thead.nz === 1 && cellHead === 0,
    `down-target ${JSON.stringify(tdown)} feet=${cellFeet}; head-target ${JSON.stringify(thead)} head=${cellHead}`);

  // ---------- 6. chunk borders: mine/place at x = 16k and x = 16k-1, check neighbour meshes rebuilt
  const border = await page.evaluate((A) => {
    const g = T.g;
    T.fill(A.x - 8, A.y - 8, A.z - 8, A.x + 8, A.y + 8, A.z + 8, 0);
    const bx = -32; // chunk -2 starts at x=-32; x=-33 is in chunk -3
    T.fill(bx - 3, A.y, A.z - 2, bx + 2, A.y + 2, A.z + 2, 3);
    const colA = g.world.getColumn(-3, Math.floor(A.z / 16));
    const colB = g.world.getColumn(-2, Math.floor(A.z / 16));
    const sy = Math.floor((A.y + 1) / 16);
    const geoA = colA.meshes[sy]?.solid?.geometry.uuid, geoB = colB.meshes[sy]?.solid?.geometry.uuid;
    const vertsA = colA.meshes[sy]?.solid?.geometry.getAttribute('position').count;
    // Stand west of the border block row and mine x = -32 (first block of chunk -2) from inside chunk -3's side.
    T.set(bx - 1, A.y + 1, A.z, 0); T.set(bx - 2, A.y + 1, A.z, 0); T.set(bx - 3, A.y + 1, A.z, 0);
    return { geoA, geoB, vertsA, sy, bx };
  }, A);
  await page.evaluate(([A, b]) => T.pose(b.bx - 2.5, A.y + 1 - 1.62 + 0.5, A.z + 0.5, -Math.PI / 2, 0), [A, border]);
  await frames(page, 2);
  const tb = await page.evaluate(() => T.target());
  const pre = await page.evaluate(([A, b]) => { const g = T.g; const colA = g.world.getColumn(-3, Math.floor(A.z / 16)); const colB = g.world.getColumn(-2, Math.floor(A.z / 16)); return { a: colA.meshes[b.sy].solid.geometry.uuid, b: colB.meshes[b.sy].solid.geometry.uuid }; }, [A, border]);
  await page.mouse.down(); await frames(page, 1); await page.mouse.up(); await frames(page, 1);
  const post = await page.evaluate(([A, b]) => { const g = T.g; const colA = g.world.getColumn(-3, Math.floor(A.z / 16)); const colB = g.world.getColumn(-2, Math.floor(A.z / 16)); return { a: colA.meshes[b.sy].solid.geometry.uuid, b: colB.meshes[b.sy].solid.geometry.uuid, dirtyA: colA.dirty[b.sy], dirtyB: colB.dirty[b.sy], block: T.get(b.bx, A.y + 1, A.z) }; }, [A, border]);
  check('Mining on a chunk border rebuilds both neighbouring chunk meshes immediately', tb && tb.x === border.bx && post.block === 0 && post.a !== pre.a && post.b !== pre.b && post.dirtyA === 0 && post.dirtyB === 0, `target ${JSON.stringify(tb)} ${JSON.stringify(post)}`);
  await page.mouse.down({ button: 'right' }); await frames(page, 1); await page.mouse.up({ button: 'right' }); await frames(page, 1);
  const post2 = await page.evaluate(([A, b]) => { const g = T.g; const colA = g.world.getColumn(-3, Math.floor(A.z / 16)); const colB = g.world.getColumn(-2, Math.floor(A.z / 16)); return { a: colA.meshes[b.sy].solid.geometry.uuid, b: colB.meshes[b.sy].solid.geometry.uuid, block: T.get(b.bx - 1, A.y + 1, A.z), fwd: T.get(b.bx, A.y + 1, A.z) }; }, [A, border]);
  check('Placing on a chunk border rebuilds both chunk meshes', post2.a !== post.a && post2.b !== post.b && post2.fwd !== 0, JSON.stringify(post2));

  await page.screenshot({ path: 'e2e/screenshots/verify-arena.png' });

  // ---------- 7. persistence across reload
  const mark = await page.evaluate(() => {
    const g = T.g; const p = g.player;
    const x = Math.floor(p.x) + 1, y = Math.floor(p.y) + 3, z = Math.floor(p.z) + 1;
    g.world.setBlock(x, y, z, 11); g.world.setBlock(x + 1, y, z, 23); g.chunks.flushUrgent();
    g.save();
    return { x, y, z, px: p.x, py: p.y, pz: p.z, seed: g.seed };
  });
  await page.reload({ waitUntil: 'load' });
  await waitMenu(page);
  const restored = await page.evaluate((m) => { const g = window.__minemine; return { a: g.world.getBlock(m.x, m.y, m.z), b: g.world.getBlock(m.x + 1, m.y, m.z), seed: g.seed, seedText: g.seedText, px: g.player.x, py: g.player.y, pz: g.player.z, mode: g.mode }; }, mark);
  check('Seed, player-made blocks and position survive a page reload', restored.a === 11 && restored.b === 23 && restored.seed === mark.seed && Math.abs(restored.px - mark.px) < 1e-6 && Math.abs(restored.pz - mark.pz) < 1e-6, JSON.stringify(restored));

  // ---------- 8. graphics settings, non-black frames
  await page.evaluate(() => { window.__minemine.input.forceLocked = true; });
  await page.click('#play-btn');
  await frames(page, 2);
  const lum = async () => page.evaluate(() => {
    const g = window.__minemine; const r = g.renderer;
    r.render(performance.now() / 1000, false);
    const gl = r.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let sum = 0, n = 0;
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) { gl.readPixels(Math.floor(w * i / 8), Math.floor(h * j / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sum += (px[0] + px[1] + px[2]) / 3; n++; }
    return { avg: sum / n, post: r.postActive, shaderError: r.shaderError };
  });
  const combos = {
    low: LOW,
    medium: { renderDistance: 5, shadows: 'low', postprocessing: true, ssao: false, bloom: true, antialias: false, clouds: true },
    high: HIGH,
    ultra: { ...HIGH, shadows: 'ultra', renderDistance: 7 },
    'effects-off': { postprocessing: false, ssao: false, bloom: false, antialias: false, shadows: 'off', animation: false, clouds: false },
    'post-no-extras': { postprocessing: true, ssao: false, bloom: false, antialias: false, shadows: 'off' },
  };
  for (const [name, s] of Object.entries(combos)) {
    await settings(page, s);
    await page.waitForTimeout(1500);
    const L = await lum();
    await page.screenshot({ path: `e2e/screenshots/gfx-${name}.png` });
    check(`Graphics "${name}" renders a visible image`, L.avg > 25 && !L.shaderError, `avg brightness ${L.avg.toFixed(1)}, post ${L.post}`);
  }

  // ---------- inventory & hotbar
  await page.keyboard.press('Digit4');
  await frames(page, 2);
  const sel = await page.evaluate(() => window.__minemine.inventory.selected);
  await page.mouse.wheel(0, 120); await frames(page, 2);
  const sel2 = await page.evaluate(() => window.__minemine.inventory.selected);
  check('Number keys and mouse wheel select hotbar slots', sel === 3 && sel2 === 4, `${sel} → ${sel2}`);
  await page.keyboard.press('KeyE'); await frames(page, 3);
  const invOpen = await page.evaluate(() => ({ s: window.__minemine.state, open: window.__minemine.ui.inventoryOpen }));
  await page.screenshot({ path: 'e2e/screenshots/inventory.png' });
  await page.keyboard.press('KeyE'); await frames(page, 3);
  const invClosed = await page.evaluate(() => ({ s: window.__minemine.state, open: window.__minemine.ui.inventoryOpen }));
  check('E opens and closes the inventory', invOpen.s === 'inventory' && invOpen.open && invClosed.s === 'playing' && !invClosed.open, `${JSON.stringify(invOpen)} → ${JSON.stringify(invClosed)}`);

  // ---------- real pointer lock (no test hook)
  await page.keyboard.press('Escape');
  await frames(page, 2);
  await page.evaluate(() => { window.__minemine.input.forceLocked = false; });
  await page.click('#play-btn');
  await page.waitForTimeout(1000);
  const lk1 = await page.evaluate(() => ({ locked: document.pointerLockElement?.id ?? null, state: window.__minemine.state }));
  await page.evaluate(() => {
    const g = window.__minemine; const p = g.player;
    p.pitch = 0; p.yaw = 0;
    g.world.setBlock(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z) - 2, 11);
    g.chunks.flushUrgent();
  });
  await frames(page, 2);
  const tLock = await page.evaluate(() => window.__minemine.target && [window.__minemine.target.x, window.__minemine.target.y, window.__minemine.target.z]);
  let minedLocked = null;
  if (tLock) {
    await page.mouse.down(); await frames(page, 1); await page.mouse.up(); await frames(page, 1);
    minedLocked = await page.evaluate((t) => window.__minemine.world.getBlock(t[0], t[1], t[2]), tLock);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const lk2 = await page.evaluate(() => ({ locked: document.pointerLockElement?.id ?? null, state: window.__minemine.state }));
  await page.waitForTimeout(1500);
  await page.click('#play-btn');
  await page.waitForTimeout(1000);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  const lk3 = await page.evaluate(() => ({ locked: document.pointerLockElement?.id ?? null, state: window.__minemine.state }));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2000);
  const lk4 = await page.evaluate(() => ({ locked: document.pointerLockElement?.id ?? null, state: window.__minemine.state }));
  check('Real pointer lock: Play captures, Esc releases and pauses, E toggles inventory',
    lk1.locked === 'game' && lk1.state === 'playing' && lk2.locked === null && lk2.state === 'menu' && lk3.locked === null && lk3.state === 'inventory' && lk4.locked === 'game' && lk4.state === 'playing',
    JSON.stringify([lk1, lk2, lk3, lk4]));
  check('Mining works with the real pointer lock', !!tLock && minedLocked === 0, `target ${JSON.stringify(tLock)} → ${minedLocked}`);

  // ---------- 9. console
  const bad = logs.filter((l) => /\[(error|pageerror)\]/.test(l) || /\[warning\].*(WebGL|Shader|GL_)/i.test(l));
  check('No errors or WebGL warnings in the console', bad.length === 0, bad.slice(0, 5).join(' | '));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (logs.length) console.log('console:\n' + logs.join('\n'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
