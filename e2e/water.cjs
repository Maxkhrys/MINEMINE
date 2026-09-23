const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const page = await browser.newPage({viewport:{width:960,height:540}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route('**/e2e/graphics.html',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas id="game"></canvas></body></html>'}));
  await page.goto('http://127.0.0.1:5173/e2e/graphics.html');
  await page.evaluate(async()=>{
    const [{GameRenderer},{World},{SectionMesher},{B},{columnIndex,WORLD_HEIGHT},{defaultSettings}] = await Promise.all([
      import('/src/render/Renderer.ts'),import('/src/world/World.ts'),import('/src/world/mesher.ts'),import('/src/world/blocks.ts'),import('/src/world/constants.ts'),import('/src/game/settings.ts')]);
    const world=new World();
    for(let cz=-14;cz<=2;cz++)for(let cx=-8;cx<=8;cx++){
      const blocks=new Uint8Array(16*16*WORLD_HEIGHT);
      for(let y=40;y<=46;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++)blocks[columnIndex(x,y,z)]=y<43?B.SAND:B.WATER;
      world.addColumn(cx,cz,blocks);
    }
    const r=new GameRenderer(document.querySelector('canvas'),()=>false);
    const mesher=new SectionMesher();
    for(let cz=-13;cz<=1;cz++)for(let cx=-7;cx<=7;cx++){
      const cols=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)cols.push(world.getColumn(cx+dx,cz+dz));
      r.chunks.applySection(cols[4],2,mesher.mesh(cols,2));
    }
    r.camera.position.set(0.25,49,8);r.camera.rotation.set(-0.035,0,0);
    const water=r.chunks.group.children.find(m=>m.renderOrder===2).material;
    window.fixture={r,water,compile:water.onBeforeCompile,defaultSettings,world,mesher,B};
  });
  fs.mkdirSync('e2e/screenshots',{recursive:true});
  const checks=[];
  for(const preset of ['low','medium','high','ultra']) {
    for(const view of [{x:0.25,pitch:-0.035,time:0},{x:15.99,pitch:-0.08,time:17},{x:16.01,pitch:-0.02,time:2048}]) {
      const stats=await page.evaluate(({preset,view})=>{
        const {r,defaultSettings}=window.fixture;
        r.applySettings(defaultSettings(preset)); r.setLighting(0);
        r.camera.position.x=view.x;r.camera.rotation.x=view.pitch;
        r.env.uRipples.value[0].set(view.x,0,view.time-1,0.4);
        r.render(view.time,false,false);
        const gl=r.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
        let black=0,min=255;
        for(let y=Math.floor(h*0.15);y<h*0.52;y++)for(let x=20;x<w-20;x++){
          const i=(y*w+x)*4,l=Math.max(px[i],px[i+1],px[i+2]);min=Math.min(min,l);if(l<45)black++;
        }
        return {preset,...view,black,min,shaderError:r.shaderError,postFailed:r.postFailed};
      },{preset,view});
      checks.push(stats);
      if(view.time===17) {
        const shot=await page.screenshot({path:`e2e/screenshots/water-${preset}.jpg`,type:'jpeg',quality:75});
        if(preset==='high') console.log('RENDER_IMAGE water-high '+shot.toString('base64'));
      }
    }
  }
  // A flooded two-block excavation reproduces the edges in the user close-up.
  await page.evaluate(()=>{
    const {r,world,mesher,B}=window.fixture;
    world.setBlock(0,42,-1,B.FALLING_WATER);
    world.setBlock(0,41,-1,B.FALLING_WATER);
    for(let cz=-2;cz<=1;cz++)for(let cx=-1;cx<=1;cx++){
      const cols=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)cols.push(world.getColumn(cx+dx,cz+dz));
      r.chunks.applySection(cols[4],2,mesher.mesh(cols,2));
    }
    r.camera.position.set(0.5,44.8,1.8);r.camera.rotation.set(-0.86,0,0);
  });
  for(const preset of ['low','medium','high','ultra']) {
    const stats=await page.evaluate(preset=>{
      const {r,defaultSettings}=window.fixture;r.applySettings(defaultSettings(preset));
      r.render(23,true,false);
      const gl=r.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let black=0,min=255;
      for(let i=0;i<px.length;i+=4){const l=Math.max(px[i],px[i+1],px[i+2]);min=Math.min(min,l);if(l<8)black++;}
      return {preset,view:'underwater-hole',black,min,shaderError:r.shaderError,postFailed:r.postFailed};
    },preset);
    checks.push(stats);
    const shot=await page.screenshot({path:`e2e/screenshots/hole-${preset}.jpg`,type:'jpeg',quality:80});
    if(preset==='high') console.log('RENDER_IMAGE underwater-hole '+shot.toString('base64'));
  }
  await page.evaluate(()=>{const {r}=window.fixture;r.camera.position.set(0.25,49,8);r.camera.rotation.set(-0.035,0,0);});
  // Prove the detector sees a deliberately broken water shader.
  const sentinel=await page.evaluate(()=>{
    const {r,water,compile,defaultSettings}=window.fixture;
    r.applySettings(defaultSettings('low'));
    water.onBeforeCompile=(s,renderer)=>{compile(s,renderer);s.fragmentShader=s.fragmentShader.replace('gl_FragColor = vec4(col, alpha);','gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);');};
    water.customProgramCacheKey=()=>'sentinel';water.needsUpdate=true;
    r.render(17,false,false);
    const gl=r.renderer.getContext(),px=new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/4),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    return Math.max(px[0],px[1],px[2]);
  });
  console.log('WATER_CHECKS '+JSON.stringify(checks));
  console.log('WATER_ERRORS '+JSON.stringify(errors));
  await browser.close();
  assert.ok(sentinel<45, 'Pixel detector must catch deliberate black water');
  assert.ok(checks.every(s=>s.black===0 && !s.shaderError && !s.postFailed),JSON.stringify(checks));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: voxel water across all 4 presets, grazing angles, chunk crossings and animation times');
})();
