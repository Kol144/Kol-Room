import {copyFile,mkdir} from 'node:fs/promises';
const output = 'public/voice/runtime/';
await mkdir(output,{recursive:true});
for(const [folder,files] of [
  ['@diffusionstudio/piper-wasm/build',['piper_phonemize.js','piper_phonemize.data','piper_phonemize.wasm']],
  ['onnxruntime-web/dist',['ort.wasm.min.js','ort-wasm.wasm','ort-wasm-simd.wasm']]
]) for(const file of files) await copyFile('node_modules/'+folder+'/'+file,output+file);
