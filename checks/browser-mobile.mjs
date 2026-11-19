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
    OscillatorNode.prototype.start=function(at){
      const music=window.music;
      if(music && !music.paused) window.firstMusicClick??=music.currentTime+Math.max(0,at-this.context.currentTime)*music.playbackRate;
      return click.call(this,at);
    };
  });
  page.on('pageerror',error=>errors.push(error.message));
  let queries=0;
  let tempoQueries=0;
  const id='12345678-1234-1234-1234-123456789abc';
  await page.route('https://api.reccobeats.com/**',route=>{
    if(route.request().url().includes('/search?')){
      tempoQueries++;
      return route.fulfill({json:{content:[{id,trackTitle:'Tema',durationMs:12000,artists:[{name:'Grupo'}]}],totalElements:1}});
    }
    return route.fulfill({json:{tempo:118.73}});
  });
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
  const onset=1.733, drums=4.487;
  const rate=16000, samples=rate*12, wave=Buffer.alloc(44+samples*4);
  wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
  wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);
  wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*4,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);
  wave.write('data',36);wave.writeUInt32LE(samples*4,40);
  for(let i=0;i<samples;i++) {
    const time=i/rate, t=(time-drums)%.5;
    const note=time>=onset && time<onset+.4 ? 500*Math.sin(2*Math.PI*330*(time-onset)) : 0;
    const beat=time>=drums ? 14000*Math.sin(2*Math.PI*145*t)*Math.exp(-90*t) : 0;
    wave.writeInt16LE(Math.round(note+beat),44+4*i);
    wave.writeInt16LE(-Math.round(note+beat),46+4*i);
  }
  await page.locator('#importTracks').click();
  await page.locator('#audioInput').setInputFiles({name:'Grupo - Tema.wav',mimeType:'audio/wav',buffer:wave});
  await page.waitForFunction(()=>document.querySelector('#editorCover')?.src.startsWith('blob:'),null,{timeout:60000});
  assert.ok(queries>=1);
  await page.waitForFunction(()=>document.querySelector('#onlineBpmStatus')?.textContent.includes('119 BPM · Aplicado'));
  assert.equal(await page.locator('#songBpm').inputValue(),'119');
  await page.locator('#songBpm').fill('119.6');await page.locator('#songBpm').press('Tab');
  await page.locator('#searchOnlineBpm').click();
  await page.waitForFunction(()=>!document.querySelector('#searchOnlineBpm').disabled);
  assert.equal(tempoQueries,2);
  assert.equal(await page.locator('#songBpm').inputValue(),'120');
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
  const firstClick=await page.evaluate(()=>window.firstMusicClick);
  assert.ok(Math.abs(firstClick-onset)<.04,'primer clic programado a '+firstClick);
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
  assert.match(await page.locator('#onlineBpmStatus').textContent(),/119 BPM.*Sin conexión/);
  // Simulate a song saved by an older build with a late drum marker and no sample onset.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('pulso_sampler_v1');
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects');
      const get=store.getAll();
      get.onsuccess=()=>{
        const project=get.result[0],song=project.repertoire[0];
        delete song.soundOnset;
        Object.assign(song,{beatOffset:7.241,detectedBeatOffset:7.241,beatOffsetSource:'detected',metronomeEnabledOverride:true,playbackSpeed:1});
        store.put(project);
      };
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
    };
    open.onerror=()=>reject(open.error);
  }));
  await page.reload();await page.locator('.row-play').click();
  await page.waitForFunction(()=>window.firstMusicClick!=null,null,{timeout:12000});
  const legacyClick=await page.evaluate(()=>window.firstMusicClick);
  assert.ok(legacyClick>=onset-.005 && legacyClick<=onset+.12,'primer clic en una canción antigua a '+legacyClick);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({onset,firstClick,legacyClick,firstDrum:drums,tempoQueries,projectTempo:108}));
} finally {await browser.close();}
