// Optional integration test. Requires FFmpeg, Playwright and its Chromium.
// PLAYWRIGHT_PACKAGE may point to an existing Playwright installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'frumos-media-test-'));
let server, browser;
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
}

try {
  const wav = join(directory, 'pulso.wav'), image = join(directory, 'portada.jpg');
  ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*150*t)*exp(-90*mod(t,0.5))':s=22050:d=7", wav]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=cyan:s=90x120', '-frames:v', '1', image]);
  ffmpeg(['-i', wav, '-i', image, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy',
    '-id3v2_version', '3', '-metadata', 'title=Pulso de prueba', '-metadata', 'artist=Frumos',
    '-disposition:v', 'attached_pic', join(directory, 'pulso.mp3')]);
  for (const [extension, codec] of [['flac','flac'], ['ogg','libvorbis'], ['opus','libopus'], ['webm','libopus'], ['m4a','aac'], ['aac','aac'], ['aiff','pcm_s16be']]) {
    ffmpeg(['-i', wav, '-c:a', codec, join(directory, 'pulso.' + extension)]);
  }
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Isolate the library test from application bootstrapping and its service worker.
  await page.route('**/media-test.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Frumos media test</title>' }));
  await page.goto(base + '/media-test.html');
  await page.evaluate(async () => {
    const factory = indexedDB.open('pulso_sampler_v1', 1);
    await new Promise((resolve, reject) => {
      factory.onupgradeneeded = () => factory.result.createObjectStore('projects', {keyPath:'id'}).put({
        id:'legacy', name:'Grupo', repertoire:[{id:'song',title:'Antes',lyrics:'Texto heredado',key:'Am',bpm:118}],
      });
      factory.onerror = () => reject(factory.error);
      factory.onsuccess = () => {factory.result.close(); resolve();};
    });
  });
  const files = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'webm', 'm4a', 'aac', 'aiff'];
  for (const extension of files) {
    const data = (await readFile(join(directory, 'pulso.' + extension))).toString('base64');
    const info = await page.evaluate(async ({extension, data}) => {
      const storage = await import('/storage.js'), { prepareAudio } = await import('/media.js');
      const db = await storage.openDB();
      try {
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const file = new File([bytes], 'pulso.' + extension);
        const prepared = await prepareAudio(file, { confirmConversion: () => true });
        const song = await storage.attachAudio(db, 'legacy', extension, prepared, {newSong:{id:extension,title:extension}});
        const original = await storage.getOriginal(db,song.audioId);
        return { duration:song.duration,bpm:song.detectedBpm,cover:!!song.coverId,tagTitle:prepared.tagTitle,
          converted:song.converted,bytes:original.size };
      } finally { db.close(); }
    }, {extension, data});
    assert.ok(Math.abs(info.duration - 7) < 0.25, JSON.stringify(info));
    assert.ok(Math.abs(info.bpm - 120) < 2, JSON.stringify(info));
    assert.equal(info.bytes, Buffer.from(data,'base64').length);
    if (extension === 'mp3') { assert.ok(info.cover); assert.equal(info.tagTitle,'Pulso de prueba'); }
    console.log(extension, info);
  }
  await page.reload();
  const persisted = await page.evaluate(async () => {
    const storage = await import('/storage.js'), { prepareAudio } = await import('/media.js');
    const db = await storage.openDB(), [project] = await storage.listProjects(db);
    const before = await storage.storageInfo(db);
    let rejected = false;
    try { await prepareAudio(new File(['not music'], 'damage.mp3')); } catch { rejected = true; }
    const after = await storage.storageInfo(db);
    const song = project.repertoire.find(s => s.id === 'mp3');
    const blob = await storage.getCover(db,song.coverId), image = await createImageBitmap(blob);
    const answer = {count:after.audioCount,bytes:after.audioBytes,preserved:before.audioBytes === after.audioBytes,
      lyrics:project.repertoire[0].lyrics,key:project.repertoire[0].key,rejected,art:[image.width,image.height]};
    image.close(); db.close();
    return answer;
  });
  assert.equal(persisted.count, files.length);
  assert.ok(persisted.bytes && persisted.preserved && persisted.rejected);
  assert.equal(persisted.lyrics, 'Texto heredado'); assert.equal(persisted.key, 'Am');
  assert.deepEqual(persisted.art,[90,90]);
  console.log('Persistencia real y archivo corrupto verificados', persisted);
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
