import { AudioOutput, BeatGrid, bounded, defaults, effectiveBpm, restAfter, songSpeed, validLoop } from './audio-output.js';
import {announcement} from './song-speech.js';

const clock = {
  now: () => performance.now(), wall: () => Date.now(),
  every: (fn, delay) => setInterval(fn, delay), clear: handle => clearInterval(handle)
};
const activeMusic = phase => phase === 'playing' || phase === 'practice';
const inactive = phase => phase === 'idle' || phase === 'finished';

export class PlaybackEngine {
  constructor({getAudio, getSettings = () => ({}), onChange, output = new AudioOutput(), timing = clock}) {
    this.getAudio = getAudio;
    this.getSettings = getSettings;
    this.lastSettings = this.settings;
    this.output = output;
    this.timing = timing;
    this.listeners = new Set(onChange ? [onChange] : []);
    this.task = new AbortController();
    this.state = 'idle';
    this.mode = 'single';
    this.queue = [];
    this.index = -1;
    this.completed = 0;
    this.message = '';
    this.beat = 0;
    this.loop = null;
    this.suspend = () => {
      this.stopMetronome();
      if (this.state === 'preview') this.restorePreview(false);
      this.pause();
      this.voicePreview?.abort();
    };
    this.visibility = () => { if (globalThis.document?.hidden) this.suspend(); };
    this.output.onInterruption = this.suspend;
    globalThis.document?.addEventListener('visibilitychange', this.visibility);
    globalThis.document?.addEventListener('freeze', this.suspend);
    globalThis.addEventListener?.('pagehide', this.suspend);
  }

  get settings() { return {...defaults, ...this.getSettings()}; }
  get song() { return this.queue[this.index]; }
  get duration() {
    const n = this.track?.audio.duration;
    return Number(this.song?.duration) || (Number.isFinite(n) ? n : 0);
  }
  get remaining() {
    if (this.state === 'resting') return Math.max(0, (this.deadline - this.timing.now()) / 1000);
    return this.state === 'paused' && this.pausedFrom === 'resting' ? this.savedRest : 0;
  }
  snapshot() {
    return {
      state: this.state, mode: this.mode, queue: this.queue, index: this.index, song: this.song || null,
      next: this.queue[this.index + 1] || (this.repeatAtEnd() ? this.queue[0] : null),
      position: this.track?.audio.currentTime || 0, duration: this.duration,
      remaining: this.remaining, beat: this.beat, completed: this.completed,
      message: this.message, pausedFrom: this.pausedFrom || null, loop: this.loop,
      previewStage: this.previewStage || null, previewSpeed: this.previewSpeed || null
    };
  }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  emit() {
    const snapshot = this.snapshot();
    for (const render of this.listeners) render(snapshot);
  }
  setState(state) { this.state = state; this.emit(); }
  repeatAtEnd() { return this.mode === 'set' && this.settings.repeat && this.queue.length > 0 && !inactive(this.state); }

  // One task owns all callbacks and all pending clicks for the current phase.
  cancelTask() {
    this.task.abort();
    this.task = new AbortController();
    this.stopClock();
    this.output.cancelClicks();
    this.beat = 0;
    return this.task.signal;
  }
  stopClock() {
    if (this.timer != null) this.timing.clear(this.timer);
    this.timer = null;
  }
  startClock(tick) {
    this.stopClock();
    this.lastWall = this.timing.wall();
    this.lastClock = this.timing.now();
    this.timer = this.timing.every(() => {
      if (this.interrupted()) return;
      this.lastWall = this.timing.wall();
      this.lastClock = this.timing.now();
      try { tick(); } catch (err) { this.fail(err); }
    }, 25);
  }
  interrupted() {
    if (!globalThis.document?.hidden && (this.lastWall == null || this.timing.wall() - this.lastWall < 1600)) return false;
    if (this.state === 'resting' && this.timing.wall() - this.lastWall >= 1600)
      this.deadline += Math.max(0, this.timing.now() - this.lastClock);
    this.suspend();
    return true;
  }
  allowed(signal) { return !signal.aborted && !this.interrupted(); }
  releaseTrack() { this.track?.dispose(); this.track = null; }
  fail(err) {
    this.cancelTask();
    this.track?.audio.pause();
    this.message = err?.message || 'No se ha podido reproducir la canción.';
    this.setState('error');
  }
  stop() {
    this.stopMetronome();
    this.voicePreview?.abort();
    this.cancelTask();
    this.previewTrack?.dispose();
    this.previewTrack = null;
    this.previewStage = null;
    this.previewSpeed = null;
    this.releaseTrack();
    this.queue = [];
    this.index = -1;
    this.mode = 'single';
    this.loop = this.pausedFrom = null;
    this.completed = 0;
    this.message = '';
    this.setState('idle');
  }
  dispose() {
    this.stop();
    globalThis.document?.removeEventListener('visibilitychange', this.visibility);
    globalThis.document?.removeEventListener('freeze', this.suspend);
    globalThis.removeEventListener?.('pagehide', this.suspend);
    this.output.onInterruption = null;
    for (const ctx of new Set([this.output.clickContext, this.output.musicContext])) ctx?.close?.();
    this.listeners.clear();
  }

  open(song) { return this.start([song], {mode:'single', opened:true}); }
  start(songs, options = {}) {
    this.stop();
    this.mode = options.mode || 'set';
    const playable = songs.filter(s => s?.audioId).map(s => ({...s}));
    this.queue = this.mode === 'set' ? playable : playable.slice(0, 1);
    this.countOverride = options.countIn;
    this.loop = this.mode === 'practice' ? options.loop || null : null;
    if (!this.queue.length) { this.fail(new Error('Importa un archivo de audio para reproducir una canción.')); return; }
    return this.select(0, !!options.opened);
  }
  async select(index, opened = false) {
    if (!this.queue[index]) return this.finish();
    const signal = this.cancelTask();
    this.releaseTrack();
    this.index = index;
    this.opened = opened;
    this.pausedFrom = null;
    this.noVoice = false;
    this.message = '';
    this.passes = 0;
    this.setState('loading');
    this.startClock(() => {});
    try {
      const settings = this.settings;
      await this.output.unlock(settings);
      if (!this.allowed(signal)) return;
      try { await this.output.setOutputs(settings.musicSinkId || '', settings.clickSinkId || ''); }
      catch (err) { this.message = err.message; }
      if (!this.allowed(signal)) return;
      const blob = await this.getAudio(this.song.audioId);
      if (!this.allowed(signal)) return;
      const track = await this.output.load(blob, signal);
      if (!this.allowed(signal)) { track.dispose(); return; }
      this.track = track;
      this.applyTrack();
      if (this.loop && !validLoop(this.loop, this.duration)) return this.fail(new Error('El fragmento A–B no está dentro del audio.'));
      if (this.loop) track.audio.currentTime = this.loop.a;
      this.liveOnset = null;
      this.resetPosition(track.audio.currentTime);
      if (opened) {
        this.stopClock();
        this.pausedFrom = 'loaded';
        this.setState('paused');
      } else this.prepare();
    } catch (err) { if (!signal.aborted) this.fail(err); }
  }
  applyTrack() { if (this.track) this.output.applyMedia(this.track.audio, songSpeed(this.song, this.settings), this.settings); }
  prepare() {
    if (this.mode !== 'practice' && (this.song.manualReadyOverride ?? this.settings.manualReady)) {
      this.stopClock();
      this.setState('preparing');
    } else this.announce();
  }
  ready() {
    if (this.state !== 'preparing') return;
    this.lastWall = this.timing.wall();
    if (this.noVoice) this.countIn();
    else this.announce();
  }
  async announce() {
    if (this.mode === 'practice' || !this.settings.announcements) return this.countIn();
    const signal = this.cancelTask();
    this.setState('announcing');
    this.startClock(() => {});
    try {
      const spoken=announcement(this.song,this.settings,this.getVoices());
      await this.output.voices.speak(spoken.text, spoken.settings, signal);
      if (this.allowed(signal)) this.afterAnnouncement();
    } catch (err) {
      if (!this.allowed(signal)) return;
      this.message = err.message + ' Anuncio visual.';
      this.emit();
      // The timed visual fallback only starts after speech has failed or been cancelled.
      // If the device still reports speech in flight, keep the next sound manually gated.
      if (globalThis.speechSynthesis?.speaking) {
        this.stopClock();
        this.noVoice = true;
        this.setState('preparing');
      } else {
        const until = this.timing.now() + 1500;
        this.startClock(() => { if (this.timing.now() >= until) this.countIn(); });
      }
    }
  }
  afterAnnouncement(seconds=bounded(this.settings.announcementGap,0,15,3)) {
    if(!seconds || !(this.countOverride ?? this.settings.countIn))return this.countIn();
    this.cancelTask();
    this.gapEnd=this.timing.now()+seconds*1000;
    this.setState('announcementGap');
    this.startClock(()=>{if(this.timing.now()>=this.gapEnd)this.countIn();});
  }
  countIn() {
    if (!(this.countOverride ?? this.settings.countIn)) return this.playTrack();
    const signal = this.cancelTask();
    const period = 60 / effectiveBpm(this.song, this.settings);
    const first = this.output.time + .05;
    this.setState('countIn');
    try {
      const pulse = n => { if (!signal.aborted) { this.beat = n; this.emit(); } };
      for (let i = 0; i < 4; i++) this.output.click(first + period * i, i, pulse);
    } catch (err) { return this.fail(err); }
    const downbeat = first + 4 * period;
    this.startClock(() => {
      if (this.output.time < downbeat) return;
      if (this.output.time - downbeat > .3) return this.pause();
      this.playTrack();
    });
  }
  async playTrack() {
    if (!this.track) return this.select(this.index);
    const signal = this.cancelTask();
    const audio = this.track.audio;
    this.applyTrack();
    this.lastBeat = null;
    this.lastPaint = -Infinity;
    this.buffering = false;
    const listen = (event, fn) => audio.addEventListener(event, fn, {signal});
    listen('ended', () => { if (audio.ended && this.allowed(signal)) this.endMedia(); });
    listen('error', () => this.fail(new Error('Se ha interrumpido la lectura del audio. Puedes reintentar u omitir la canción.')));
    listen('waiting', () => { this.buffering = true; this.resetGrid(); });
    listen('seeking', () => { this.buffering = true; this.resetPosition(audio.currentTime); this.resetGrid(); });
    for (const event of ['playing', 'seeked']) listen(event, () => {
      this.buffering = audio.seeking || audio.readyState < 3; this.resetGrid();
    });
    listen('pause', () => {
      if (audio.paused && !audio.ended && !audio.seeking && activeMusic(this.state)) this.pause();
    });
    this.setState(this.mode === 'practice' ? 'practice' : 'playing');
    this.startClock(() => this.musicTick());
    try {
      await audio.play();
      if (this.allowed(signal)) this.musicTick();
    } catch (err) {
      if (!signal.aborted) this.fail(new Error('No se pudo iniciar la música. Pulsa Reintentar. ' + (err.message || '')));
    }
  }
  resetGrid() {
    this.output.cancelClicks();
    this.lastBeat = null;
    const onset = this.song?.soundOnset ?? this.liveOnset;
    if (onset != null && this.track?.audio.currentTime < onset) this.entryPending = true;
  }
  resetPosition(position) {
    const onset = this.song.soundOnset ?? this.liveOnset;
    this.seekOnset = null;
    this.segmentStart = position;
    this.listeningFromStart = position <= .025;
    this.heardAfterSeek = false;
    this.entryPending = onset == null ? this.listeningFromStart : position <= onset;
  }
  musicTick() {
    const audio = this.track.audio;
    if (audio.paused || audio.seeking || this.buffering || audio.readyState < 2) return;
    const position = audio.currentTime;
    if (this.loop && position >= this.loop.b) return this.endPass();
    this.scheduleMusicClicks(position, audio.playbackRate);
    if (this.timing.now() - this.lastPaint >= 100) { this.lastPaint = this.timing.now(); this.emit(); }
  }
  scheduleMusicClicks(position, rate) {
    let onset = this.song.soundOnset ?? this.liveOnset ?? this.seekOnset;
    if (onset == null && this.track.soundAge && !this.heardAfterSeek) {
      const age = this.track.soundAge();
      if (age == null) return;
      this.heardAfterSeek = true;
      const heardAt = Math.max(this.segmentStart, position - age * rate);
      if (this.listeningFromStart) this.liveOnset = onset = heardAt;
      else if (heardAt - this.segmentStart > .12 * rate) {
        this.seekOnset = onset = heardAt;
        this.entryPending = true;
      } else this.seekOnset = onset = 0;
    }
    if (!(this.song.metronomeEnabledOverride ?? this.settings.metronomeEnabled)) {
      if (onset != null && position >= onset) this.entryPending = false;
      return;
    }
    const boundary = Math.min(position + .12 * rate, this.loop?.b ?? this.duration);
    if (onset != null && boundary <= onset) return;
    const grid = new BeatGrid(this.song, onset);
    const at = mediaTime => this.output.time + Math.max(0, mediaTime - position) / rate;
    if (onset != null && this.entryPending) {
      this.output.click(at(onset), 0);
      this.entryPending = false;
    }
    // The first cue follows the audible sample. Subsequent beats retain their
    // original recording phase, including after pausing, seeking and speed changes.
    let beat = Math.max(onset == null ? 0 : 1, (this.lastBeat ?? -1) + 1, grid.firstAfter(position - .012 * rate));
    while (grid.at(beat) < boundary) {
      this.output.click(at(grid.at(beat)), beat + grid.beatNumber);
      this.lastBeat = beat++;
    }
  }
  endPass() {
    this.passes++;
    if (this.loop.repeats > 0 && this.passes >= this.loop.repeats) {
      this.completed++;
      return this.finish();
    }
    const ended = this.track.audio.ended;
    this.seek(this.loop.a);
    if (ended) this.playTrack();
  }
  endMedia() {
    if (this.loop) return this.endPass();
    this.completed++;
    if (!this.queue[this.index + 1] && !this.repeatAtEnd()) return this.finish();
    const seconds = restAfter(this.song, this.settings);
    if (seconds > 0) this.rest(seconds);
    else this.advance();
  }
  rest(seconds) {
    this.cancelTask();
    this.deadline = this.timing.now() + seconds * 1000;
    this.lastPaint = -Infinity;
    this.setState('resting');
    this.startClock(() => {
      if (this.remaining <= 0) return this.advance();
      if (this.timing.now() - this.lastPaint >= 100) { this.emit(); this.lastPaint = this.timing.now(); }
    });
  }
  skipRest() {
    if (this.state === 'resting' || (this.state === 'paused' && this.pausedFrom === 'resting')) this.advance();
  }
  addRest(seconds = 10) {
    const delta = bounded(seconds, 0, 86400);
    if (this.state === 'resting') this.deadline += delta * 1000;
    else if (this.state === 'paused' && this.pausedFrom === 'resting') this.savedRest += delta;
    else return;
    this.emit();
  }
  advance() { this.select(this.index + 1 < this.queue.length ? this.index + 1 : 0); }
  next() { if (this.state !== 'preview' && this.queue.length) this.select(this.index + 1); }
  previous() { if (this.state !== 'preview' && this.queue.length) this.select(Math.max(0, this.index - 1)); }
  restart() { if (this.state !== 'preview' && this.song) this.select(this.index); }
  retry() { if (this.state === 'error') this.restart(); }
  finish() {
    this.cancelTask();
    this.releaseTrack();
    this.pausedFrom = null;
    this.message = '';
    this.setState('finished');
  }
  pause() {
    if (inactive(this.state) || ['paused', 'preparing', 'error', 'preview'].includes(this.state)) return;
    this.pausedFrom = this.state;
    if(this.state==='announcementGap')this.savedGap=Math.max(0,(this.gapEnd-this.timing.now())/1000);
    this.savedRest = this.remaining;
    this.cancelTask();
    this.track?.audio.pause();
    this.setState('paused');
  }
  async resume() {
    if (this.state !== 'paused') return;
    this.stopMetronome();
    this.voicePreview?.abort();
    const signal = this.task.signal;
    this.lastWall = this.timing.wall();
    try { await this.output.unlock(this.settings); }
    catch (err) { if (!signal.aborted) this.fail(err); return; }
    if (this.state !== 'paused' || !this.allowed(signal)) return;
    const phase = this.pausedFrom;
    this.pausedFrom = null;
    if (phase === 'loading') return this.select(this.index, this.opened);
    if (phase === 'resting') return this.rest(this.savedRest);
    if (phase === 'loaded') return this.prepare();
    if (phase === 'announcing') return this.announce();
    if (phase === 'announcementGap') return this.afterAnnouncement(this.savedGap);
    if (phase === 'countIn') return this.countIn();
    return this.playTrack();
  }
  seek(position) {
    if (!this.track || !(activeMusic(this.state) || this.state === 'paused')) return;
    if (this.state === 'paused' && !['loaded','playing','practice'].includes(this.pausedFrom)) return;
    this.resetGrid();
    this.track.audio.currentTime = bounded(position, 0, this.duration);
    this.resetPosition(this.track.audio.currentTime);
    this.emit();
  }
  updateSong(song) {
    const index = this.queue.findIndex(s => s.id === song.id);
    if (index < 0) return;
    const old = this.queue[index];
    this.queue[index] = {...old, ...song};
    if (index === this.index) {
      this.applyTrack();
      if (['bpm','bpmSource','detectedBeatPeriod','playbackSpeed','beatOffset','beatOffsetSource','soundOnset','metronomeEnabledOverride'].some(key => old[key] !== this.song[key])) {
        this.resetGridIfPlaying();
      }
      if (this.state === 'countIn' && effectiveBpm(old, this.settings) !== effectiveBpm(this.song, this.settings)) this.countIn();
    }
    this.emit();
  }
  resetGridIfPlaying() { if (activeMusic(this.state)) this.resetGrid(); }
  refreshSettings() {
    const settings = this.settings;
    const changedRate = songSpeed(this.song, settings) !== songSpeed(this.song, this.lastSettings);
    const changedClick = this.song?.metronomeEnabledOverride == null && settings.metronomeEnabled !== this.lastSettings.metronomeEnabled;
    this.lastSettings = settings;
    this.output.configure(settings);
    this.applyTrack();
    if (changedRate && this.state === 'countIn') this.countIn();
    if (changedRate || changedClick) this.resetGridIfPlaying();
    this.emit();
  }
  setLoop(loop) {
    if (this.mode === 'set' || !this.song || !this.track || this.state === 'preview') return false;
    if (loop && !validLoop(loop, this.duration)) return false;
    this.loop = loop ? {...loop, repeats: Math.floor(bounded(loop.repeats, 0, 10000))} : null;
    this.passes = 0;
    this.mode = loop ? 'practice' : 'single';
    if (activeMusic(this.state)) this.state = loop ? 'practice' : 'playing';
    if (loop && (this.track.audio.currentTime < loop.a || this.track.audio.currentTime >= loop.b)) this.seek(loop.a);
    this.resetGridIfPlaying();
    this.emit();
    return true;
  }

  async preview(song, speed, start = 0) {
    if (this.state === 'preview' || (this.mode === 'set' && !inactive(this.state))
      || !(inactive(this.state) || activeMusic(this.state) || (this.state === 'paused' && ['loaded','playing','practice'].includes(this.pausedFrom)))) {
      throw new Error('Detén el repertorio antes de escuchar una vista previa.');
    }
    if (!song?.audioId) throw new Error('Primero importa audio para esta canción.');
    this.stopMetronome();
    this.voicePreview?.abort();
    this.previewBefore = this.state;
    const signal = this.cancelTask();
    this.track?.audio.pause();
    this.previewStage = 'original';
    this.previewSpeed = bounded(speed, .75, 1.25, 1);
    this.setState('preview');
    this.startClock(() => {});
    try {
      await this.output.unlock(this.settings);
      if (!this.allowed(signal)) return;
      try { await this.output.setOutputs(this.settings.musicSinkId || '', this.settings.clickSinkId || ''); }
      catch (err) { this.message = err.message; }
      if (!this.allowed(signal)) return;
      const blob = await this.getAudio(song.audioId);
      if (!this.allowed(signal)) return;
      const track = await this.output.load(blob, signal);
      if (!this.allowed(signal)) { track.dispose(); return; }
      this.previewTrack = track;
      const audio = track.audio;
      const duration = song.duration || audio.duration;
      // The two passes cover exactly the same musical fragment; together they last 10–15 seconds.
      const maxTotal = bounded(this.settings.previewSeconds, 10, 15, 10);
      const extent = Math.min(duration, maxTotal / (1 + 1 / this.previewSpeed));
      const from = bounded(start, 0, Math.max(0, duration - extent));
      const to = from + extent;
      let switching = false;
      const nextPass = async () => {
        if (switching || !this.allowed(signal)) return;
        if (this.previewStage === 'changed') return this.restorePreview(true);
        switching = true;
        this.previewStage = 'changed';
        audio.pause();
        this.output.applyMedia(audio, this.previewSpeed, this.settings);
        audio.currentTime = from;
        this.emit();
        try { await audio.play(); }
        catch (err) { if (!signal.aborted) { this.message = err.message; this.restorePreview(true); } }
        finally { switching = false; }
      };
      audio.addEventListener('ended', () => { if (audio.ended) nextPass(); }, {signal});
      audio.addEventListener('error', () => {
        if (!signal.aborted) { this.message = 'No se pudo reproducir la comparación.'; this.restorePreview(true); }
      }, {signal});
      this.output.applyMedia(audio, 1, this.settings);
      audio.currentTime = from;
      await audio.play();
      if (!this.allowed(signal)) return;
      this.startClock(() => { if (!audio.seeking && audio.currentTime >= to) nextPass(); });
    } catch (err) {
      if (!signal.aborted) { this.restorePreview(true); throw err; }
    }
  }
  restorePreview(resume) {
    if (this.state !== 'preview') return;
    this.cancelTask();
    this.previewTrack?.dispose();
    this.previewTrack = null;
    this.previewStage = this.previewSpeed = null;
    const before = this.previewBefore;
    if (activeMusic(before)) {
      this.pausedFrom = before;
      this.setState('paused');
      if (resume && !globalThis.document?.hidden) this.resume();
    } else this.setState(before);
  }
  cancelPreview() { this.restorePreview(true); }
  getVoices() { return this.output.voices.voices(); }
  async previewVoice() {
    if (!inactive(this.state) && this.state !== 'paused') throw new Error('Pausa la sesión para escuchar la voz.');
    this.voicePreview?.abort();
    const task = this.voicePreview = new AbortController();
    try { await this.output.voices.speak(/^en\b/i.test(this.settings.voiceLang) ? 'Kol Room. Ready for rehearsal.' : 'Kol Room. Todo listo para el ensayo.', this.settings, task.signal); }
    finally { if (task === this.voicePreview) this.voicePreview = null; }
  }
  supportsOutputs() { return this.output.supportsOutputs(); }
  listOutputs() { return this.output.listOutputs(); }
  authorizeOutputs() { return this.output.authorizeOutputs(); }
  async testOutput(kind) {
    if (!inactive(this.state) || this.metroTask) throw Error('Detén la reproducción y el metrónomo para probar las salidas.');
    await this.setOutputs(this.settings.musicSinkId || '',this.settings.clickSinkId || '');
    this.output.testOutput(kind);
  }
  async setOutputs(musicId = '', clickId = '') {
    await this.output.unlock(this.settings);
    return this.output.setOutputs(musicId, clickId);
  }
  async startMetronome(bpm, onBeat) {
    if (!inactive(this.state) && this.state !== 'paused') throw new Error('Pausa la reproducción para usar el metrónomo independiente.');
    this.stopMetronome();
    const task = this.metroTask = new AbortController();
    try {
      await this.output.unlock(this.settings);
      if (task.signal.aborted) return;
      const settings = this.settings;
      try { await this.output.setOutputs(settings.musicSinkId || '', settings.clickSinkId || ''); }
      catch (err) { this.message = err.message; this.emit(); }
      if (task.signal.aborted) return;
      const interval = 60 / Math.round(bounded(bpm, 20, 300, 120));
      const first = this.output.time + .035;
      let beat = 0;
      const schedule = () => {
        if (task.signal.aborted) return;
        const now = this.output.time;
        beat = Math.max(beat, Math.ceil((now - first - .02) / interval));
        while (first + beat * interval <= now + .12) {
          this.output.click(first + beat * interval, beat, onBeat);
          beat++;
        }
      };
      schedule();
      this.metroTimer = this.timing.every(schedule, 25);
    } catch (err) { this.stopMetronome(); throw err; }
  }
  stopMetronome() {
    if (!this.metroTask) return;
    this.metroTask.abort();
    this.metroTask = null;
    if (this.metroTimer != null) this.timing.clear(this.metroTimer);
    this.metroTimer = null;
    this.output.cancelClicks();
  }
}
