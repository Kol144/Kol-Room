import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatGrid, defaults, effectiveBpm, restAfter, validLoop } from './audio-output.js';
import { PlaybackEngine } from './playback.js';

const drain = () => new Promise(resolve => setImmediate(resolve));
const song = (id, fields = {}) => ({id, title: id, audioId: id, bpm: 120, duration: 60, ...fields});
const event = (target, name) => target.dispatchEvent(new Event(name));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

function rig(settings = {}, getAudio = async id => id) {
  let time = 0;
  const timers = new Set();
  const timing = {
    now: () => time, wall: () => time, every: fn => { timers.add(fn); return fn; }, clear: fn => timers.delete(fn)
  };
  const media = [], clicks = [], speech = [], audible = new Set();
  const output = {
    get time() { return time / 1000; },
    async unlock() {}, async setOutputs() {}, configure() {},
    applyMedia(audio, speed) { audio.playbackRate = speed; },
    async load(id) {
      if (id == null) throw new Error('Falta el archivo');
      const audio = Object.assign(new EventTarget(), {
        id, currentTime: 0, duration: 60, ended: false, paused: true, seeking: false, readyState: 4,
        plays: 0, playbackRate: 1,
        async play() {
          this.ended = this.paused = false; this.plays++; audible.add(this);
          assert.equal(audible.size, 1, 'solo una fuente musical puede sonar');
          event(this, 'playing');
        },
        pause() { this.paused = true; audible.delete(this); },
        end() { this.currentTime = this.duration; this.ended = true; this.pause(); event(this, 'ended'); }
      });
      media.push(audio);
      return {audio, dispose() { audio.pause(); audio.disposed = true; }};
    },
    voices: {
      voices: () => [],
      speak(title, _, signal) { const call = {...deferred(), title, signal}; speech.push(call); return call.promise; }
    },
    click(at, beat) { clicks.push({at, beat, canceled:false}); },
    cancelClicks() { for (const click of clicks) if (click.at > time / 1000) click.canceled = true; }
  };
  const engine = new PlaybackEngine({getAudio, getSettings: () => ({announcementGap:0,metronomeEnabled:false,...settings}), output, timing});
  const tick = ms => {
    while (ms > 0) {
      const step = Math.min(ms, 25); ms -= step; time += step;
      for (const audio of audible) audio.currentTime += step / 1000 * audio.playbackRate;
      for (const fn of [...timers]) fn();
    }
  };
  return {engine, media, clicks, speech, audible, tick, output,
    sleep(ms) { time += ms; for (const fn of [...timers]) fn(); },
    get timerCount() { return timers.size; }};
}

test('tempo efectivo, herencia explícita en cero y cuadrícula con desfase', () => {
  assert.equal(effectiveBpm(song('x', {playbackSpeed: .8}), defaults), 96);
  assert.equal(effectiveBpm(song('x'), {...defaults, playbackSpeed: 1.1}), 132);
  assert.equal(restAfter(song('x'), defaults), 20);
  assert.equal(restAfter(song('x', {restOverride: 0}), defaults), 0);
  assert.equal(restAfter(song('x', {restOverride: 30}), {...defaults, restsEnabled:false}), 30);
  const grid = new BeatGrid(song('x', {beatOffset: .125}));
  assert.equal(grid.firstAfter(1.1), 2);
  assert.equal(grid.at(2), 1.125);
  assert.equal(grid.firstAfter(.125), 0);
  assert.ok(validLoop({a: 1,b: 2}, 4));
  assert.ok(!validLoop({a: 2,b: 1}, 4));
  assert.ok(!validLoop({a: 2,b: 5}, 4));
});

test('la pausa tras la voz espera el tiempo configurado y se puede congelar o detener',async()=>{
  for(const stop of [false,true]){
    const r=rig({announcementGap:defaults.announcementGap});
    await r.engine.start([song('A')]);r.speech[0].resolve();await drain();
    assert.equal(r.engine.state,'announcementGap');r.tick(1000);r.engine.pause();r.tick(7000);
    await r.engine.resume();r.tick(1975);assert.equal(r.clicks.length,0);
    if(stop)r.engine.stop();r.tick(25);assert.equal(r.clicks.length,stop?0:4);
  }
});

test('tres pistas en orden, anuncio real antes de cuatro clics y música en el quinto pulso', async () => {
  const r = rig({restSeconds: 0});
  const songs = [song('A'),song('sin audio',{audioId:null}),song('B'),song('C')];
  await r.engine.start(songs);
  songs.reverse();
  for (let i = 0; i < 3; i++) {
    await drain();
    assert.equal(r.engine.state, 'announcing');
    assert.equal(r.speech[i].title, ['A','B','C'][i]);
    assert.equal(r.media[i].plays, 0);
    const before = r.clicks.length;
    r.tick(2200);
    assert.equal(r.clicks.length, before);
    r.speech[i].resolve(); await drain();
    const group = r.clicks.slice(before);
    assert.deepEqual(group.map(x => x.beat), [0,1,2,3]);
    for (let j = 1; j < 4; j++) assert.ok(Math.abs(group[j].at - group[j-1].at - .5) < 1e-9);
    r.tick(2025);
    assert.equal(r.media[i].plays, 0);
    r.tick(50); await drain();
    assert.equal(r.engine.state, 'playing');
    assert.equal(r.media[i].plays, 1);
    r.media[i].end();
  }
  assert.equal(r.engine.state, 'finished');
  assert.equal(r.engine.snapshot().completed, 3);
  assert.equal(r.timerCount, 0);
  assert.equal(r.audible.size, 0);
  assert.ok(r.media.every(m => m.disposed));
});

test('descanso individual, pausa congelada, +10 y confirmación manual antes del anuncio', async () => {
  const r = rig({countIn: false, restSeconds: 20});
  await r.engine.start([song('A',{restOverride:30}), song('B',{manualReadyOverride:true}), song('C')]);
  r.speech[0].resolve(); await drain(); r.media[0].end();
  assert.equal(r.engine.remaining, 30);
  r.tick(7000); r.engine.pause(); r.tick(5000);
  assert.equal(r.engine.remaining, 23);
  r.engine.addRest(); assert.equal(r.engine.remaining, 33);
  await r.engine.resume(); r.tick(3000);
  assert.equal(r.engine.remaining, 30);
  r.engine.skipRest(); await drain();
  assert.equal(r.engine.state, 'preparing');
  r.tick(100000);
  assert.equal(r.speech.length, 1);
  assert.equal(r.media[1].plays, 0);
  r.engine.ready(); assert.equal(r.speech[1].title, 'B');
  r.speech[1].resolve(); await drain();
  r.media[1].end(); assert.equal(r.engine.remaining, 20);
  r.tick(20000); await drain();
  assert.equal(r.speech[2].title, 'C');
  r.engine.stop();
});

for (const phase of ['loading','announcing','countIn','playing','resting']) {
  test('Stop durante ' + phase + ' invalida eventos, audio, clics y transiciones tardías', async () => {
    const file = deferred();
    const r = rig({}, phase === 'loading' ? () => file.promise : async id => id);
    const start = r.engine.start([song('A'),song('B')]);
    await drain();
    if (phase !== 'loading') await start;
    if (['countIn','playing','resting'].includes(phase)) { r.speech[0].resolve(); await drain(); }
    if (['playing','resting'].includes(phase)) { r.tick(2100); await drain(); }
    if (phase === 'resting') r.media[0].end();
    assert.equal(r.engine.state, phase);
    const count = r.media.reduce((n,m) => n + m.plays, 0);
    r.engine.stop();
    file.resolve('A'); r.speech[0]?.resolve(); await drain();
    for (const m of r.media) m.end();
    r.tick(90000);
    assert.equal(r.engine.state, 'idle');
    assert.equal(r.media.reduce((n,m) => n + m.plays, 0), count);
    assert.equal(r.timerCount, 0);
    assert.ok(r.clicks.every(c => c.canceled || phase !== 'countIn'));
    assert.equal(r.audible.size, 0);
  });
}

test('pausar una cuenta y continuar empieza una cuenta completa a BPM efectivo', async () => {
  const r = rig({announcements:false});
  await r.engine.start([song('A',{playbackSpeed:.8})]);
  r.tick(700); r.engine.pause();
  assert.equal(r.engine.snapshot().pausedFrom, 'countIn');
  r.tick(5000); assert.equal(r.media[0].plays, 0);
  await r.engine.resume();
  const live = r.clicks.slice(-4);
  assert.ok(Math.abs(live[1].at - live[0].at - .625) < 1e-9);
  r.tick(2525); assert.equal(r.media[0].plays, 0);
  r.tick(50); assert.equal(r.media[0].plays, 1);
  r.engine.pause(); const pos = r.media[0].currentTime;
  r.tick(2000); assert.equal(r.media[0].currentTime, pos);
  await r.engine.resume();
  assert.equal(r.media[0].playbackRate, .8);
  r.engine.stop();
});

test('reintentar u omitir error conserva la cola y anterior/reiniciar liberan el medio anterior', async () => {
  const r = rig({announcements:false,countIn:false}, async id => id === 'B' ? null : id);
  await r.engine.start([song('A'),song('B'),song('C')]);
  r.engine.next(); await drain(); assert.equal(r.engine.state,'error');
  r.engine.retry(); await drain(); assert.equal(r.engine.song.id,'B');
  r.engine.next(); await drain(); assert.equal(r.engine.song.id,'C');
  r.engine.previous(); await drain(); assert.equal(r.engine.state,'error');
  r.engine.previous(); await drain(); assert.equal(r.engine.song.id,'A');
  const old = r.media.at(-1);
  r.engine.restart(); await drain(); old.end();
  assert.equal(r.engine.song.id,'A');
  assert.ok(old.disposed);
  r.engine.stop();
});

test('un evento de fin tardío y un anuncio fallido no saltan canciones', async () => {
  const r = rig({countIn:false});
  await r.engine.start([song('A'),song('B')]); r.engine.next(); await drain();
  r.speech[0].resolve(); r.media[0].end(); await drain();
  assert.equal(r.engine.song.id,'B');
  assert.equal(r.engine.state,'announcing');
  r.speech[1].reject(new Error('Voz no disponible')); await drain();
  assert.match(r.engine.message,/visual/);
  r.tick(1475); assert.equal(r.media[1].plays,0);
  r.tick(50); assert.equal(r.media[1].plays,1);
  r.engine.stop();
});

test('suspensión durante descanso congela la sesión sin avanzar hasta continuar', async () => {
  const r = rig({countIn:false,announcements:false});
  await r.engine.start([song('A'),song('B')]); r.media[0].end();
  r.tick(2500); r.sleep(60000);
  assert.equal(r.engine.state,'paused');
  assert.equal(r.engine.remaining,17.5);
  assert.equal(r.media.length,1);
  r.tick(10000); assert.equal(r.media.length,1);
  await r.engine.resume(); r.tick(20000); await drain(); assert.equal(r.engine.song.id,'B');
  r.engine.stop();
});

test('metrónomo sincronizado recalcula desde el tiempo musical después de seek y cambio de velocidad', async () => {
  const r = rig({announcements:false,countIn:false,metronomeEnabled:true});
  await r.engine.start([song('A',{beatOffset:.25})]); await drain();
  r.tick(160);
  assert.ok(Math.abs(r.clicks[0].at - .25) < .001);
  r.engine.seek(10.2);
  assert.ok(r.clicks[0].canceled);
  r.engine.updateSong({...r.engine.song, playbackSpeed:.8});
  r.tick(25);
  assert.equal(r.clicks.at(-1).beat,20);
  const last = r.clicks.at(-1).at;
  r.tick(200); assert.equal(r.clicks.at(-1).at,last);
  r.engine.pause(); r.engine.seek(20.22);
  await r.engine.resume(); assert.equal(r.clicks.at(-1).beat,40);
  r.engine.stop();
});

test('práctica A–B repite el fragmento seleccionado y finaliza sin tocar la cola', async () => {
  const r = rig({announcements:false,countIn:false});
  await r.engine.start([song('A'),song('B')], {mode:'practice', loop:{a:2,b:3,repeats:2}});
  assert.equal(r.engine.state,'practice');
  assert.equal(r.media[0].currentTime,2);
  r.tick(1025); assert.ok(r.media[0].currentTime < 2.1);
  r.tick(1050); assert.equal(r.engine.state,'finished');
  assert.equal(r.media.length,1);
  await r.engine.open(song('C'));
  assert.ok(!r.engine.setLoop({a:2,b:1}));
  assert.ok(r.engine.setLoop({a:2,b:3,repeats:0}));
  assert.ok(r.engine.setLoop(null));
  await r.engine.resume(); assert.equal(r.engine.state,'playing');
  r.engine.stop();
});

test('comparación de velocidad usa el mismo fragmento y recupera la posición original', async () => {
  const r = rig({announcements:false,countIn:false});
  const s = song('A');
  await r.engine.start([s], {mode:'single'}); r.engine.seek(12);
  await r.engine.preview(s,.8,12);
  assert.equal(r.engine.snapshot().previewStage,'original');
  const preview = r.media[1];
  assert.equal(preview.currentTime,12);
  r.tick(4500); await drain();
  assert.equal(r.engine.snapshot().previewStage,'changed');
  assert.ok(Math.abs(preview.currentTime-12) < .1);
  assert.equal(preview.playbackRate,.8);
  r.tick(5800); await drain();
  assert.equal(r.engine.state,'playing');
  assert.equal(r.media[0].currentTime,12);
  assert.ok(preview.disposed);
  await r.engine.start([s], {mode:'set'});
  await assert.rejects(() => r.engine.preview(s,.8), /repertorio/);
  r.engine.stop();
});

test('metrónomo independiente planifica por adelantado y cancela los clics pendientes', async () => {
  const r = rig();
  await r.engine.startMetronome(60);
  r.tick(950);
  assert.deepEqual(r.clicks.map(c=>c.beat),[0,1]);
  assert.ok(Math.abs(r.clicks[1].at-r.clicks[0].at-1)<.001);
  r.engine.stopMetronome();
  assert.ok(r.clicks[1].canceled);
  r.tick(5000);
  assert.equal(r.clicks.length,2);
});

test('la cuenta da cuatro clics y el clic musical espera al sonido real',async()=>{
  const r=rig({announcements:false,countIn:true,metronomeEnabled:true});
  await r.engine.start([song('silencio',{beatOffsetSource:'detected',beatOffset:7.12,detectedBeatOffset:7.12,detectedBpm:120})]);
  r.engine.track.soundAge=()=>null;
  r.tick(2100);await drain();
  assert.equal(r.engine.state,'playing');
  assert.equal(r.clicks.length,4);
  r.tick(1000);assert.equal(r.clicks.length,4);
  const audible=r.output.time+.025;
  r.engine.track.soundAge=()=>.003;
  r.tick(25);assert.equal(r.clicks.length,5);
  assert.ok(Math.abs(r.clicks[4].at-audible)<.002);
  r.tick(600);assert.equal(r.clicks.length,6);
  r.engine.stop();
});

test('el primer clic coincide con la nota inicial y la cuadrícula sigue en fase al pausar y buscar',async()=>{
  const r=rig({announcements:false,countIn:false,metronomeEnabled:true});
  const onset=2.371, firstDrum=6.486;
  await r.engine.start([song('intro',{soundOnset:onset,beatOffset:firstDrum,beatOffsetSource:'detected',detectedBpm:120})]);
  await drain();
  r.tick(2150); assert.equal(r.clicks.length,0);
  r.tick(1300);
  assert.ok(Math.abs(r.clicks[0].at-onset)<.001);
  assert.ok(Math.abs(r.clicks[1].at-(firstDrum-7*.5))<.001);
  const media=r.media[0];
  r.engine.pause(); const before=r.clicks.length;
  r.tick(300);await r.engine.resume();r.tick(500);
  assert.ok(r.clicks.slice(before).every(c=>Math.abs((c.at-.3-firstDrum)/.5-Math.round((c.at-.3-firstDrum)/.5))<.001));
  r.engine.seek(.4);
  const atSeek=r.output.time;
  r.tick(1750);
  assert.ok(media.currentTime<onset);
  const afterSeek=r.clicks.length;
  r.tick(400);
  assert.ok(Math.abs(r.clicks[afterSeek].at-(atSeek+onset-.4))<.001);
  r.engine.stop();
});

test('el silencio completo nunca activa el metrónomo musical',async()=>{
  const r=rig({announcements:false,countIn:false,metronomeEnabled:true});
  await r.engine.open(song('vacío',{beatOffset:0,beatOffsetSource:'detected'}));
  r.engine.track.soundAge=()=>null;
  await r.engine.resume();
  r.tick(8000);
  assert.equal(r.clicks.length,0);
  r.engine.stop();
});
