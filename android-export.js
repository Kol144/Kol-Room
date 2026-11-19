import {registerPlugin} from '@capacitor/core';
const documents = registerPlugin('DocumentExport');

function encode(blob) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result.split(',')[1]);
    reader.onerror = ()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportDocument(blob, name) {
  const {session} = await documents.choose({name,type:blob.type || 'application/octet-stream'}) || {};
  if (!session) return;
  const chunkSize = 192 * 1024;
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const data = await encode(blob.slice(offset,offset+chunkSize));
      await documents.append({session,data});
    }
  } finally { await documents.finish({session}); }
}
