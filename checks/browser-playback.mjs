// Optional: install Playwright + its Chromium, or supply PLAYWRIGHT_MODULE pointing to its entry point.
// Run from the project root with: node checks/browser-playback.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const page = await browser.newPage();
  const crashes = [];
  page.on('pageerror', err => crashes.push(err.message));
  const entry = 'http://localhost:7351/';
  await page.route(entry + '**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({contentType:'text/html',body:'<html lang="es"><title>Prueba Frumos</title><button>Activar audio</button></html>'});
    if (!['/playback.js','/audio-output.js','/neural-voice.js','/sound-onset.js','/song-speech.js'].includes(path)) return route.abort();
    await route.fulfill({contentType:'text/javascript',body:await readFile(new URL('..' + path, import.meta.url))});
  });
  await page.goto(entry);
  await page.evaluate(async () => {
    const {PlaybackEngine} = await import('./playback.js');
    const {AudioOutput} = await import('./audio-output.js');
    function wav(seconds) {
      const n = Math.round(seconds * 16000), bytes = new ArrayBuffer(44 + n * 2), view = new DataView(bytes);
      const label = (offset, s) => [...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
      label(0,'RIFF'); view.setUint32(4,36+2*n,true); label(8,'WAVE'); label(12,'fmt ');
      view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
      view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true);
      view.setUint16(34,16,true); label(36,'data'); view.setUint32(40,2*n,true);
      for (let i=0;i<n;i++) view.setInt16(44+2*i,1200 * Math.sin(2*Math.PI*i*330/16000),true);
      return new Blob([bytes],{type:'audio/wav'});
    }
    window.result = {states:[], musicTiming:[], clicks:[]};
    window.settings = {announcements:false, restSeconds:.4, countIn:true, metronomeEnabled:false};
    window.output = new AudioOutput();
    const nativeClick = output.click.bind(output);
    output.click = (at, beat, visual) => {
      result.clicks.push({at, beat});
      return nativeClick(at,beat,visual);
    };
    const blobs = {alpha:wav(.7),beta:wav(.75),solo:wav(8)};
    window.makeSong = (id, fields={})=>({id,title:id,audioId:id,bpm:240,...fields});
    window.p = new PlaybackEngine({getAudio:async id=>blobs[id],getSettings:()=>settings,output,
      onChange(s) {
        const last = result.states.at(-1);
        if (!last || s.state!==last.state || s.song?.id!==last.id)
          result.states.push({state:s.state,id:s.song?.id,time:performance.now()});
      }});
    document.querySelector('button').onclick = () => p.start([makeSong('alpha'), makeSong('sin',{audioId:null}), makeSong('beta',{manualReadyOverride:true})]);
  });
  await page.getByRole('button').click();
  async function state(name) {
    try { await page.waitForFunction(s => p.state === s, name, {timeout:20000}); }
    catch (error) {
      console.error(await page.evaluate(()=>({snapshot:p.snapshot(),phases:result.states,
        context:output.clickContext?.state,clock:output.time,visible:document.visibilityState})));
      throw error;
    }
  }
  await state('preparing');
  const first = await page.evaluate(()=>({clicks:result.clicks.slice(), phase:p.snapshot().song.id, position:p.track.audio.currentTime}));
  assert.equal(first.phase,'beta'); assert.equal(first.position,0);
  assert.deepEqual(first.clicks.map(c=>c.beat),[0,1,2,3]);
  for (let i=1;i<4;i++) assert.ok(Math.abs(first.clicks[i].at-first.clicks[i-1].at-.25)<1e-8);
  await page.evaluate(()=>p.ready()); await state('finished');
  const states = await page.evaluate(()=>result.states.filter(s=>s.id).map(s=>[s.state,s.id]));
  assert.deepEqual(states,[
    ['loading','alpha'],['countIn','alpha'],['playing','alpha'],['resting','alpha'],
    ['loading','beta'],['preparing','beta'],['countIn','beta'],['playing','beta'],['finished','beta']
  ]);
  const loop = await page.evaluate(async ()=>{
    settings.countIn=false;
    await p.start([makeSong('solo')],{mode:'single'});
    p.seek(2.1);
    p.pause(); await p.resume();
    p.updateSong({...p.song, playbackSpeed:.8, beatOffset:.125, metronomeEnabledOverride:true});
    return {rate:p.track.audio.playbackRate,pitch:p.track.audio.preservesPitch,position:p.track.audio.currentTime};
  });
  assert.equal(loop.rate,.8); assert.equal(loop.pitch,true); assert.ok(Math.abs(loop.position-2.1)<.3);
  await page.evaluate(()=>p.setLoop({a:2,b:2.4,repeats:2})); await state('finished');
  await page.evaluate(async ()=>{
    await p.open(makeSong('solo')); p.seek(6);
    await p.preview(p.song, .75, 6);
  });
  await page.waitForFunction(()=>p.previewStage==='changed',null,{timeout:12000});
  const changed = await page.evaluate(()=>({rate:p.previewTrack.audio.playbackRate,position:p.previewTrack.audio.currentTime,main:p.track.audio.currentTime}));
  assert.equal(changed.rate,.75); assert.equal(changed.main,6);
  await state('paused');
  assert.equal(await page.evaluate(()=>p.track.audio.currentTime),6);
  await page.evaluate(async ()=>{
    settings.countIn=true;
    await p.start([makeSong('solo')]); p.stop();
  });
  await page.waitForTimeout(1300); await state('idle');

  // Render the actual click oscillator/envelope in PCM and measure onsets on each channel.
  const rendered = await page.evaluate(async ()=>{
    const {AudioOutput,defaults} = await import('./audio-output.js');
    const out = new AudioOutput(), rate=48000;
    const ctx = out.clickContext = new OfflineAudioContext(2,rate*2,rate);
    const gain=ctx.createGain(), pan=ctx.createStereoPanner();
    gain.connect(pan).connect(ctx.destination);
    out.clickBus={gain,pan};
    out.configure({...defaults,splitStereo:true,clickVolume:1});
    for (let beat=0;beat<4;beat++) out.click(.12+beat*.4,beat);
    const pcm=await ctx.startRendering(), ch=pcm.getChannelData(1), other=pcm.getChannelData(0);
    const onsets=[]; let last=-rate;
    for(let i=0;i<ch.length;i++) if(Math.abs(ch[i])>.03) {
      if(i-last>.12*rate) onsets.push(i/rate);
      last=i;
    }
    const leftPeak=other.reduce((peak,v)=>Math.max(peak,Math.abs(v)),0);
    return {onsets,leftPeak};
  });
  assert.equal(rendered.onsets.length,4);
  assert.ok(rendered.leftPeak<.005);
  for(let i=0;i<4;i++) assert.ok(Math.abs(rendered.onsets[i]-(.12+i*.4))<.005);
  await page.evaluate(async()=>{
    window.speechCheck={voices:p.getVoices().length};
    const provider=output.voices;
    const speak=provider.speak.bind(provider);
    provider.speak=async(...args)=>{
      try {await speak(...args);speechCheck.ended=true;}
      catch(e){speechCheck.fallback=e.message;throw e;}
    };
    settings.announcements=true;settings.countIn=false;settings.voiceLang='en-US';
    await p.start([makeSong('alpha')]);
  });
  await page.waitForFunction(()=>['preparing','finished'].includes(p.state),null,{timeout:30000});
  if (await page.evaluate(()=>p.state==='preparing')) await page.evaluate(()=>p.ready());
  await state('finished');
  const speech=await page.evaluate(()=>speechCheck);
  assert.ok(speech.ended || speech.fallback);
  assert.deepEqual(crashes,[]);
  console.log(JSON.stringify({chromium:browser.version(),passed:true,states,rendered,speech,previewRate:changed.rate,pitch:loop.pitch},null,2));
} finally { await browser.close(); }
