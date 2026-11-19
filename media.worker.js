import { analyzeSegments } from './analysis.js';

async function readTags(file) {
  const { parseBlob, selectCover } = await import('music-metadata');
  const data = await parseBlob(file, { maxMemoryAllocation: 16 * 1024 ** 2, maxMetadataEntries: 8000, mkvUseIndex: true });
  const picture = selectCover(data.common.picture);
  return { title: data.common.title || '', artist: data.common.artist || '', format: data.format.container || '',
    album: data.common.album || '', release: data.common.musicbrainz_albumid || '',
    recording: data.common.musicbrainz_recordingid || '', isrc: data.common.isrc?.[0] || '',
    duration: data.format.duration || 0, channels: data.format.numberOfChannels || 0,
    cover: picture ? new Blob([picture.data], { type: picture.format }) : null };
}

function toWav(channels, rate) {
  const sampleCount = channels[0].length, stride = channels.length * 2;
  const data = new ArrayBuffer(44 + sampleCount * stride);
  const view = new DataView(data);
  const label = (offset, text) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * stride, true); view.setUint16(32, stride, true);
  view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, data.byteLength - 44, true);
  let offset = 44;
  for (let i = 0; i < sampleCount; i++) for (const channel of channels) {
    const value = Math.min(1, Math.max(-1, channel[i]));
    view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    offset += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}

// Classic uncompressed AIFF (Apple AIFF 1.3). Change the byte order of
// interleaved PCM directly, retaining its bit depth and integer sample rate.
async function aiffToWav(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const bad = () => new Error('AIFF incompatible o dañado. Importa una versión WAV o MP3.');
  if(bytes.length<12) throw bad();
  const end = view.getUint32(4) + 8;
  if(end>bytes.length) throw bad();
  let channels, frames, bits, rate, start, limit;
  for(let offset=12; offset+8<=end;) {
    const chunk=view.getUint32(offset), size=view.getUint32(offset+4), at=offset+8;
    if(at+size>end) throw bad();
    if(chunk===0x434f4d4d && size>=18) { // COMM
      channels=view.getUint16(at); frames=view.getUint32(at+2); bits=view.getUint16(at+6);
      const exponent=view.getUint16(at+8);
      rate=Number(view.getBigUint64(at+10))*2**(exponent-16383-63);
    }
    if(chunk===0x53534e44 && size>=8) { // SSND
      start=at+8+view.getUint32(at);limit=at+size;
    }
    offset=at+size+(size%2);
  }
  if(![8,16,24,32].includes(bits) || !(channels>=1 && channels<=2) || !frames ||
      !Number.isInteger(rate) || rate<1000 || rate>384000 || start==null) throw bad();
  const width=bits/8, stride=channels*width, length=frames*stride;
  if(start+length>limit) throw bad();
  const header=new DataView(new ArrayBuffer(44));
  header.setUint32(0,0x52494646);header.setUint32(4,36+length+(length%2),true);
  header.setUint32(8,0x57415645);header.setUint32(12,0x666d7420);header.setUint32(16,16,true);
  header.setUint16(20,1,true);header.setUint16(22,channels,true);header.setUint32(24,rate,true);
  header.setUint32(28,rate*stride,true);header.setUint16(32,stride,true);header.setUint16(34,bits,true);
  header.setUint32(36,0x64617461);header.setUint32(40,length,true);
  const pcm=new Uint8Array(length+(length%2));
  for(let n=0;n<length;n+=width) {
    for(let k=0;k<width;k++) pcm[n+k]=bytes[start+n+width-1-k];
    if(width===1) pcm[n]^=128;
  }
  return new Blob([header,pcm],{type:'audio/wav'});
}

self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.task === 'tags') result = await readTags(data.file);
    else if (data.task === 'analyze') result = analyzeSegments(data.segments, data.rate, data.starts, data.intro);
    else if (data.task === 'wav') result = toWav(data.channels, data.rate);
    else if (data.task === 'aiff') result = await aiffToWav(data.file);
    else throw new Error('Operación de audio desconocida.');
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
