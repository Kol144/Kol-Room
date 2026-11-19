const norm = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function artworkIdentity(song) {
  const parts = !song.artist && song.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return { title: parts ? parts[2] : song.title, artist: parts ? parts[1] : song.artist,
    album: song.tagAlbum || '', release: song.tagRelease || '', duration: song.duration };
}

export function coverCandidates(data, {title,artist,album,duration}) {
  const matches = (data.recordings || []).filter(row => norm(row.title) === norm(title));
  const credits = row => (row['artist-credit'] || []).map(c => c.name || c.artist?.name || '');
  if (!artist && (!matches.length || data.count > data.recordings.length ||
      new Set(matches.map(row => norm(credits(row).join(' ')))).size !== 1)) return [];
  const ranked = [];
  for (const row of matches) {
    const names = credits(row).map(norm);
    if (artist && ![...names,names.join(' ')].includes(norm(artist))) continue;
    for (const release of row.releases || []) {
      const group = release['release-group'] || {};
      if (album && norm(release.title) !== norm(album)) continue;
      if (release.status && release.status !== 'Official') continue;
      const distance = row.length && duration ? Math.abs(row.length / 1000 - duration) : 20;
      const priority = (group['secondary-types']?.length ? 100 : 0) +
        Math.min(60,distance) + (group['primary-type'] === 'Album' ? 0 : 6);
      for (const [kind,id] of [['release-group',group.id],['release',release.id]]) {
        if (uuid.test(id)) ranked.push({ path: kind + '/' + id, priority });
      }
    }
  }
  return [...new Set(ranked.sort((a,b)=>a.priority-b.priority).map(r=>r.path))];
}

export async function findArtwork(song, request = fetch) {
  const info = artworkIdentity(song);
  const paths = uuid.test(info.release) ? ['release/' + info.release] : [];
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),18000);
  async function download(path) {
    const response = await request('https://coverartarchive.org/' + path + '/front-250', {signal:controller.signal});
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size && blob.type.startsWith('image/') ? blob : null;
  }
  try {
    if (paths.length) {
      const image = await download(paths[0]);
      if (image) return image;
    }
    const quote = value => '"' + value.slice(0,200).replace(/["\\]/g,'\\$&') + '"';
    const terms = ['recording:' + quote(info.title)];
    if (info.artist) terms.push('artist:' + quote(info.artist));
    if (info.album) terms.push('release:' + quote(info.album));
    const params = new URLSearchParams({query:terms.join(' AND '),fmt:'json',limit:'12'});
    const result = await request('https://musicbrainz.org/ws/2/recording?' + params,{signal:controller.signal});
    if (!result.ok) return null;
    for (const path of coverCandidates(await result.json(), info).slice(0,4)) {
      if (paths.includes(path)) continue;
      const image = await download(path);
      if (image) return image;
    }
    return null;
  } finally { clearTimeout(timer); }
}
