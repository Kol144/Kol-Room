import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { analyzeSegments } from './analysis.js';
import { applyAnalysis, cleanProject } from './project-data.js';
import { artworkIdentity, coverCandidates, findArtwork } from './artwork.js';
import {findOnlineTempo} from './online-tempo.js';
import {announcement} from './song-speech.js';
import { DB_NAME, attachAudio, attachCover, clearOrphans, deleteProject, getAudio, getCover,
  getOriginal, listProjects, openDB, removeAudio, restoreCover, saveProject, storageInfo, updateProject } from './storage.js';

const legacy = {
  id: 'p', name: 'Banda', bpm: 118, oldSetting: 1, theme: { bg: '#191923', pad: '#222', custom: 'x' },
  repertoire: [{ id: 's', title: 'Intro', artist: 'Nosotros', bpm: 109, key: 'Am', lyrics: 'Letra antigua' },
    { id: 's2', title: 'Final', extra: 'campo futuro', restOverride: 0, manualReadyOverride: false }],
};
const analysis = { detectedBpm: 120, detectedKey: 'Do mayor', bpmConfidence: 0.8, keyConfidence: 0.7,
  bpmAlternatives: [60, 240], analysisStatus: 'Análisis completado' };
test('las portadas requieren coincidencia de título y artista y rechazan títulos ambiguos', async () => {
  const id='12345678-1234-1234-1234-123456789abc';
  const row=(artist)=>({title:'Canción', 'artist-credit':[{name:artist}],
    releases:[{id,status:'Official',title:'Álbum'}]});
  const data={count:2,recordings:[row('Banda'),row('Otra banda')]};
  assert.deepEqual(coverCandidates(data,{title:'Cancion',artist:'Banda'}),['release/'+id]);
  assert.deepEqual(coverCandidates(data,{title:'Cancion',artist:''}),[]);
  assert.deepEqual(coverCandidates(data,{title:'Otro título',artist:'Banda'}),[]);
  const song={title:'Banda - Canción',duration:100};
  assert.equal(artworkIdentity(song).artist,'Banda');
  const requests=[];
  const image=await findArtwork(song,async url=>{
    requests.push(url);
    return String(url).includes('musicbrainz.org') ? {ok:true,json:async()=>data} :
      {ok:true,blob:async()=>new Blob(['image'],{type:'image/jpeg'})};
  });
  assert.equal(image.type,'image/jpeg');
  assert.equal(requests.length,2);
});
function recording(i) {
  return { original: new Blob(['original' + i]), playable: new Blob(['wav' + i]), cover: new Blob(['cover' + i]),
    duration: 2, name: 'archivo' + i + '.aif', type: 'AIFF', analysis };
}

test('la normalización conserva identificadores, orden, contenido heredado, preferencias explícitas y campos futuros', () => {
  const project = cleanProject(legacy);
  assert.deepEqual(project.repertoire.map(s => s.id), ['s', 's2']);
  assert.equal(project.repertoire[0].lyrics, 'Letra antigua');
  assert.equal(project.repertoire[1].extra, 'campo futuro');
  assert.equal(project.theme.custom, 'x');
  assert.equal(project.theme.panel, '#222');
  assert.equal(project.repertoire[0].bpmSource, 'manual');
  assert.equal(project.repertoire[1].bpmSource, 'default');
  assert.equal(project.repertoire[1].restOverride, 0);
  assert.equal(project.repertoire[1].manualReadyOverride, false);
  assert.deepEqual(cleanProject(project), project);
});

test('un análisis posterior respeta BPM manual, tonalidad manual vacía y campos detectados independientes', () => {
  const song = { ...cleanProject(legacy).repertoire[0], key: '', keySource: 'manual' };
  const next = applyAnalysis(song, analysis, 118);
  assert.equal(next.detectedBpm, 120);
  assert.equal(next.detectedKey, 'Do mayor');
  assert.equal(next.bpm, 109);
  assert.equal(next.key, '');
  const automatic = applyAnalysis(cleanProject(legacy).repertoire[1], analysis);
  assert.equal(automatic.bpm, 120);
  assert.equal(automatic.key, 'Do mayor');
  assert.equal(automatic.bpmSource, 'detected');
});

test('una base v1 existente se actualiza conservando registros, identificadores, letras y tema', async () => {
  const factory = new IDBFactory();
  await new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' }).add(legacy);
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(open.error);
  });
  const db = await openDB(factory);
  assert.equal(db.version, 2);
  assert.deepEqual([...db.objectStoreNames], ['audioFiles', 'coverImages', 'projects']);
  const [p] = await listProjects(db);
  assert.equal(p.repertoire[0].lyrics, 'Letra antigua');
  assert.equal(p.repertoire[1].extra, 'campo futuro');
  assert.equal(p.repertoire[0].key, 'Am');
  assert.equal(p.theme.bg, legacy.theme.bg);
  assert.equal(p.oldSetting, 1);
  db.close();
});

test('tres importaciones atómicas persisten, las modificaciones simultáneas se combinan y la limpieza respeta otros proyectos', async () => {
  const factory = new IDBFactory();
  let db = await openDB(factory);
  await saveProject(db, { id: 'ensayo', name: 'Ensayo' });
  const songs = await Promise.all([1, 2, 3].map(i => attachAudio(db, 'ensayo', 's' + i, recording(i),
    { newSong: { title: 'Tema ' + i, artist: 'Banda', bpmSource: 'default' } })));
  await Promise.all([updateProject(db, 'ensayo', p => { p.repertoire[0].bpm = 92; p.repertoire[0].bpmSource = 'manual'; }),
    updateProject(db, 'ensayo', p => { p.repertoire[0].restOverride = 0; })]);
  db.close();
  db = await openDB(factory);
  const [project] = await listProjects(db);
  assert.deepEqual(project.repertoire.map(s => s.title), ['Tema 1', 'Tema 2', 'Tema 3']);
  assert.equal(project.repertoire[0].bpm, 92);
  assert.equal(project.repertoire[0].restOverride, 0);
  for (const [i, song] of songs.entries()) {
    assert.equal(await (await getAudio(db, song.audioId)).text(), 'wav' + (i + 1));
    assert.equal(await (await getOriginal(db, song.audioId)).text(), 'original' + (i + 1));
    assert.equal(await (await getCover(db, song.coverId)).text(), 'cover' + (i + 1));
  }
  await saveProject(db, { ...project, id: 'copia' });
  const art = await attachCover(db, 'ensayo', 's1', new Blob(['manual']));
  assert.notEqual(art.coverId, art.embeddedCoverId);
  const replacement = await attachAudio(db, 'ensayo', 's1', recording(4));
  assert.equal(replacement.bpm, 92);
  assert.equal(replacement.coverId, art.coverId);
  const restored = await restoreCover(db, 'ensayo', 's1');
  assert.equal(await (await getCover(db, restored.coverId)).text(), 'cover4');
  await removeAudio(db, 'ensayo', 's1');
  assert.equal((await storageInfo(db)).audioCount, 5);
  assert.equal(await clearOrphans(db), 3);
  assert.equal(await getAudio(db, replacement.audioId), null);
  assert.equal(await (await getAudio(db, songs[0].audioId)).text(), 'wav1');
  await deleteProject(db, 'copia');
  assert.equal(await clearOrphans(db), 2);
  assert.equal(await getAudio(db, songs[0].audioId), null);
  assert.equal((await storageInfo(db)).orphanCount, 0);
  db.close();
});

test('una importación con destino eliminado no deja blobs ni vuelve a crear la canción', async () => {
  const db = await openDB(new IDBFactory());
  await saveProject(db, legacy);
  await updateProject(db, 'p', p => { p.repertoire = []; });
  await assert.rejects(attachAudio(db, 'p', 's', recording(1)), /ya no está/);
  const info = await storageInfo(db);
  assert.equal(info.audioBytes, 0);
  assert.equal(info.orphanCount, 0);
  db.close();
});

const rate = 11025;
test('los BPM se redondean y los títulos ingleses usan fonética inglesa con correcciones individuales', async () => {
  assert.equal(cleanProject({repertoire:[{bpm:123.45}]}).repertoire[0].bpm,123);
  assert.equal(applyAnalysis({bpmSource:'default'},{detectedBpm:123.7}).bpm,124);
  const spoken=announcement({title:'kill ur vibe'},{voiceLang:'es-ES'});
  assert.equal(spoken.text,'kill your vibe');
  assert.equal(spoken.settings.voiceURI,'kolroom:piper-lessac-en');
  assert.equal(announcement({title:'Otro',pronunciation:'Mi nombre',speechLanguage:'es-ES'},{}).text,'Mi nombre');
  const result=await findOnlineTempo({title:'Tema',artist:'Banda',duration:180},async url=>({ok:true,json:async()=>
    String(url).includes('musicbrainz.org') ? {recordings:[{id:'12345678-1234-1234-1234-123456789abc',title:'Tema',length:180000,'artist-credit':[{name:'Banda'}]}]} : {rhythm:{bpm:123.7}}}));
  assert.equal(result.bpm,124);
});
test('el primer golpe real descarta silencio inicial y un transitorio aislado', () => {
  const first=2.173,bpm=120,period=60/bpm;
  const intro=Float32Array.from({length:rate*18},(_,i)=>{
    const time=i/rate;
    const attack=time<first ? time-.41 : (time-first)%period;
    return attack>=0 && attack<.06 ? Math.sin(2*Math.PI*145*attack)*Math.exp(-90*attack) : 0;
  });
  const result=analyzeSegments([intro],rate,[0],intro);
  assert.ok(Math.abs(result.detectedBpm-bpm)<.1,JSON.stringify(result));
  assert.ok(Math.abs(result.detectedBeatOffset-first)<.025,JSON.stringify(result));
});
test('el tempo fraccionario y el desfase se conservan entre pasajes distantes con subdivisiones', () => {
  const bpm = 123.45, period = 60/bpm, offset=.172;
  const starts = [4.3,54.1,105.7];
  const parts = starts.map(start=>Float32Array.from({length:rate*12}, (_,i)=>{
    const phase=(start+i/rate-offset)%period, t=phase%(period/2);
    return Math.sin(2*Math.PI*145*t)*Math.exp(-95*t)*(phase<period/2 ? 1 : .18);
  }));
  const result = analyzeSegments(parts,rate,starts);
  assert.ok(Math.abs(result.detectedBpm-bpm)<.06,JSON.stringify(result));
  assert.ok(Math.abs(result.detectedBeatOffset-offset)<.025,JSON.stringify(result));
  const song=applyAnalysis({bpmSource:'default'},result);
  assert.equal(song.beatOffset,result.detectedBeatOffset);
  assert.equal(applyAnalysis({...song,beatOffset:0,beatOffsetSource:'manual'},result).beatOffset,0);
});
function pulses(bpm) {
  const samples = new Float32Array(rate * 16);
  for (let t = 0; t < samples.length; t++) {
    const phase = (t / rate) % (60 / bpm);
    if (phase < 0.045) samples[t] = Math.exp(-phase * 90) * Math.sin(2 * Math.PI * 145 * phase);
  }
  return samples;
}
for (const bpm of [72, 96, 120, 144]) {
  test('la periodicidad de ataques reconoce pulsos sintéticos a ' + bpm + ' BPM y expone mitad/doble', () => {
    const result = analyzeSegments([pulses(bpm)], rate);
    assert.ok(Math.abs(result.detectedBpm - bpm) < 1, JSON.stringify(result));
    assert.equal(result.bpmAlternatives.length, 2);
    assert.ok(result.bpmConfidence >= 0.5);
  });
}

for (const [third, key] of [[4, 'Do mayor'], [3, 'Do menor']]) {
  test('el cromagrama reconoce una tríada de ' + key, () => {
    const samples = new Float32Array(rate * 5);
    for (let i = 0; i < samples.length; i++) {
      for (const [note, weight] of [[0, 1], [third, 0.68], [7, 0.79]]) samples[i] += weight * Math.sin(2 * Math.PI * i / rate * 261.6256 * 2 ** (note / 12)) / 3;
    }
    assert.equal(analyzeSegments([samples], rate).detectedKey, key);
  });
}

test('silencio y nota aislada no originan una tonalidad ficticia, el silencio tampoco genera un BPM', () => {
  const silence = new Float32Array(rate * 4);
  assert.equal(analyzeSegments([silence], rate).detectedBpm, null);
  assert.equal(analyzeSegments([silence], rate).detectedKey, '');
  const tone = silence.map((_, i) => Math.sin(2 * Math.PI * 440 * i / rate));
  assert.equal(analyzeSegments([tone], rate).detectedKey, '');
});
