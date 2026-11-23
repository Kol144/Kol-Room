// The music streams from a local Blob. Clicks are synthesized on the audio clock.
import {spanishVoice,englishVoice,speakNeural,usesNeural,primeNeural,prepareNeural} from './neural-voice.js';
import {firstSound} from './sound-onset.js';
export const defaults = Object.freeze({
  announcementGap: 3,
  announcements: true, voiceURI: '', voiceLang: 'es-ES', voiceRate: 1, voiceVolume: .75,
  countIn: true, accent: true, clickVolume: .95, clickSound: 'classic', metronomeEnabled: true,
  musicVolume: .8, restsEnabled: true, restSeconds: 20, manualReady: false, playbackSpeed: 1,
  preservesPitch: true, splitStereo: false, repeat: false, previewSeconds: 10,
  musicSinkId: '', clickSinkId: ''
});

export function bounded(value, min, max, fallback = min) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export const songSpeed = (song, settings) => bounded(song?.playbackSpeed ?? settings.playbackSpeed, .75, 1.25, 1);
export function beatPeriod(song) {
  const bpm = Math.round(bounded(song?.bpm, 20, 300, 120));
  // Keep the measured interval in seconds. Rounding it to an integer BPM
  // accumulates an audible phase error over the length of a recording.
  const measured = song?.detectedBeatPeriod;
  if (song?.bpmSource !== 'manual' && measured >= .2 && measured <= 3) {
    for (const factor of [1, .5, 2]) {
      const period = measured * factor;
      if (Math.round(60 / period) === bpm) return period;
    }
  }
  if (song?.bpmSource === 'online' && Math.round(60 / song.onlineBeatPeriod) === bpm) return song.onlineBeatPeriod;
  return 60 / bpm;
}
export const effectiveBpm = (song, settings) => 60 / beatPeriod(song) * songSpeed(song, settings);
export const restAfter = (song, settings) => bounded(song?.restOverride ?? (settings.restsEnabled ? settings.restSeconds : 0), 0, 86400);
export const validLoop = (loop, duration) => !!loop && Number.isFinite(loop.a) && Number.isFinite(loop.b)
  && loop.a >= 0 && loop.b <= duration && loop.b - loop.a >= .15;

// A constant-tempo grid in media seconds. A future tempo map can implement these operations.
export class BeatGrid {
  constructor(song, onset = null) {
    this.interval = beatPeriod(song);
    this.offset = Number(song.beatOffset) || 0;
    this.beatNumber = 0;
    if (onset != null) {
      const detected = song.detectedBpm && [1, .5, 2].some(factor => Math.abs(song.detectedBpm * factor - song.bpm) <= 1);
      if (song.beatOffsetSource === 'manual' || (song.beatOffsetSource === 'detected' && detected)) {
        // Extend the measured phase back through an intro without moving the
        // first audible cue to the first clearly identifiable drum hit.
        this.beatNumber = Math.round((onset - this.offset) / this.interval);
        this.offset += this.beatNumber * this.interval;
      } else this.offset = onset;
    }
  }
  at(index) { return this.offset + index * this.interval; }
  firstAfter(position) { return Math.max(0, Math.ceil((position - this.offset) / this.interval - 1e-7)); }
}

const aborted = () => new DOMException('Cancelado', 'AbortError');
const contextClass = () => globalThis.AudioContext || globalThis.webkitAudioContext;

// A different provider can implement voices() and speak(text, settings, signal).
export class DeviceSpeech {
  async prepare(text,settings) { if(usesNeural(settings)) await prepareNeural(text,settings); }
  voices() { return [spanishVoice,englishVoice,...(globalThis.speechSynthesis?.getVoices() || [])]; }

  speak(text, settings, signal) {
    if (usesNeural(settings)) {
      return speakNeural(text,settings,signal);
    }
    const synth = globalThis.speechSynthesis;
    if (!synth || !globalThis.SpeechSynthesisUtterance) return Promise.reject(new Error('Este dispositivo no dispone de síntesis de voz.'));
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      utterance.voice = voices.find(v => v.voiceURI === settings.voiceURI)
        || voices.find(v => v.lang === settings.voiceLang && v.localService) || null;
      utterance.lang = utterance.voice?.lang || settings.voiceLang || 'es-ES';
      utterance.rate = bounded(settings.voiceRate, .5, 2, 1);
      utterance.volume = bounded(settings.voiceVolume, 0, 1, .75);
      let timer;
      const finish = (failure, cancel = false) => {
        utterance.onend = utterance.onerror = null;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (cancel) synth.cancel();
        if (failure) reject(failure);
        else resolve();
      };
      const abort = () => finish(aborted(), true);
      utterance.onend = () => finish();
      utterance.onerror = () => finish(new Error('No se ha podido completar el anuncio de voz.'), true);
      signal.addEventListener('abort', abort, {once: true});
      // On a broken engine, leave the next sound gated by explicit confirmation.
      timer = setTimeout(() => finish(new Error('La voz no ha confirmado el final del anuncio.'), true),
        Math.min(60000, 10000 + text.length * 180 / utterance.rate));
      try { synth.speak(utterance); } catch (error) { finish(error, true); }
    });
  }
}

export class AudioOutput {
  constructor() {
    this.voices = new DeviceSpeech();
    this.nodes = new Set();
    this.visualTimers = new Set();
    this.outputChange = Promise.resolve();
    this.settings = defaults;
    this.authorizedOutputs = new Map();
  }
  get time() { return this.clickContext?.currentTime ?? 0; }
  supportsOutputs() { return !!contextClass()?.prototype?.setSinkId; }
  async listOutputs() {
    const outputs=(await navigator.mediaDevices?.enumerateDevices?.() || []).filter(d => d.kind === 'audiooutput');
    return [...new Map([...this.authorizedOutputs.values(),...outputs].map(d=>[d.deviceId,d])).values()];
  }
  async authorizeOutputs() {
    const devices=navigator.mediaDevices;
    try {
      if (devices?.selectAudioOutput) {
        const selected=await devices.selectAudioOutput();
        this.authorizedOutputs.set(selected.deviceId,selected);
      } else if (devices?.getUserMedia) {
        const stream=await devices.getUserMedia({audio:true});
        for (const track of stream.getTracks()) track.stop();
      }
    } catch (error) {
      if (error.name==='NotAllowedError') throw Error('Permiso denegado. Autoriza los dispositivos de audio en los permisos de esta web.');
      if (error.name==='NotFoundError') throw Error('Conecta los auriculares o la interfaz de audio y vuelve a autorizar los dispositivos.');
      throw error;
    }
    return this.listOutputs();
  }
  async unlock(settings) {
    const Ctx = contextClass();
    if(Ctx && settings.announcements && usesNeural(settings)) primeNeural().catch(()=>{});
    if (Ctx && !this.clickContext) {
      this.clickContext = new Ctx({latencyHint: 'interactive'});
      this.musicContext = this.supportsOutputs() ? new Ctx({latencyHint: 'interactive'}) : this.clickContext;
      const bus = (ctx) => {
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner?.();
        if (pan) gain.connect(pan).connect(ctx.destination);
        else gain.connect(ctx.destination);
        return {gain, pan};
      };
      this.clickBus = bus(this.clickContext);
      this.musicBus = bus(this.musicContext);
      for (const ctx of new Set([this.clickContext, this.musicContext])) {
        ctx.addEventListener('statechange', () => {
          if (['suspended', 'interrupted'].includes(ctx.state)) this.onInterruption?.();
        });
      }
    }
    this.configure(settings);
    // Call resume() in the initiating gesture, before awaiting storage or voices.
    await Promise.all([...new Set([this.clickContext, this.musicContext])].filter(Boolean).map(ctx =>
      ctx.state === 'running' ? undefined : ctx.resume()));
  }
  configure(settings) {
    this.settings = settings;
    const level = (bus, ctx, value, pan) => {
      if (!bus) return;
      bus.gain.gain.setTargetAtTime(bounded(value, 0, 1, .7), ctx.currentTime, .008);
      if (bus.pan) bus.pan.pan.setTargetAtTime(pan, ctx.currentTime, .008);
    };
    level(this.musicBus, this.musicContext, settings.musicVolume, settings.splitStereo ? -1 : 0);
    level(this.clickBus, this.clickContext, settings.clickVolume, settings.splitStereo ? 1 : 0);
  }
  setOutputs(musicId = '', clickId = '') {
    const route = async () => {
      if (!this.supportsOutputs()) {
        if (musicId || clickId) throw new Error('El dispositivo solo permite la salida del sistema.');
        return;
      }
      const pairs = [[this.musicContext, musicId], [this.clickContext, clickId]];
      if (!this.clickContext) throw new Error('Activa el audio antes de seleccionar la salida.');
      try {
        for (const [ctx, id] of pairs) if (ctx.sinkId !== id) await ctx.setSinkId(id);
      } catch {
        await Promise.allSettled(pairs.map(([ctx]) => ctx.setSinkId('')));
        throw new Error('Salida no disponible. Se ha solicitado la salida predeterminada del sistema.');
      }
    };
    this.outputChange = this.outputChange.catch(() => {}).then(route);
    return this.outputChange;
  }
  async load(blob, signal) {
    if (!blob?.size) throw new Error('No se encuentra el audio importado de esta canción.');
    if (signal.aborted) throw aborted();
    const audio = new Audio();
    audio.preload = 'auto';
    const url = URL.createObjectURL(blob);
    let source, splitter;
    const analysers = [];
    const dispose = () => {
      audio.pause();
      source?.disconnect();
      splitter?.disconnect();
      for (const analyser of analysers) analyser.disconnect();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    };
    try {
      await new Promise((resolve, reject) => {
        const done = (error) => {
          clearTimeout(timer);
          audio.removeEventListener('canplay', ready);
          audio.removeEventListener('error', failure);
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const ready = () => done();
        const failure = () => done(new Error('El navegador no puede reproducir este archivo.'));
        const abort = () => done(aborted());
        const timer = setTimeout(() => done(new Error('El archivo no estuvo listo a tiempo. Puedes reintentarlo.')), 20000);
        audio.addEventListener('canplay', ready);
        audio.addEventListener('error', failure);
        signal.addEventListener('abort', abort, {once:true});
        audio.src = url;
        audio.load();
      });
      if (signal.aborted) throw aborted();
      if (this.musicContext) {
        source = this.musicContext.createMediaElementSource(audio);
        source.connect(this.musicBus.gain);
        splitter = this.musicContext.createChannelSplitter(2);
        source.connect(splitter);
        const rate = this.musicContext.sampleRate;
        const size = Math.min(32768, 2 ** Math.ceil(Math.log2(rate * .055)));
        const channels = Array.from({length:2}, (_, i) => {
          const analyser = this.musicContext.createAnalyser();
          analyser.fftSize = size;
          splitter.connect(analyser, i);
          analysers.push(analyser);
          return new Float32Array(size);
        });
        return {audio,dispose,measureEntry:async signal => {
          const {measureEntry} = await import('./media.js');
          return measureEntry(blob,audio.duration,signal);
        },soundAge:() => {
          analysers.forEach((analyser, i) => analyser.getFloatTimeDomainData(channels[i]));
          const onset = firstSound(channels, rate);
          return onset == null ? null : size / rate - onset;
        }};
      }
      return {audio, dispose};
    } catch (err) { dispose(); throw err; }
  }
  applyMedia(audio, speed, settings) {
    audio.playbackRate = speed;
    if ('preservesPitch' in audio) audio.preservesPitch = settings.preservesPitch;
    else if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = settings.preservesPitch;
    if (!this.musicContext) audio.volume = bounded(settings.musicVolume, 0, 1);
  }
  testOutput(kind) {
    const music=kind==='music';
    const ctx=music ? this.musicContext : this.clickContext;
    const bus=music ? this.musicBus : this.clickBus;
    if (!ctx || !bus) throw Error('Activa el audio para probar la salida.');
    const tone=ctx.createOscillator(), envelope=ctx.createGain();
    tone.frequency.value=music ? 440 : 1000;
    const at=ctx.currentTime;
    envelope.gain.setValueAtTime(0,at);
    envelope.gain.linearRampToValueAtTime(music ? .2 : .7,at+.02);
    envelope.gain.linearRampToValueAtTime(0,at+.6);
    tone.connect(envelope).connect(bus.gain);
    tone.onended=()=>{tone.disconnect();envelope.disconnect();};
    tone.start(at);tone.stop(at+.65);
  }
  click(at, beat, onBeat) {
    const ctx = this.clickContext;
    if (!ctx) throw new Error('El navegador no dispone de Web Audio para los clics.');
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const accent = this.settings.accent && beat % 4 === 0;
    const wood = this.settings.clickSound === 'wood';
    oscillator.type = wood ? 'triangle' : 'sine';
    oscillator.frequency.value = wood ? (accent ? 1500 : 1000) : (accent ? 1200 : 800);
    const t = Math.max(at, ctx.currentTime);
    gain.gain.setValueAtTime(.0001, t);
    // Keep ample headroom below full scale while making the click audible
    // over music played at rehearsal volume.
    gain.gain.exponentialRampToValueAtTime(.8, t + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, t + .055);
    oscillator.connect(gain).connect(this.clickBus.gain);
    const node = {oscillator, gain};
    this.nodes.add(node);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.nodes.delete(node);
    };
    oscillator.start(t);
    oscillator.stop(t + .06);
    if (onBeat) {
      const delay = Math.max(0, t - ctx.currentTime + (ctx.outputLatency || 0));
      const timer = setTimeout(() => { this.visualTimers.delete(timer); onBeat(beat % 4 + 1); }, delay * 1000);
      this.visualTimers.add(timer);
    }
  }
  cancelClicks() {
    for (const {oscillator, gain} of this.nodes) {
      gain.disconnect();
      try { oscillator.stop(); } catch { /* already ended */ }
    }
    this.nodes.clear();
    for (const timer of this.visualTimers) clearTimeout(timer);
    this.visualTimers.clear();
  }
}
