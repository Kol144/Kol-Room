import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const context=await browser.newContext({viewport:{width:528,height:711}});
  const page=await context.newPage();
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.addInitScript(()=>{
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      if(this.buffer){
        const pcm=this.buffer.getChannelData(0);
        window.voiceSample={duration:this.buffer.duration,rms:Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length)};
        this.addEventListener('ended',()=>{window.voiceSample.ended=true;window.voiceEnd=performance.now();},{once:true});
      }
      return start.apply(this,args);
    };
    const tick=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(at){
      window.firstClick??=performance.now()+1000*(at-this.context.currentTime);
      return tick.call(this,at);
    };
  });
  await page.goto(process.env.FRUMOS_URL||'http://127.0.0.1:4173/');
  assert.equal(await page.locator('.library-hero').evaluate(el=>getComputedStyle(el).textAlign),'center');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  for(const offline of [false,true]){
    if(offline){await context.setOffline(true);await page.reload();}
    await page.locator('#navSettings').click();
    await page.locator('[data-action=speak]').click();
    try {await page.waitForFunction(()=>window.voiceSample?.ended,null,{timeout:60000});}
    catch(err){console.error(await page.locator('#toast').textContent());throw err;}
    const pcm=await page.evaluate(()=>window.voiceSample);
    assert.ok(pcm.duration>1 && pcm.rms>.001);
    console.log({offline,...pcm});
  }
  await page.locator('#navRepertoire').click();
  const wav=Buffer.alloc(44+32000);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  await page.locator('#importTracks').click();
  await page.locator('#audioInput').setInputFiles({name:'Prueba de ensayo.wav',mimeType:'audio/wav',buffer:wav});
  await page.locator('#playSet').click();
  await page.waitForFunction(()=>window.firstClick!=null,null,{timeout:60000});
  const gap=await page.evaluate(()=>window.firstClick-window.voiceEnd);
  assert.ok(gap>=2990 && gap<3450,'Intervalo medido '+gap+' ms');
  console.log('Intervalo voz–primer pulso',Math.round(gap),'ms');
}finally{await browser.close();}
