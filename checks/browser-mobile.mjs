import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true});
const base=process.env.FRUMOS_URL || 'http://127.0.0.1:4174/';
try {
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await ctx.newPage(), errors=[];
  await page.addInitScript(()=>{
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(...args){window.music=this;return play.apply(this,args);};
    const click=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(...args){window.firstMusicClick??=window.music?.currentTime;return click.apply(this,args);};
  });
  page.on('pageerror',error=>errors.push(error.message));
  let queries=0;
  await page.route('https://musicbrainz.org/**',route=>{
    queries++;
    return route.fulfill({json:{count:1,recordings:[{title:'Tema', 'artist-credit':[{name:'Grupo'}],
      releases:[{id:'12345678-1234-1234-1234-123456789abc',status:'Official'}]}]}});
  });
  await page.route('https://coverartarchive.org/**',route=>route.fulfill({contentType:'image/webp',
    path:fileURLToPath(new URL('../public/icons/drum-cover.webp',import.meta.url))}));
  await page.goto(base);
  await page.locator('#projectSelect option').first().waitFor({state:'attached'});
  assert.match(await page.title(),/Kol Room/);
  assert.match(await page.locator('.brand').innerText(),/Kol Room/);
  const rate=16000, samples=rate*12, wave=Buffer.alloc(44+samples*2);
  wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
  wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);
  wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);
  wave.write('data',36);wave.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) {const t=((i/rate)-1.5)%.5;wave.writeInt16LE(i/rate<1.5 ? 0 : Math.round(14000*Math.sin(2*Math.PI*145*t)*Math.exp(-90*t)),44+2*i);}
  await page.locator('#importTracks').click();
  await page.locator('#audioInput').setInputFiles({name:'Grupo - Tema.wav',mimeType:'audio/wav',buffer:wave});
  await page.waitForFunction(()=>document.querySelector('#editorCover')?.src.startsWith('blob:'),null,{timeout:60000});
  assert.ok(queries>=1);
  await page.locator('#songBpm').fill('120');await page.locator('#songBpm').press('Tab');
  await page.locator('#useSongTempo').click();
  assert.equal(await page.locator('#bpm').inputValue(),'120');
  await page.locator('#navMetronome').click();
  await page.locator('#bpm').fill('108');await page.locator('#bpm').press('Tab');
  await page.locator('#navSettings').click();
  await page.locator('[data-setting=announcements]').uncheck();
  await page.locator('#settingsPanel summary').filter({hasText:/^Metrónomo$/}).click();
  await page.locator('[data-setting=countIn]').uncheck();
  await page.locator('#navRepertoire').click();await page.locator('.row-play').click();
  await page.waitForFunction(()=>document.querySelector('[data-part=phase]')?.textContent.includes('Reproduciendo ahora'));
  await page.waitForFunction(()=>window.firstMusicClick!=null);
  assert.ok(await page.evaluate(()=>window.firstMusicClick>=1.48),'el clic debe esperar al sonido');
  await page.locator('[data-action=main]').click();
  const metro=page.locator('[data-action=toggleMetro]');
  if (await metro.getAttribute('aria-pressed')==='true') {
    await metro.click();
    await page.waitForFunction(()=>document.querySelector('[data-action=toggleMetro]')?.getAttribute('aria-pressed')==='false');
  }
  await metro.click();
  await page.waitForFunction(()=>document.querySelector('[data-action=toggleMetro]')?.getAttribute('aria-pressed')==='true');
  await metro.click();
  await page.waitForFunction(()=>document.querySelector('[data-action=toggleMetro]')?.getAttribute('aria-pressed')==='false');
  await page.locator('summary').filter({hasText:'Práctica · velocidad'}).click();
  await page.locator('[data-action=matchTempo]').click();await page.locator('[data-action=applySpeed]').click();
  await page.waitForFunction(()=>document.querySelector('[data-part=speedHelp]')?.textContent.includes('Aplicada: 90 %'));
  for(const width of [320,360,390]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desbordamiento a '+width);
  }
  await page.locator('[data-action=back]').click();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await ctx.setOffline(true);await page.reload();
  await page.locator('.track-title').click();
  await page.waitForFunction(()=>document.querySelector('#editorCover')?.src.startsWith('blob:'));
  assert.deepEqual(errors,[]);
  console.log('Kol Room móvil, portada automática persistente, copia del tempo y ajuste musical a 108 BPM verificados.');
} finally {await browser.close();}
