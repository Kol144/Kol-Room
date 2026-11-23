import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const workers=[];
  page.on('worker',worker=>workers.push(worker.url()));
  await page.addInitScript(()=>{
    localStorage.setItem('frumos.drummer.settings.v1',JSON.stringify({announcementGap:0,onlineArtwork:false,onlineTempo:false,announcements:true,countIn:true,metronomeEnabled:true}));
    window.ticks=[];window.synths=0;
    const WorkerBase=window.Worker;
    window.Worker=class extends WorkerBase {constructor(url,...rest){super(url,...rest);if(String(url).includes('/voice/synth.js'))window.synths++;}};
    const say=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.spoken=performance.now();return say.apply(this,args);};
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){window.track=this;return play.call(this);};
    const click=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(at){
      const media=window.track;
      window.ticks.push({at,position:media && !media.paused ? media.currentTime+Math.max(0,at-this.context.currentTime)*media.playbackRate : null});
      return click.call(this,at);
    };
  });
  await page.goto(process.env.FRUMOS_URL || 'http://127.0.0.1:4174/');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const rate=16000, samples=rate*13, onset=2.137, wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);
  wav.writeUInt32LE(2*rate,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=Math.ceil(rate*onset);i<samples;i++){
    const t=(i/rate-onset)%.5;
    wav.writeInt16LE(Math.round(18000*Math.sin(t*2*Math.PI*145)*Math.exp(-85*t)),44+i*2);
  }
  await page.locator('#importTracks').click();
  await page.locator('#audioInput').setInputFiles({name:'Prueba de ensayo.wav',mimeType:'audio/wav',buffer:wav});
  await page.waitForFunction(()=>document.querySelector('.song-row') && !document.querySelector('#playSet').disabled,null,{timeout:100000});
  const stored=await page.evaluate(async()=>{
    const cache=await caches.open('kol-room-announcements-v1'), keys=await cache.keys();
    const clip=await cache.match(keys[0]);
    return {rate:Number(clip.headers.get('X-Sample-Rate')),bytes:(await clip.arrayBuffer()).byteLength};
  });
  assert.ok(stored.rate>8000 && stored.bytes>1000,JSON.stringify({stored,workers}));
  workers.length=0;
  await context.setOffline(true);await page.reload();
  await page.locator('#playSet').click();
  await page.waitForFunction(()=>window.ticks.length>=7,null,{timeout:20000});
  const result=await page.evaluate(()=>({ticks:window.ticks,synths:window.synths,spoke:!!window.spoken}));
  assert.equal(result.synths,0);assert.equal(result.spoke,true);
  assert.ok(workers.every(url=>!url.includes('voice/synth.js')));
  const times=result.ticks.slice(0,7),period=times[1].at-times[0].at;
  assert.ok(Math.abs(period-.5)<.01,JSON.stringify({times,period,analysis:await page.locator('#analysisFacts').textContent()}));
  assert.ok(Math.abs(times[4].position-onset)<.05,JSON.stringify(times));
  for(let i=1;i<times.length;i++)assert.ok(Math.abs(times[i].at-times[i-1].at-period)<.05,JSON.stringify(times));
  console.log(JSON.stringify({firstSound:onset,fifthClickPosition:times[4].position,intervalsMs:times.slice(1).map((t,i)=>Math.round(1000*(t.at-times[i].at))),offlineSynthesisWorkers:result.synths}));
} finally {await browser.close();}
