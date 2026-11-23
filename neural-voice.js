export const spanishVoice = Object.freeze({voiceURI:'frumos:piper-davefx',name:'DaveFX · neuronal local',lang:'es-ES',localService:true});
export const englishVoice = Object.freeze({voiceURI:'kolroom:piper-lessac-en',name:'Lessac · neuronal inglesa',lang:'en-US',localService:true});
const clips=new Map();
const preparing=new Map();
let context;
export function usesNeural(settings) {
  return [spanishVoice.voiceURI,englishVoice.voiceURI].includes(settings.voiceURI) || (!settings.voiceURI && /^(es|en)\b/i.test(settings.voiceLang));
}
export function primeNeural() {
  context ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  return context.resume();
}
function synthesize(text,speed,model,signal) {
  const key=JSON.stringify([text,speed,model]);
  if(clips.has(key))return Promise.resolve(clips.get(key));
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const worker=new Worker(new URL('voice/synth.js',document.baseURI));
    const finish=(fn,value)=>{
      clearTimeout(timeout);signal.removeEventListener('abort',abort);worker.terminate();fn(value);
    };
    const abort=()=>finish(reject,signal.reason);
    const timeout=setTimeout(()=>finish(reject,Error('La voz neuronal ha tardado demasiado.')),45000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>finish(reject,Error('El dispositivo no pudo iniciar la voz neuronal.'));
    worker.onmessage=({data})=>{
      if(data.error || !data.pcm?.length)return finish(reject,Error(data.error || 'No se generó la locución.'));
      if(clips.size>=12)clips.delete(clips.keys().next().value);
      clips.set(key,data);finish(resolve,data);
    };
    worker.postMessage({text,speed,model});
  });
}
export function prepareNeural(text,settings) {
  const speed=Math.max(.5,Math.min(2,settings.voiceRate));
  const model=settings.voiceURI===englishVoice.voiceURI || (!settings.voiceURI && /^en\b/i.test(settings.voiceLang)) ? 'en_US-lessac-medium' : 'es_ES-davefx-medium';
  const key=JSON.stringify([text,speed,model]);
  if(clips.has(key))return Promise.resolve(clips.get(key));
  if(preparing.has(key))return preparing.get(key);
  const job=(async()=>{
    // Only the short announcement is persisted. Cache hits require neither a
    // model download nor a running AudioContext, including after an offline reload.
    let cache,url;
    try {
      cache=await caches.open('kol-room-announcements-v1');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
      const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      url=new URL('./voice/clips/'+hash,document.baseURI).href;
      const hit=await cache.match(url);
      if(hit){
        const rate=Number(hit.headers.get('X-Sample-Rate')),pcm=new Float32Array(await hit.arrayBuffer());
        if(rate>0 && pcm.length)return {pcm,rate};
      }
    } catch { /* Cache storage is optional on some phones. */ }
    const clip=await synthesize(text,speed,model,new AbortController().signal);
    if(cache && url)try {
      await cache.put(url,new Response(clip.pcm.buffer,{headers:{'X-Sample-Rate':String(clip.rate)}}));
    } catch { /* The in-memory clip is still usable if storage is full. */ }
    return clip;
  })().finally(()=>preparing.delete(key));
  preparing.set(key,job);
  return job;
}
export async function speakNeural(text,settings,signal) {
  signal.throwIfAborted();
  const resumed=primeNeural().catch(()=>{});
  const {pcm,rate}=await prepareNeural(text,settings);
  signal.throwIfAborted();
  if(context.state!=='running')throw Error('Activa el audio para escuchar la voz neuronal.');
  await resumed;
  signal.throwIfAborted();
  const buffer=context.createBuffer(1,pcm.length,rate);
  buffer.copyToChannel(pcm,0);
  const source=context.createBufferSource(),gain=context.createGain();
  source.buffer=buffer;
  gain.gain.value=Math.max(0,Math.min(1,settings.voiceVolume));
  source.connect(gain).connect(context.destination);
  await new Promise((resolve,reject)=>{
    const cleanup=()=>{source.onended=null;source.disconnect();gain.disconnect();signal.removeEventListener('abort',abort);};
    const abort=()=>{source.stop();cleanup();reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    source.onended=()=>{cleanup();resolve();};
    source.start();
  });
}
