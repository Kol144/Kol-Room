// Classic worker: the phonemizer and ONNX Runtime ship browser builds.
importScripts('runtime/piper_phonemize.js','runtime/ort.wasm.min.js');
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('runtime/',self.location.href).href;
self.onmessage=async({data:{text,speed,model='es_ES-davefx-medium'}})=>{
  try{
    if(!['es_ES-davefx-medium','en_US-lessac-medium'].includes(model))throw Error('Voz desconocida.');
    const config=await (await fetch(model+'.onnx.json')).json();
    const ids=[];
    const phonemizer=await createPiperPhonemize({
      locateFile:name=>new URL('runtime/'+name,self.location.href).href,
      print:line=>ids.push(...JSON.parse(line).phoneme_ids)
    });
    phonemizer.callMain(['-l',config.espeak.voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
    if(!ids.length)throw Error('El título no contiene sonidos pronunciables.');
    const session=await ort.InferenceSession.create(model+'.onnx',{executionProviders:['wasm']});
    const {noise_scale,length_scale,noise_w}=config.inference;
    const result=await session.run({
      input:new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),
      input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(ids.length)),[1]),
      scales:new ort.Tensor('float32',Float32Array.of(noise_scale,length_scale/speed,noise_w),[3])
    });
    const pcm=new Float32Array(result.output.data);
    self.postMessage({pcm,rate:config.audio.sample_rate},[pcm.buffer]);
  }catch(error){self.postMessage({error:String(error.message || error)});}
};
