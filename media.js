import {firstSound} from './sound-onset.js';
const analysisRate = 11025;
const maxInput = 64 * 1024 ** 2;
const maxDuration = 12 * 60;
const unavailable = analysisStatus => ({ analysisStatus, detectedBpm: null, detectedKey: '',
  bpmConfidence: 0, keyConfidence: 0, bpmAlternatives: [] });
const aborted = () => new DOMException('Importación cancelada.', 'AbortError');

function checkSignal(signal) {
  if (signal?.aborted) throw aborted();
}

function inWorker(data, signal, transfer = []) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./media.worker.js', import.meta.url), { type: 'module' });
    const finish = (action, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      action(value);
    };
    const cancel = () => finish(reject, aborted());
    const timer = setTimeout(() => finish(reject, new Error('El análisis ha superado el tiempo disponible.')), 60000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => event.data.error ? finish(reject, new Error(event.data.error)) : finish(resolve, event.data.result);
    worker.onerror = () => finish(reject, new Error('No se pudo procesar el archivo en segundo plano.'));
    try { worker.postMessage(data, transfer); } catch (error) { finish(reject, error); }
  });
}

// Probe actual decoded media readiness without playing anything. Formats and
// MIME hints alone cannot establish that this device can render a given file.
function probe(blob, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const media = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const finish = (action, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      media.oncanplay = media.onerror = null;
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
      action(value);
    };
    const cancel = () => finish(reject, aborted());
    const timer = setTimeout(() => finish(reject, new Error('No se pudo abrir el audio.')), 15000);
    signal?.addEventListener('abort', cancel, { once: true });
    media.preload = 'auto';
    media.onerror = () => finish(reject, new Error('Formato incompatible o archivo dañado.'));
    media.oncanplay = () => finish(resolve, Number.isFinite(media.duration) ? media.duration : 0);
    media.src = url;
    media.load();
  });
}

async function decoded(blob, rate, signal) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('El decodificador local no está disponible.');
  const bytes = await blob.arrayBuffer();
  checkSignal(signal);
  const buffer = await new Offline(1, 1, rate).decodeAudioData(bytes);
  checkSignal(signal);
  if (!buffer.length || !buffer.numberOfChannels) throw new Error('El archivo no contiene audio decodificable.');
  return buffer;
}

function mixPassage(channels, start, length) {
  if (channels.length === 1) return channels[0].slice(start, start + length);
  const mix = new Float32Array(length);
  let loudest = channels[0], maxEnergy = 0;
  for (const channel of channels) {
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const value = channel[start + i];
      mix[i] += value / channels.length;
      energy += value * value;
    }
    if (energy > maxEnergy) { maxEnergy = energy; loudest = channel; }
  }
  let mixEnergy = 0;
  for (const value of mix) mixEnergy += value * value;
  if (mixEnergy < maxEnergy * .1) mix.set(loudest.subarray(start, start + length));
  return mix;
}

function passages(buffer, channels) {
  const span = Math.min(buffer.length, Math.round(buffer.sampleRate * 18));
  const segments = [], starts = [];
  const count = Math.max(1, Math.min(3, Math.floor(buffer.length / span)));
  for (let n = 0; n < count; n++) {
    const start = count === 1 ? 0 : Math.floor((buffer.length - span) * n / (count - 1));
    segments.push(mixPassage(channels, start, span));
    starts.push(start / buffer.sampleRate);
  }
  return {segments, starts};
}

async function analyze(blob, duration, options) {
  const { signal, onStatus } = options;
  checkSignal(signal);
  if (blob.size > maxInput || duration > maxDuration) {
    return { result: unavailable('Análisis omitido por tamaño o duración. Puedes introducir los valores manualmente.'), duration };
  }
  onStatus?.('Analizando canción…');
  try {
    const buffer = await decoded(blob, analysisRate, signal);
    const channels = Array.from({length:buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
    const soundOnset = firstSound(channels, buffer.sampleRate);
    const {segments,starts} = passages(buffer, channels);
    const intro = mixPassage(channels, 0, Math.min(buffer.length,60*buffer.sampleRate));
    const result = await inWorker({ task: 'analyze', rate: buffer.sampleRate, segments, starts, intro }, signal, [...segments.map(s => s.buffer),intro.buffer]);
    return { result: {...result, soundOnset}, duration: buffer.duration };
  } catch (error) {
    checkSignal(signal);
    return { result: unavailable('Análisis no disponible en este dispositivo.'), duration };
  }
}

export async function analyzeAudio(blob, options = {}) {
  const duration = await probe(blob, options.signal);
  return (await analyze(blob, duration, options)).result;
}

// Older imports lack a sample onset. Inspect their opening without rerunning
// the spectral tempo/key analysis. Large files stay within the mobile budget.
export async function measureEntry(blob, duration, signal) {
  try {
    const input = blob.size > maxInput || duration > maxDuration ? blob.slice(0, 2 * 1024 ** 2) : blob;
    const buffer = await decoded(input, analysisRate, signal);
    return firstSound(Array.from({length:buffer.numberOfChannels}, (_,i) => buffer.getChannelData(i)),buffer.sampleRate);
  } catch { checkSignal(signal); return null; }
}

export async function prepareCover(blob) {
  if (!blob || !blob.size || blob.size > 16 * 1024 ** 2) throw new Error('Elige una imagen de hasta 16 MB.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('La imagen no es compatible.'));
      image.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('La imagen está vacía.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(side, 640);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#181818';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
      0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo guardar la portada.')), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

const incompatible = 'Este archivo no se puede reproducir ni convertir aquí. Importa una versión MP3 o WAV compatible.';

async function convert(file, tags, options) {
  if (file.size > maxInput || tags.duration * (tags.channels || 2) * 44100 > 32e6) throw new Error(incompatible);
  const ask = options.confirmConversion || (() => window.confirm('Este archivo necesita conversión. ¿Crear una copia WAV en el dispositivo y conservar el original?'));
  const signature = await file.slice(0,12).text();
  if (signature.startsWith('FORM') && signature.endsWith('AIFF')) {
    if (!await ask(file)) throw aborted();
    options.onStatus?.('Convirtiendo AIFF a WAV en el dispositivo…');
    const wav = await inWorker({task:'aiff',file},options.signal);
    return {wav, duration:await probe(wav,options.signal)};
  }
  let buffer;
  try { buffer = await decoded(file, 44100, options.signal); }
  catch { checkSignal(options.signal); throw new Error(incompatible); }
  if (buffer.length * buffer.numberOfChannels > 32e6) throw new Error('La conversión superaría la memoria disponible. Importa una versión MP3 o WAV.');
  if (!await ask(file)) throw aborted();
  checkSignal(options.signal);
  options.onStatus?.('Convirtiendo a WAV en el dispositivo…');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
  const wav = await inWorker({ task: 'wav', channels, rate: buffer.sampleRate }, options.signal, channels.map(channel => channel.buffer));
  const duration = await probe(wav, options.signal);
  return { wav, duration };
}

export async function prepareAudio(file, options = {}) {
  if (!file?.size) throw new Error('El archivo está vacío.');
  const { signal, onStatus } = options;
  checkSignal(signal);
  onStatus?.('Comprobando el archivo…');
  const [metadata, probeResult] = await Promise.allSettled([
    inWorker({ task: 'tags', file }, signal), probe(file, signal),
  ]);
  checkSignal(signal);
  const tags = metadata.status === 'fulfilled' ? metadata.value : {};
  let playable = null, duration = probeResult.status === 'fulfilled' ? probeResult.value || tags.duration : 0;
  if (probeResult.status === 'rejected') {
    const conversion = await convert(file, tags, options);
    playable = conversion.wav;
    duration = conversion.duration;
  }
  const { result, duration: decodedDuration } = await analyze(playable || file, duration || 0, options);
  // Variable-bitrate ADTS/MP3 headers may give the media element only a
  // bitrate-based estimate. A successful decode gives the actual frame count.
  duration = decodedDuration || duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('No se pudo determinar la duración del audio. Prueba a importarlo como MP3 o WAV.');
  let cover = null;
  if (tags.cover) {
    try { cover = await prepareCover(tags.cover); } catch { /* An unreadable cover does not invalidate the music. */ }
  }
  checkSignal(signal);
  return { original: file, playable, cover, duration, name: file.name || 'Audio',
    type: tags.format || file.type || 'Audio', tagTitle: tags.title || '', tagArtist: tags.artist || '',
    tagAlbum: tags.album || '', tagRelease: tags.release || '', tagRecording: tags.recording || '',
    tagIsrc: tags.isrc || '', analysis: result };
}
