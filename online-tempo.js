import {artworkIdentity} from './artwork.js';

const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'')
  .toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const recco = 'https://api.reccobeats.com/v1/track/';

function ranked(rows, total, info) {
  const title = normalize(info.title), artist = normalize(info.artist);
  const matches = rows.filter(row => uuid.test(row.id) && normalize(row.title) === title);
  const byIsrc = info.isrc && matches.filter(row => row.isrc === info.isrc);
  if (byIsrc?.length) return byIsrc.map(row => ({...row, verified:true}));
  // A short first page cannot disambiguate a bare title shared by other artists.
  if (!artist && (total > rows.length || new Set(matches.map(row => normalize(row.artists.join(' ')))).size !== 1)) return [];
  return matches.map(row => {
    const names = row.artists.map(normalize);
    const distance = row.length && info.duration ? Math.abs(row.length / 1000 - info.duration) : Infinity;
    return {...row, names, distance, verified:distance <= 4 && (Boolean(artist) || Boolean(names[0]))};
  }).filter(row => (!artist || row.names.includes(artist) || row.names.join(' ') === artist) &&
    (row.distance <= 12 || (artist && row.distance === Infinity)))
    .sort((a,b) => a.distance - b.distance);
}

function tempo(value, source, url, verified) {
  const bpm = Number(value);
  return bpm >= 20 && bpm <= 300 ? {bpm:Math.round(bpm), beatPeriod:60/bpm, source, url, verified} : null;
}

async function reccoTempo(info, json) {
  const data = await json(recco + 'search?' + new URLSearchParams({searchText:info.title}));
  const rows = (data?.content || []).map(row => ({id:row.id, title:row.trackTitle, isrc:row.isrc,
    artists:(row.artists || []).map(a => a.name), length:row.durationMs}));
  for (const row of ranked(rows, data?.totalElements, info).slice(0,3)) {
    const url = recco + row.id + '/audio-features';
    const result = tempo((await json(url))?.tempo, 'ReccoBeats', url, row.verified);
    if (result) return result;
  }
  return null;
}

async function acousticTempo(info, json) {
  let rows;
  if (uuid.test(info.recording)) rows = [{id:info.recording, verified:true}];
  else {
    const quote = value => '"' + value.slice(0,200).replace(/["\\]/g,'\\$&') + '"';
    const terms = ['recording:' + quote(info.title)];
    if (info.artist) terms.push('artist:' + quote(info.artist));
    if (info.duration) {
      const ms = Math.round(info.duration * 1000);
      terms.push('dur:[' + Math.max(0, ms-12000) + ' TO ' + (ms+12000) + ']');
    }
    const params = new URLSearchParams({query:terms.join(' AND '), fmt:'json', limit:'25'});
    const data = await json('https://musicbrainz.org/ws/2/recording?' + params);
    const recordings = (data?.recordings || []).map(row => ({id:row.id, title:row.title, length:row.length,
      artists:(row['artist-credit'] || []).map(a => a.name || a.artist?.name || '')}));
    rows = ranked(recordings, data?.count, info);
  }
  if (!rows.length) return null;
  const query = new URLSearchParams({recording_ids:rows.map(row => row.id).join(';'), features:'rhythm.bpm'});
  const features = await json('https://acousticbrainz.org/api/v1/low-level?' + query);
  for (const row of rows) {
    for (const submission of Object.values(features?.[row.id] || {})) {
      const result = tempo(submission.rhythm?.bpm, 'AcousticBrainz', 'https://acousticbrainz.org/' + row.id, row.verified);
      if (result) return result;
    }
  }
  return null;
}

export async function findOnlineTempo(song, request = fetch) {
  const info = {...artworkIdentity(song), isrc:song.tagIsrc, recording:song.tagRecording};
  if (!info.title) return null;
  const providers = uuid.test(info.recording) ? [acousticTempo, reccoTempo] : [reccoTempo, acousticTempo];
  let failure;
  for (const lookup of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const result = await lookup(info, async url => {
        const response = await request(url, {signal:controller.signal, credentials:'omit'});
        if (response.status === 404 || response.status === 204) return null;
        if (!response.ok) throw Error('Catálogo de tempo no disponible.');
        return response.json();
      });
      if (result) return result;
    } catch (error) { failure = error; }
    finally { clearTimeout(timer); }
  }
  if (failure) throw failure;
  return null;
}
