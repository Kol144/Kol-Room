import {artworkIdentity} from './artwork.js';
const norm=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export async function findOnlineTempo(song, request=fetch) {
  const {title,artist,duration}=artworkIdentity(song);
  if (!title || !artist) return null;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  const options={signal:controller.signal};
  try {
    const quote=s=>'"'+s.slice(0,200).replace(/["\\]/g,'\\$&')+'"';
    const query=new URLSearchParams({query:'recording:'+quote(title)+' AND artist:'+quote(artist),fmt:'json',limit:'12'});
    const response=await request('https://musicbrainz.org/ws/2/recording?'+query,options);
    if (!response.ok) return null;
    const matches=((await response.json()).recordings || []).filter(r=>norm(r.title)===norm(title) &&
      (r['artist-credit'] || []).some(a=>norm(a.name || a.artist?.name)===norm(artist)) &&
      (!r.length || !duration || Math.abs(r.length/1000-duration)<12));
    for (const row of matches.slice(0,3)) {
      if (!/^[\da-f-]{36}$/i.test(row.id)) continue;
      const data=await request('https://acousticbrainz.org/'+row.id+'/low-level',options);
      if (!data.ok) continue;
      const bpm=Number((await data.json()).rhythm?.bpm);
      if (bpm>=20 && bpm<=300) return {bpm:Math.round(bpm),url:'https://acousticbrainz.org/'+row.id};
    }
    return null;
  } finally {clearTimeout(timer);}
}
