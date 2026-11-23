// Classic worker: the phonemizer and ONNX Runtime ship browser builds.
importScripts('runtime/piper_phonemize.js','runtime/ort.wasm.min.js');
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('runtime/',self.location.href).href;
const phonemizerReady=createPiperPhonemize({
  locateFile:name=>new URL('runtime/'+name,self.location.href).href,
  print:line=>phonemes.push(...JSON.parse(line).phoneme_ids)
});
const configs=new Map();
let phonemes=[],session,sessionModel='',sessionReady;
async function synthesize({text,speed,model='es_ES-davefx-medium'}){
  try{
    if(!['es_ES-davefx-medium','en_US-lessac-medium'].includes(model))throw Error('Voz desconocida.');
    if(!configs.has(model))configs.set(model,fetch(model+'.onnx.json').then(response=>response.json()));
    const config=await configs.get(model);
    const phonemizer=await phonemizerReady;
    phonemes=[];
    phonemizer.callMain(['-l',config.espeak.voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
    const ids=phonemes;
    if(!ids.length)throw Error('El título no contiene sonidos pronunciables.');
    if(sessionModel!==model){
      await session?.release();
      session=null;
      sessionModel='';
      sessionReady=ort.InferenceSession.create(model+'.onnx',{executionProviders:['wasm']});
      session=await sessionReady;
      sessionModel=model;
    }
    const {noise_scale,length_scale,noise_w}=config.inference;
    const result=await session.run({
      input:new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),
      input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(ids.length)),[1]),
      scales:new ort.Tensor('float32',Float32Array.of(noise_scale,length_scale/speed,noise_w),[3])
    });
    const pcm=new Float32Array(result.output.data);
    return {pcm,rate:config.audio.sample_rate};
  }catch(error){throw Error(String(error.message || error));}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{
  queue=queue.then(async()=>{
    try{
      const {pcm,rate}=await synthesize(data);
      self.postMessage({id:data.id,pcm,rate},[pcm.buffer]);
    }catch(error){self.postMessage({id:data.id,error:String(error.message || error)});}
  });
};
