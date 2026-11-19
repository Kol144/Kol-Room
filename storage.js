import { applyAnalysis, cleanProject, cleanSong } from './project-data.js';

export const DB_NAME = 'pulso_sampler_v1';
export const DB_VERSION = 2;
const stores = ['projects', 'audioFiles', 'coverImages'];
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

export function openDB(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Cierra las otras pestañas de Frumos y recarga para actualizar el almacenamiento.'));
    };
    request.onupgradeneeded = ({ oldVersion }) => {
      const db = request.result;
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (oldVersion === 1) {
        const cursor = request.transaction.objectStore('projects').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          row.update(cleanProject(row.value));
          row.continue();
        };
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
  });
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(db, names, operation) {
  const tx = db.transaction(names, 'readwrite');
  const finished = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('La operación se ha cancelado.'));
  });
  try {
    const [value] = await Promise.all([operation(tx), finished]);
    return value;
  } catch (error) {
    try { tx.abort(); } catch { /* Already rolled back or completed. */ }
    await finished.catch(() => {});
    if (error?.name === 'QuotaExceededError') throw new Error('No hay espacio suficiente. La operación no se guardó.');
    throw error;
  }
}

export async function listProjects(db) {
  const records = await resultOf(db.transaction('projects').objectStore('projects').getAll());
  return records.map(cleanProject);
}

export function saveProject(db, project) {
  const normalized = cleanProject(project);
  return write(db, 'projects', async tx => {
    await resultOf(tx.objectStore('projects').put(normalized));
    return normalized;
  });
}

async function changeProject(tx, id, mutate) {
  const store = tx.objectStore('projects');
  const value = await resultOf(store.get(id));
  if (!value) throw new Error('El proyecto ya no está disponible.');
  const project = cleanProject(value);
  mutate(project);
  const next = cleanProject(project);
  await resultOf(store.put(next));
  return next;
}

export function updateProject(db, id, mutate) {
  return write(db, 'projects', tx => changeProject(tx, id, mutate));
}

export function deleteProject(db, id) {
  return write(db, 'projects', tx => resultOf(tx.objectStore('projects').delete(id)));
}

async function fileRecord(db, name, id) {
  if (!id) return null;
  return await resultOf(db.transaction(name).objectStore(name).get(id)) || null;
}

export async function getAudio(db, id) {
  const record = await fileRecord(db, 'audioFiles', id);
  return record?.playable || record?.original || null;
}
export async function getOriginal(db, id) {
  return (await fileRecord(db, 'audioFiles', id))?.original || null;
}
export async function getCover(db, id) {
  return (await fileRecord(db, 'coverImages', id))?.blob || null;
}

// Keep original, playable derivative, art and the song pointer in one commit.
// Detached assets stay available to other projects until explicit cleanup.
function editSong(db, projectId, songId, assetStores, mutate, newSong) {
  return write(db, ['projects', ...assetStores], async tx => {
    const next = await changeProject(tx, projectId, project => {
      let song = project.repertoire.find(item => item.id === songId);
      if (newSong && song) throw new Error('Esta canción ya se ha importado.');
      if (newSong && !song) {
        song = cleanSong({ ...newSong, id: songId }, project.bpm);
        project.repertoire.push(song);
      }
      if (!song) throw new Error('La canción ya no está en el repertorio.');
      mutate(song, project, tx);
      song.updatedAt = Date.now();
    });
    return next.repertoire.find(item => item.id === songId);
  });
}

export function attachAudio(db, projectId, songId, prepared, { newSong } = {}) {
  return editSong(db, projectId, songId, ['audioFiles', 'coverImages'], (song, project, tx) => {
    const id = uid();
    const embeddedId = prepared.cover ? uid() : null;
    const relinking = !song.audioId && song.audioName === prepared.name && song.audioSize === prepared.original.size;
    tx.objectStore('audioFiles').add({ id, original: prepared.original, playable: prepared.playable || null });
    if (embeddedId) tx.objectStore('coverImages').add({ id: embeddedId, blob: prepared.cover });
    if (!song.coverId || song.coverId === song.embeddedCoverId || song.coverId === song.onlineCoverId) song.coverId = embeddedId;
    if (!relinking) { song.beatOffset = 0; song.beatOffsetSource = 'default'; }
    Object.assign(song, applyAnalysis(song, prepared.analysis, project.bpm), {
      audioId: id, embeddedCoverId: embeddedId, onlineCoverId: null, duration: prepared.duration,
      tagAlbum: prepared.tagAlbum || '', tagRelease: prepared.tagRelease || '',
      audioName: prepared.name, audioType: prepared.type, audioSize: prepared.original.size,
      converted: Boolean(prepared.playable), compatibility: 'Reproducible en este dispositivo',
      loopRegions: relinking ? song.loopRegions : [],
    });
  }, newSong);
}

export function attachCover(db, projectId, songId, blob) {
  return editSong(db, projectId, songId, ['coverImages'], (song, project, tx) => {
    song.coverId = uid();
    tx.objectStore('coverImages').add({ id: song.coverId, blob });
  });
}

export function attachOnlineCover(db, projectId, expected, blob) {
  return editSong(db, projectId, expected.id, ['coverImages'], (song, project, tx) => {
    if (song.coverId || song.audioId !== expected.audioId || song.title !== expected.title || song.artist !== expected.artist) return;
    song.onlineCoverId = song.coverId = uid();
    tx.objectStore('coverImages').add({id:song.coverId,blob});
  });
}

export function restoreCover(db, projectId, songId) {
  return editSong(db, projectId, songId, [], song => { song.coverId = song.embeddedCoverId || song.onlineCoverId || null; });
}

export function removeAudio(db, projectId, songId) {
  return editSong(db, projectId, songId, [], (song, project) => {
    if (song.coverId === song.embeddedCoverId || song.coverId === song.onlineCoverId) song.coverId = null;
    Object.assign(song, applyAnalysis(song, { analysisStatus: 'Pendiente' }, project.bpm), {
      audioId: null, audioName: '', audioSize: 0, audioType: '', duration: 0, converted: false,
      embeddedCoverId: null, onlineCoverId: null, tagRelease:'', tagAlbum:'', compatibility: '', loopRegions: [], beatOffset: 0, beatOffsetSource:'default',
    });
  });
}

async function inventory(tx) {
  const [projects, audioKeys, imageKeys] = await Promise.all([
    resultOf(tx.objectStore('projects').getAll()),
    resultOf(tx.objectStore('audioFiles').getAllKeys()),
    resultOf(tx.objectStore('coverImages').getAllKeys()),
  ]);
  const usedAudio = new Set(), usedImages = new Set();
  let audioCount = 0;
  const storedAudio = new Set(audioKeys);
  for (const project of projects) for (const song of project.repertoire || []) {
    if (storedAudio.has(song.audioId)) audioCount++;
    usedAudio.add(song.audioId);
    usedImages.add(song.coverId);
    usedImages.add(song.embeddedCoverId);
    usedImages.add(song.onlineCoverId);
  }
  return { audioCount, audio: audioKeys.filter(id => !usedAudio.has(id)), images: imageKeys.filter(id => !usedImages.has(id)) };
}

export function clearOrphans(db) {
  return write(db, stores, async tx => {
    const { audio, images } = await inventory(tx);
    for (const id of audio) tx.objectStore('audioFiles').delete(id);
    for (const id of images) tx.objectStore('coverImages').delete(id);
    return audio.length + images.length;
  });
}

export async function storageInfo(db) {
  const tx = db.transaction(stores);
  const storage = globalThis.navigator?.storage;
  const [usage, records, estimate, persistent] = await Promise.all([
    inventory(tx), resultOf(tx.objectStore('audioFiles').getAll()),
    storage?.estimate?.().catch(() => null), storage?.persisted?.().catch(() => null),
  ]);
  return { audioCount: usage.audioCount, orphanCount: usage.audio.length + usage.images.length,
    audioBytes: records.reduce((sum, audio) => sum + audio.original.size + (audio.playable?.size || 0), 0),
    available: estimate?.quota != null ? Math.max(0, estimate.quota - (estimate.usage || 0)) : null,
    persistent: persistent ?? null };
}
