const byId = id => document.getElementById(id);
const notes = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
function parseKey(key) {
  const match = /^(do|re|mi|fa|sol|la|si|[a-g])\s*([#♯b♭]?)(.*)$/i.exec((key||'').trim());
  if(!match)return {note:'',mode:'mayor'};
  const roots={do:0,c:0,re:2,d:2,mi:4,e:4,fa:5,f:5,sol:7,g:7,la:9,a:9,si:11,b:11};
  const delta=({'#':1,'♯':1,b:-1,'♭':-1})[match[2]] || 0;
  const note=notes[(roots[match[1].toLowerCase()]+delta+12)%12];
  return {note,mode:/^(m|min|minor|menor)$/i.test(match[3].trim()) ? 'menor' : 'mayor'};
}
export function durationText(value) {
  const seconds = Math.floor(Number(value) || 0);
  return Math.floor(seconds/60) + ':' + String(seconds%60).padStart(2,'0');
}
export function fileSize(bytes) {
  return bytes >= 1048576 ? (bytes/1048576).toFixed(1)+' MB' : Math.ceil(bytes/1024)+' KB';
}
export function mountEditor({selected,patch,move,remove,close,importAudio,removeAudio,exportAudio,chooseCover,restoreCover,showCover,reanalyze,setMetroTempo}) {
  const el = byId;
  const options = el('songRoot');
  options.add(new Option('Sin definir',''));
  for (const note of notes) options.add(new Option(note,note));
  const update = changes => {const song=selected(); if(song) patch(song.id,changes);};
  const buttons = {closeEditor:close,moveUp:()=>move(-1),moveDown:()=>move(1),removeSongBtn:remove,replaceAudio:importAudio,removeAudio,exportAudio:()=>exportAudio(false),exportConverted:()=>exportAudio(true),chooseCover,restoreCover,reanalyze};
  for (const [id,callback] of Object.entries(buttons)) el(id).onclick=callback;
  el('useSongTempo').onclick=setMetroTempo;
  el('songTitleInput').onchange = event => {const title=event.target.value.trim(); if(title) update({title}); else event.target.value=selected().title;};
  el('songArtistInput').onchange = event => update({artist:event.target.value.trim()});
  el('songBpm').onchange = event => {
    const input=event.target;
    if (!input.value || !input.checkValidity()) {input.reportValidity();input.value=selected().bpm;return;}
    update({bpm:Number(input.value),bpmSource:'manual'});
  };
  const saveKey = () => {const root=options.value; update({key:root ? root+' '+el('songMode').value : '',keySource:'manual'});};
  options.onchange=saveKey; el('songMode').onchange=saveKey;
  el('acceptBpm').onclick=()=>{const s=selected(); if(s.detectedBpm) update({bpm:s.detectedBpm,bpmSource:'detected',
    ...(s.beatOffsetSource!=='manual' && s.detectedBeatOffset!=null ? {beatOffset:s.detectedBeatOffset,beatOffsetSource:'detected'} : {})});};
  el('acceptKey').onclick=()=>{const s=selected(); if(s.detectedKey) update({key:s.detectedKey,keySource:'detected'});};
  el('restKind').onchange=event=>{
    const kind=event.target.value;
    el('restSecondsLabel').hidden=kind!=='custom';
    update({restOverride:kind==='inherit' ? null : kind==='none' ? 0 : Math.max(1,Number(el('restOverride').value)||20)});
  };
  el('restOverride').onchange=event=>{
    if (event.target.checkValidity() && event.target.value!=='') update({restOverride:Number(event.target.value)});
    else event.target.reportValidity();
  };
  for (const [id,key] of [['readyMode','manualReadyOverride'],['songClick','metronomeEnabledOverride']]) {
    el(id).onchange=event=>update({[key]:event.target.value==='inherit' ? null : event.target.value==='true'});
  }
  let renderedId;
  return (song,index,total,busy)=>{
    el('songEditor').hidden=!song;
    if(!song){renderedId=null;return;}
    const same=renderedId===song.id;
    const set=(id,value)=>{if(!same || document.activeElement!==el(id))el(id).value=value;};
    renderedId=song.id;
    el('editorHeading').textContent='Editar · '+song.title;
    set('songTitleInput',song.title);set('songArtistInput',song.artist);set('songBpm',song.bpm);
    const key=parseKey(song.key);
    set('songRoot',key.note);set('songMode',key.mode);el('songMode').disabled=!key.note;
    set('restKind',song.restOverride==null?'inherit':song.restOverride===0?'none':'custom');
    el('restSecondsLabel').hidden=el('restKind').value!=='custom';
    set('restOverride',song.restOverride??20);set('readyMode',String(song.manualReadyOverride??'inherit'));set('songClick',String(song.metronomeEnabledOverride??'inherit'));
    const audio=Boolean(song.audioId);
    el('audioFacts').textContent=audio ? [song.audioName,durationText(song.duration),fileSize(song.audioSize || 0),song.audioType || 'Formato identificado por el navegador',song.converted?'Reproducible mediante conversión local':'Reproducible'].join(' · ') : 'Sin archivo de audio';
    const analysis=[song.analysisStatus || 'Pendiente de análisis'];
    if (audio) {
      if(song.detectedBpm){analysis.push('Tempo estimado '+song.detectedBpm+' BPM');if(song.bpmConfidence) analysis.push('confianza rítmica '+Math.round(song.bpmConfidence*100)+' %');}
      if(song.beatOffsetSource==='detected') analysis.push('Clic alineado con los golpes');
      if(song.bpmAlternatives?.length) analysis.push('Tempos alternativos '+song.bpmAlternatives.join(' / '));
      analysis.push(song.detectedKey || 'Tonalidad no determinada');
      if(song.keyConfidence && song.detectedKey) analysis.push('confianza tonal '+Math.round(song.keyConfidence*100)+' %');
    }
    if(song.bpmSource==='manual') analysis.push('BPM manual');
    if(song.keySource==='manual') analysis.push('Tonalidad manual');
    el('analysisFacts').textContent=analysis.join(' · ');
    for(const id of ['exportAudio','removeAudio','reanalyze'])el(id).hidden=!audio;
    el('exportConverted').hidden=!audio || !song.converted;
    el('replaceAudio').textContent=audio?'Reemplazar audio':'Importar audio';
    el('acceptBpm').hidden=!song.detectedBpm;el('acceptKey').hidden=!song.detectedKey;
    el('restoreCover').disabled=song.coverId===(song.embeddedCoverId || song.onlineCoverId || null);
    el('moveUp').disabled=index===0;el('moveDown').disabled=index+1>=total;
    for(const id of ['replaceAudio','reanalyze','chooseCover','removeAudio','restoreCover']) el(id).disabled=busy || (id==='restoreCover' && el(id).disabled);
    showCover(el('editorCover'),song.coverId);
  };
}
