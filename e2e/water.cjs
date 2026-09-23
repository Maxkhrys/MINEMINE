const { chromium } = require('playwright');
const fs = require('fs');
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
    window.fixture={r,water,compile:water.onBeforeCompile,defaultSettings};
  });
  fs.mkdirSync('e2e/screenshots',{recursive:true});
  for(const variant of ['baseline','flat','no-grid','no-specular','no-reflection']){
    const stats=await page.evaluate(variant=>{
      const {r,water,compile,defaultSettings}=window.fixture;
      r.applySettings({...defaultSettings('low'),resolutionScale:1,renderDistance:11});
      water.onBeforeCompile=(s,renderer)=>{compile(s,renderer);
        if(variant==='no-grid')s.fragmentShader=s.fragmentShader.replace('col *= 1.0 - line * 0.07 * (1.0 - smoothstep(6.0, 18.0, dist));','');
        if(variant==='no-specular')s.fragmentShader=s.fragmentShader.replace('+ uSunColor * spec * sunVis','');
        if(variant==='no-reflection')s.fragmentShader=s.fragmentShader.replace('skyGradient(normalize(R))','vec3(0.5,0.6,0.8)');
      };
      water.customProgramCacheKey=()=>variant;water.needsUpdate=true;
      r.env.uWind.value=variant==='flat'?0:1;
      r.render(17,false,false);
      const gl=r.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let black=0,min=255;
      for(let y=80;y<h*0.52;y++)for(let x=20;x<w-20;x++){
        const i=(y*w+x)*4,l=Math.max(px[i],px[i+1],px[i+2]);min=Math.min(min,l);if(l<45)black++;
      }
      return {variant,black,min,shaderError:r.shaderError};
    },variant);
    console.log('WATER_STATS '+JSON.stringify(stats));
    const shot=await page.screenshot({path:`e2e/screenshots/water-${variant}.jpg`,type:'jpeg',quality:75});
    console.log('RENDER_IMAGE '+variant+' '+shot.toString('base64'));
  }
  console.log('WATER_ERRORS '+JSON.stringify(errors));
  await browser.close();
})();
