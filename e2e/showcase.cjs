const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
const browser = await chromium.launch({ args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{if(m.type()==='error'||m.text().includes('Shader compilation')) errors.push(m.text())});
await page.goto(process.env.URL || 'http://127.0.0.1:5173/?debug');
await page.waitForFunction(()=>window.__minemine?.state==='menu',null,{timeout:120000});
await page.evaluate(()=>{const g=window.__minemine; g.input.forceLocked=true; Object.assign(g.settings,{renderDistance:6,resolutionScale:1,postprocessing:true,shadows:'high',ssao:true,bloom:true,antialias:true,clouds:true});g.applySettings(g.settings);});
await page.click('#play-btn');
await page.waitForFunction(()=>window.__minemine.state==='playing');
await page.keyboard.press('KeyV');
await page.waitForFunction(()=>window.__minemine.player.flying, null, {timeout:15000});
assert.equal(await page.evaluate(()=>window.__minemine.player.flying),true, 'Viewpoint enables flight');
await page.keyboard.press('F1');
await page.locator('.hud').waitFor({state:'hidden'});
await page.waitForTimeout(12000);
fs.mkdirSync('e2e/screenshots',{recursive:true});
await page.screenshot({path:'e2e/screenshots/hearthvale-day.png'});
assert.equal(await page.locator('.hud').isVisible(),false,'F1 hides HUD');
await page.keyboard.press('KeyL'); await page.waitForTimeout(2000);
await page.screenshot({path:'e2e/screenshots/hearthvale-golden.png'});
await page.keyboard.press('KeyL'); await page.waitForTimeout(2000);
await page.screenshot({path:'e2e/screenshots/hearthvale-night.png'});
assert.equal(await page.evaluate(()=>window.__minemine.renderer.shaderError),false,'Shaders compile');
assert.equal(await page.evaluate(()=>window.__minemine.renderer.postFailed),false,'Post effects render');
assert.equal(errors.length,0,errors.join('\n'));
console.log(JSON.stringify({errors, state:await page.evaluate(()=>({shaderError:window.__minemine.renderer.shaderError,columns:window.__minemine.world.columns.size,seed:window.__minemine.seedText}))}));
// Exercise the real AO shader against distant and degenerate depth surfaces.
const aoChecks = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { PostFX } = await import('/src/render/PostFX.ts');
  const post = new PostFX(); post.setSize(128, 64);
  const r = window.__minemine.renderer.renderer;
  const camera = new THREE.PerspectiveCamera(70, 2, 0.1, 500);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x99bbdd);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial({color: 0x99bbdd}));
  mesh.position.z = -120; scene.add(mesh);
  post.options.bloom = false;
  const results = [];
  for (const msaa of [false, true]) {
    post.options.msaa = msaa;
    post.render(r, scene, camera, 0, false);
    const pixels = new Uint8Array(post.aoRT.width * post.aoRT.height * 4);
    r.readRenderTargetPixels(post.aoRT, 0, 0, post.aoRT.width, post.aoRT.height, pixels);
    let min = 255;
    for (let i = 0; i < pixels.length; i += 4) min = Math.min(min, pixels[i]);
    results.push({msaa, min});
  }
  mesh.geometry.dispose(); mesh.material.dispose(); post.dispose();
  return results;
});
assert.ok(aoChecks.every(check => check.min === 255), 'Distant surfaces must have no black AO pixels: ' + JSON.stringify(aoChecks));
console.log('PASS: distant shading with MSAA on and off', JSON.stringify(aoChecks));
await browser.close();
console.log('PASS: Hearthvale boot, viewpoint, clean HUD, daylight, golden hour, moonlight and shader compilation');
})();
