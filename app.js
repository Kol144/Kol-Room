import { cleanProject, cleanSong, applyAnalysis, applyOnlineTempo, clearOnlineTempo } from './project-data.js';
import * as library from './storage.js';
import { PlaybackEngine } from './playback.js';
import { mountPlayer } from './player-ui.js';
import { mountSettings, UI_DEFAULTS, applyPalette } from './settings-ui.js';
import { mountEditor, durationText } from './song-editor.js';

const $ = id => document.getElementById(id);
const makeId = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const settingsKey = 'frumos.drummer.settings.v1';
const currentKey = 'frumos.drummer.project';
const defaultCover = './icons/drum-cover.webp';
let db, engine, player, settingsPanel, renderEditor;
let projects = [], currentId = '', selectedSongId = '', activeView = 'repertoire';
let editorOpen = false, standalone = false, tapTimes = [], metroRun = 0;
let importJob, fileTarget, coverTarget, toastTimer;
let settings = {...UI_DEFAULTS};
let pending = Promise.resolve();
const coverURLs = new Map();
const current = () => projects.find(project => project.id === currentId);
const selected = () => current()?.repertoire.find(song => song.id === selectedSongId);
const attemptedArt = new Set();
const tempoStates = new Map();
const tempoKey = (projectId,song) => JSON.stringify([projectId,song.id,song.audioId,song.title,song.artist]);
let tempoRequests = 0, nextTempoTimer;
async function lookupTempo(project, song, manual = false) {
  const key = tempoKey(project.id,song);
  if (navigator.onLine === false || tempoStates.get(key) === 'searching') return;
  tempoStates.set(key,'searching');
  tempoRequests++;
  refreshEditor();
  try {
    const {findOnlineTempo} = await import('./online-tempo.js');
    const result = await findOnlineTempo(song);
    if (!manual && !settings.onlineTempo) { tempoStates.delete(key); return; }
    if (!result) { tempoStates.set(key,'missing'); return; }
    const saved = await editProject(project.id, p => {
      const item = p.repertoire.find(s => s.id === song.id);
      if (item && tempoKey(p.id,item) === key) applyOnlineTempo(item,result);
    });
    const updated = saved.repertoire.find(s => s.id === song.id);
    if (currentId === saved.id && updated && tempoKey(saved.id,updated) === key) engine.updateSong(updated);
    tempoStates.set(key,'found');
  } catch { tempoStates.set(key,'error'); }
  finally {
    tempoRequests--;
    refreshEditor();
    clearTimeout(nextTempoTimer);
    nextTempoTimer = setTimeout(() => { nextTempoTimer = null; scheduleTempo(); },1100);
  }
}
function scheduleTempo() {
  const project = current();
  if (!project || tempoRequests || nextTempoTimer || !settings.onlineTempo || navigator.onLine === false) return;
  const pendingSong = s => s?.audioId && !s.onlineBpmSource && !tempoStates.has(tempoKey(project.id,s));
  const song = pendingSong(selected()) ? selected() : project.repertoire.find(pendingSong);
  if (song) lookupTempo(project,song);
}
let artBusy = false;
function scheduleArtwork() {
  if (artBusy || !settings.onlineArtwork || navigator.onLine === false) return;
  const project = current();
  const key = song => JSON.stringify([project.id,song.id,song.audioId,song.title,song.artist]);
  const song = project?.repertoire.find(s=>s.audioId && !s.coverId && !attemptedArt.has(key(s)));
  if (!song) return;
  attemptedArt.add(key(song));
  const expected = {...song};
  artBusy = true;
  (async()=>{
    const {findArtwork} = await import('./artwork.js');
    const image = await findArtwork(expected);
    if (!image || !settings.onlineArtwork) return;
    const {prepareCover} = await import('./media.js');
    const cover = await prepareCover(image);
    if (settings.onlineArtwork) await applyAsset(project.id,song.id,()=>library.attachOnlineCover(db,project.id,expected,cover));
  })().catch(()=>{}).finally(()=>setTimeout(()=>{artBusy=false; scheduleArtwork();},1100));
}
window.addEventListener('online',()=>{
  attemptedArt.clear();
  for (const [key,state] of tempoStates) if (state === 'error' || state === 'missing') tempoStates.delete(key);
  refreshEditor();scheduleArtwork();scheduleTempo();
});
window.addEventListener('offline',refreshEditor);
const readPreference = key => {try{return localStorage.getItem(key);}catch{return null;}};

function queueWrite(action) {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3800);
}
function report(error) {
  if (error?.name==='AbortError') return;
  $('appError').hidden=false;
  $('appError').textContent = error?.name==='QuotaExceededError'
    ? 'Espacio insuficiente. Libera espacio en Ajustes o elige un archivo más pequeño.'
    : (error?.message || 'No se pudo completar la operación.');
}
function guard(action) {
  return (...args) => {try{Promise.resolve(action(...args)).catch(report);}catch(error){report(error);}};
}
function replaceRecord(record) {
  const index=projects.findIndex(project=>project.id===record.id);
  if(index>=0) projects[index]=record;
  else projects.push(record);
}
function editProject(id,mutate) {
  return queueWrite(async()=>{
    const project=await library.updateProject(db,id,mutate);
    replaceRecord(project);
    if(currentId===id) refreshLibrary();
    return project;
  });
}
async function saveSong(songId,patch) {
  const id=currentId;
  const project=await editProject(id,project=>{
    const song=project.repertoire.find(item=>item.id===songId);
    if(!song) throw Error('La canción ya no está en este proyecto.');
    if (['title','artist'].some(key => key in patch && patch[key] !== song[key])) {
      clearOnlineTempo(song,project.bpm);
      song.tagRecording = song.tagIsrc = '';
    }
    if ('beatOffset' in patch && !patch.beatOffsetSource) song.beatOffsetSource='manual';
    if ('bpm' in patch) patch.bpm=Math.round(patch.bpm);
    Object.assign(song,patch,{updatedAt:Date.now()});
  });
  const updated=project.repertoire.find(song=>song.id===songId);
  if(id===currentId) engine.updateSong(updated);
  if(updated.audioId && ['title','speechLanguage','pronunciation'].some(key=>key in patch)) engine.prepareAnnouncement(updated).catch(()=>{});
  return updated;
}
function releaseUnusedCovers() {
  const active = new Set(current()?.repertoire.map(song=>song.coverId));
  for(const [id,entry] of coverURLs) if(!active.has(id)){
    if(entry.url)URL.revokeObjectURL(entry.url);
    coverURLs.delete(id);
  }
}
function showCover(img,id) {
  if(img.dataset.cover===(id||'') && img.hasAttribute('src')) return;
  img.dataset.cover=id||'';
  img.src=defaultCover;
  if(!id)return;
  if(!coverURLs.has(id)){
    const entry={url:null};
    coverURLs.set(id,entry);
    entry.ready=library.getCover(db,id).then(blob=>{
      if(blob && coverURLs.get(id)===entry) entry.url=URL.createObjectURL(blob);
      return entry.url;
    }).catch(()=>null);
  }
  coverURLs.get(id).ready.then(url=>{if(url && img.isConnected && img.dataset.cover===id)img.src=url;});
}
function applyTheme(project) {
  for(const [name,value] of Object.entries(project.theme || {})) {
    if(['bg','panel','border'].includes(name))document.documentElement.style.setProperty('--user-'+name,value);
  }
}
function saveSettings(patch) {
  const value={...settings,...patch};
  localStorage.setItem(settingsKey,JSON.stringify(value));
  settings=value;
  if (patch.onlineArtwork) {attemptedArt.clear(); scheduleArtwork();}
  if (patch.onlineTempo) scheduleTempo();
  applyPalette(value.palette);
  return settings;
}
function showModal(title,value,callback) {
  const modal=$('modal'), form=modal.querySelector('form');
  $('modalTitle').textContent=title;
  $('modalInput').value=value;
  $('modalCancel').onclick=()=>modal.close();
  form.onsubmit=guard(async event=>{
    event.preventDefault();
    const name=$('modalInput').value.trim();
    if(!name)return $('modalInput').focus();
    modal.close();
    await callback(name);
  });
  modal.showModal(); $('modalInput').select();
}
function renderProjects() {
  const selector=$('projectSelect'),list=$('projectList');
  selector.replaceChildren(); list.replaceChildren();
  for(const project of projects){
    selector.add(new Option(project.name,project.id));
    const button=document.createElement('button');
    button.type='button';button.className='project-item'+(currentId===project.id?' active':'');
    button.textContent=project.name;button.setAttribute('aria-pressed',String(currentId===project.id));
    button.onclick=()=>selectProject(project.id);
    list.append(button);
  }
  selector.value=currentId;
}
function selectProject(id) {
  const project=projects.find(item=>item.id===id);
  if(!project)return;
  if(currentId!==id){
    importJob?.controller.abort();
    stopMetronome(); player.close(); engine.stop();
    $('playerPanel').hidden=true; $('libraryPanel').hidden=false;
    selectedSongId='';editorOpen=false;tapTimes=[];
    $('newSongForm').hidden=true;$('songFinder').value='';
  }
  currentId=id;
  try{localStorage.setItem(currentKey,id);}catch{}
  applyTheme(project);
  $('bgColor').value=project.theme.bg;
  $('bpm').value=project.bpm;
  $('metroTempoLabel').textContent=project.bpm+' BPM';
  renderProjects();refreshLibrary();
}
function activeSession() {
  return !['idle','finished'].includes(engine.snapshot().state);
}
function openSong(song) {
  if(!song.audioId)return;
  selectedSongId=song.id;
  return player.openSong(current().repertoire,song.id);
}
function moveSong(songId,step) {
  return editProject(currentId,project=>{
    const list=project.repertoire, from=list.findIndex(song=>song.id===songId), to=from+step;
    if(from>=0 && to>=0 && to<list.length) [list[from],list[to]]=[list[to],list[from]];
  });
}
function openEditor(songId) {
  selectedSongId=songId; editorOpen=true;
  refreshLibrary();
  $('editorHeading').focus({preventScroll:true});
  $('songEditor').scrollIntoView({block:'nearest'});
}
function rowButton(text,label,action,disabled=false) {
  const button=document.createElement('button');
  button.className='smallbtn';button.type='button';button.textContent=text;button.title=label;
  button.setAttribute('aria-label',label);button.disabled=disabled;button.onclick=guard(action);return button;
}
function renderRows(project) {
  const query=$('songFinder').value.trim().toLocaleLowerCase();
  const list=$('songList'), fragment=document.createDocumentFragment();
  project.repertoire.forEach((song,index)=>{
    if(!(song.title+' '+song.artist).toLocaleLowerCase().includes(query))return;
    const row=document.createElement('div');
    row.className='song-row'+(song.id===selectedSongId?' active':'');row.dataset.songId=song.id;
    const num=document.createElement('span');num.className='track-no';num.textContent=String(index+1).padStart(2,'0');
    const img=document.createElement('img');img.alt='';img.className='track-cover';showCover(img,song.coverId);
    const title=document.createElement('button');title.type='button';title.className='track-title';title.onclick=()=>openEditor(song.id);title.title='Editar canción';
    const strong=document.createElement('strong'), artist=document.createElement('small');strong.textContent=song.title;artist.textContent=song.artist||'Artista sin definir';title.append(strong,artist);
    const data=document.createElement('span');data.className='song-data';data.textContent=[song.bpm+' BPM',song.key||'Sin tonalidad',song.audioId?durationText(song.duration)+' · Audio':'Sin audio'].join(' · ');
    const controls=document.createElement('div');controls.className='row-buttons';
    const up=rowButton('↑','Subir '+song.title,()=>moveSong(song.id,-1),index===0);
    const down=rowButton('↓','Bajar '+song.title,()=>moveSong(song.id,1),index===project.repertoire.length-1);
    up.classList.add('row-controls');down.classList.add('row-controls');
    const play=rowButton('▶','Reproducir '+song.title,()=>openSong(song),!song.audioId);play.classList.add('row-play');
    controls.append(up,down,rowButton('Editar','Editar '+song.title,()=>openEditor(song.id)),play);
    row.append(num,img,title,data,controls);fragment.append(row);
  });
  if(!fragment.childNodes.length){
    const empty=document.createElement('div');empty.className='song-empty';
    const strong=document.createElement('strong'),p=document.createElement('p');
    strong.textContent=query?'Sin coincidencias':'El repertorio está vacío';
    p.textContent=query?'Prueba con otro título o artista.':'Importa un audio o añade una canción para preparar el ensayo.';
    empty.append(strong,p);fragment.append(empty);
  }
  list.replaceChildren(fragment);
}
function refreshEditor() {
  const project = current();
  if (!project || !renderEditor) return;
  const song = editorOpen ? selected() : null;
  const status = navigator.onLine === false ? 'offline' : song && tempoStates.get(tempoKey(project.id,song));
  renderEditor(song,project.repertoire.indexOf(song),project.repertoire.length,Boolean(importJob),status);
}
function refreshLibrary() {
  const project=current();if(!project)return;
  releaseUnusedCovers();
  const songs=project.repertoire, available=songs.filter(song=>song.audioId);
  $('projectCaption').textContent=project.name;
  $('libraryStats').textContent=songs.length+' '+(songs.length===1?'canción':'canciones')+' · '+available.length+' con audio · '+durationText(available.reduce((sum,song)=>sum+song.duration,0));
  $('playSet').disabled=!available.length || !!importJob;
  $('importTracks').disabled=!!importJob;
  renderRows(project);
  refreshEditor();
  scheduleArtwork();
  scheduleTempo();
}
function switchView(view) {
  const changing = view !== activeView;
  if(changing && activeView==='metronome')stopMetronome();
  activeView=view;
  for(const tab of document.querySelectorAll('.nav-tab')){
    const on=tab.dataset.view===view;
    tab.classList.toggle('active',on);tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
  }
  for(const section of document.querySelectorAll('.view'))section.hidden=section.id!==view+'View';
  if(changing)window.scrollTo(0,0);
  if(view==='settings')settingsPanel.refresh();
  if(view==='repertoire')player.refresh();
}
function stopMetronome() {
  ++metroRun;standalone=false;engine?.stopMetronome();
  $('metroBtn').textContent='▶ Iniciar metrónomo';$('metroBtn').setAttribute('aria-pressed','false');
  for(const light of $('metroBeats').children)light.classList.remove('hit');
}
async function startMetronome(){
  if(activeSession())return toast('Detén la reproducción para usar el metrónomo independiente.');
  const run=++metroRun;
  standalone=true;
  try{
    await engine.startMetronome(Number($('bpm').value),beat=>{
      if(run===metroRun)Array.from($('metroBeats').children).forEach((el,i)=>el.classList.toggle('hit',i===beat-1));
    });
    if(run!==metroRun)return;
    $('metroBtn').textContent='■ Detener metrónomo';$('metroBtn').setAttribute('aria-pressed','true');
  }catch(error){if(run===metroRun)stopMetronome();throw error;}
}
async function saveTempo(){
  const bpm=Math.min(300,Math.max(20,Math.round(Number($('bpm').value)||current().bpm)));
  $('bpm').value=bpm;$('metroTempoLabel').textContent=bpm+' BPM';
  if(standalone){stopMetronome();await startMetronome();}
  await editProject(currentId,project=>{project.bpm=bpm;});
}
function tapTempo(){
  const now=performance.now();
  if(now-(tapTimes.at(-1)||0)>3200)tapTimes=[];
  tapTimes.push(now);tapTimes=tapTimes.slice(-9);
  if(tapTimes.length<2){$('tapStatus').textContent='Sigue tocando al ritmo…';return;}
  const bpm=Math.round(60000*(tapTimes.length-1)/(now-tapTimes[0]));
  if(bpm>=20 && bpm<=300){$('bpm').value=bpm;$('tapStatus').textContent=bpm+' BPM · '+tapTimes.length+' pulsos';return saveTempo();}
}
async function download(blob,name){
  if(!blob)throw Error('No se encuentra el archivo en este dispositivo.');
  if(window.Capacitor?.getPlatform?.()==='android'){
    const {exportDocument}=await import('./android-export.js');
    return exportDocument(blob,name);
  }
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function showPicker(input,target,multiple=false){
  input.value='';input.multiple=multiple;
  if(input===$('audioInput'))fileTarget=target;
  if(input===$('coverInput'))coverTarget=target;
  input.click();
}
async function withImport(target,action) {
  if(importJob)return;
  const job={target,controller:new AbortController()};
  const {signal}=job.controller;
  importJob=job;$('appError').hidden=true;$('importState').hidden=false;
  const status=value=>{if(importJob===job)$('importStatus').textContent=value;};
  refreshLibrary();
  try{await action({signal,onStatus:status});}
  catch(error){if(signal.aborted)toast('Operación cancelada');else throw error;}
  finally{if(importJob===job)importJob=null;$('importState').hidden=true;refreshLibrary();}
}
async function applyAsset(projectId,songId,action) {
  return queueWrite(async()=>{
    const updated=await action();
    const project=projects.find(item=>item.id===projectId);
    if(!project)return;
    const index=project.repertoire.findIndex(song=>song.id===songId);
    if(index===-1)project.repertoire.push(updated);else project.repertoire[index]=updated;
    if(currentId===projectId){
      if(engine.snapshot().song?.id===songId && engine.snapshot().song.audioId!==updated.audioId)engine.stop();
      else engine.updateSong(updated);
      refreshLibrary();
    }
    return updated;
  });
}
async function importAudio(files,target) {
  if(!files.length || !target)return;
  await withImport(target,async options=>{
    const {prepareAudio}=await import('./media.js');
    let imported=0;
    const failures=[];
    for(const file of files){
      options.signal.throwIfAborted();
      const id=target.songId||makeId();
      try{
        const label=files.length>1 ? (imported+failures.length+1)+'/'+files.length+' · ' : '';
        options.onStatus(label+'Abriendo '+file.name+'…');
        const prepared=await prepareAudio(file,{...options,onStatus:value=>options.onStatus(label+file.name+' · '+value)});
        options.signal.throwIfAborted();
        const project=projects.find(p=>p.id===target.projectId);
        if(!project)throw Error('El proyecto ya no existe.');
        const newSong=target.songId ? undefined : cleanSong({id,title:prepared.tagTitle||file.name.replace(/\.[^.]+$/,''),artist:prepared.tagArtist||'',bpmSource:'default'},project.bpm);
        const saved=await applyAsset(target.projectId,id,()=>{
          options.signal.throwIfAborted();
          return library.attachAudio(db,target.projectId,id,prepared,{newSong});
        });
        imported++;
        if(saved && settings.announcements) {
          options.onStatus(label+'Preparando el anuncio de «'+saved.title+'»…');
          try { await engine.prepareAnnouncement(saved); }
          catch { failures.push(saved.title+' · Audio guardado. El anuncio se preparará al reproducir.'); }
        }
        if(currentId===target.projectId && files.length===1){selectedSongId=id;editorOpen=true;}
      }catch(error){if(options.signal.aborted)throw error;failures.push(file.name+' · '+(error.message||'Error al importar'));}
    }
    if(imported)toast(imported===1?'Audio guardado en el dispositivo':imported+' audios guardados');
    if(failures.length)report(Error(failures.join(' / ')));
  });
}
async function analyzeSelected(){
  const song=selected(), projectId=currentId;
  if(!song?.audioId)return;
  const {audioId,id}=song;
  await withImport({projectId,songId:id},async options=>{
    options.onStatus('Analizando canción…');
    const {analyzeAudio}=await import('./media.js');
    const blob=await library.getAudio(db,audioId);
    if(!blob)throw Error('No se encuentra el archivo para analizar.');
    const result=await analyzeAudio(blob,options);
    options.signal.throwIfAborted();
    await editProject(projectId,project=>{
      const item=project.repertoire.find(s=>s.id===id);
      if(!item || item.audioId!==audioId)return;
      Object.assign(item,applyAnalysis(item,result,project.bpm));
    });
    if(currentId===projectId && selected()?.id===id)engine.updateSong(selected());
  });
}
function bindEditor(){
  const target=()=>({projectId:currentId,songId:selected().id});
  renderEditor=mountEditor({selected,showCover,patch:guard(saveSong),move:guard(step=>moveSong(selectedSongId,step)),
    searchTempo:guard(() => lookupTempo(current(),selected(),true)),
    setMetroTempo:guard(async()=>{const bpm=selected().bpm;$('bpm').value=bpm;await saveTempo();toast('Metrónomo del proyecto a '+bpm+' BPM');}),
    close:()=>{editorOpen=false;refreshLibrary();},
    remove:guard(async()=>{
      const song=selected(),id=currentId;
      if(!confirm('¿Eliminar «'+song.title+'» del repertorio?'))return;
      if(engine.snapshot().queue?.some(item=>item.id===song.id))engine.stop();
      await editProject(id,project=>{project.repertoire=project.repertoire.filter(item=>item.id!==song.id);});
    }),
    importAudio:()=>showPicker($('audioInput'),target()),chooseCover:()=>showPicker($('coverInput'),target()),
    removeAudio:guard(async()=>{
      const {projectId,songId}=target();
      if(confirm('¿Quitar este audio de la canción?')) await applyAsset(projectId,songId,()=>library.removeAudio(db,projectId,songId));
    }),
    restoreCover:guard(async()=>{const {projectId,songId}=target();await applyAsset(projectId,songId,()=>library.restoreCover(db,projectId,songId));}),
    exportAudio:guard(async converted=>{
      const song=selected();const blob=await (converted?library.getAudio:library.getOriginal)(db,song.audioId);
      await download(blob,converted?song.audioName.replace(/\.[^.]+$/,'')+'-convertido.wav':song.audioName);
    }),
    reanalyze:guard(analyzeSelected)
  });
}

async function createProject(name) {
  const project=await queueWrite(()=>library.saveProject(db,cleanProject({id:makeId(),name,saved:true})));
  replaceRecord(project);selectProject(project.id);
}
async function deleteCurrent(){
  const project=current();
  if(!confirm('¿Eliminar el proyecto «'+project.name+'» con su repertorio?'))return;
  await queueWrite(async()=>{
    await library.deleteProject(db,project.id);
    projects=projects.filter(item=>item.id!==project.id);
    if(!projects.length)projects.push(await library.saveProject(db,cleanProject({name:'Mi primer proyecto'})));
  });
  selectProject(projects[0].id);
}
async function importProject(file) {
  if(!file)return;
  const data=JSON.parse(await file.text()), source=data.project || data;
  if(typeof source?.name!=='string' || !Array.isArray(source.repertoire))throw Error('Archivo de repertorio no válido.');
  const project=cleanProject({...source,id:makeId(),saved:true});
  // A .pulso contains references only. Reuse local assets when present.
  for(const song of project.repertoire){
    if(song.audioId && !await library.getOriginal(db,song.audioId)){
      song.audioId=null;song.duration=0;song.compatibility='Importar audio en este dispositivo';
    }
    for(const key of ['coverId','embeddedCoverId','onlineCoverId'])if(song[key] && !await library.getCover(db,song[key]))song[key]=null;
  }
  await queueWrite(()=>library.saveProject(db,project));
  replaceRecord(project);selectProject(project.id);toast('Repertorio importado');
}
function bindEvents() {
  const tabs=Array.from(document.querySelectorAll('.nav-tab'));
  for(const [i,tab] of tabs.entries()){
    tab.onclick=()=>switchView(tab.dataset.view);
    tab.onkeydown=event=>{
      const next={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
      if(next!=null){event.preventDefault();tabs[next].click();tabs[next].focus();}
    };
  }
  $('toolsToggle').onclick=()=>{$('projectTools').open=!$('projectTools').open;};
  $('projectTools').ontoggle=()=>$('toolsToggle').setAttribute('aria-expanded',String($('projectTools').open));
  $('projectSelect').onchange=event=>selectProject(event.target.value);
  $('newProjectBtn').onclick=()=>showModal('Nuevo proyecto','',createProject);
  const nameProject=title=>{const id=currentId;showModal(title,current().name,async name=>{
    await editProject(id,p=>{p.name=name;p.saved=true;});renderProjects();toast('Proyecto guardado');
  });};
  $('renameProjectBtn').onclick=$('renameRepertoireBtn').onclick=()=>nameProject('Renombrar repertorio');
  $('saveProjectBtn').onclick=guard(async()=>{
    if(!current().saved)return nameProject('Guardar proyecto');
    await pending;toast('Proyecto guardado en este dispositivo');
  });
  $('deleteProjectBtn').onclick=guard(deleteCurrent);
  $('bgColor').onchange=guard(async event=>{
    const color=event.target.value;
    const project=await editProject(currentId,item=>{item.theme.bg=color;});
    if(currentId===project.id)applyTheme(project);
  });
  $('exportProjectBtn').onclick=guard(async()=>{
    await pending;const project=current();
    await download(new Blob([JSON.stringify({project},null,2)],{type:'application/json'}),(project.name.replace(/[^\p{L}\p{N}\- ]/gu,'')||'proyecto')+'.pulso');
  });
  $('importProjectBtn').onclick=()=>showPicker($('importFile'));
  $('importFile').onchange=guard(event=>importProject(event.target.files[0]));
  $('addSongBtn').onclick=()=>{$('newSongForm').hidden=false;$('newSongTitle').focus();};
  $('cancelSongBtn').onclick=()=>{$('newSongForm').hidden=true;};
  $('newSongForm').onsubmit=guard(async event=>{
    event.preventDefault();
    const title=$('newSongTitle').value.trim();if(!title)return $('newSongTitle').focus();
    const artist=$('newSongArtist').value.trim(),songId=makeId(),id=currentId;
    $('newSongForm').hidden=true;$('newSongForm').reset();
    await editProject(id,p=>p.repertoire.push(cleanSong({id:songId,title,artist,bpmSource:'default'},p.bpm)));
    if(id===currentId)openEditor(songId);
  });
  $('songFinder').oninput=()=>renderRows(current());
  $('playSet').onclick=guard(()=>player.openSet(current().repertoire));
  $('importTracks').onclick=()=>showPicker($('audioInput'),{projectId:currentId},true);
  $('audioInput').onchange=guard(event=>importAudio(Array.from(event.target.files),fileTarget));
  $('coverInput').onchange=guard(async event=>{
    const file=event.target.files[0];if(!file)return;
    const {projectId,songId}=coverTarget;
    const {prepareCover}=await import('./media.js');
    const cover=await prepareCover(file);
    await applyAsset(projectId,songId,()=>library.attachCover(db,projectId,songId,cover));
  });
  $('cancelImport').onclick=()=>importJob?.controller.abort();
  $('bpm').onchange=guard(saveTempo);
  $('plus').onclick=guard(()=>{$('bpm').value=Math.min(300,Number($('bpm').value)+1);return saveTempo();});
  $('minus').onclick=guard(()=>{$('bpm').value=Math.max(20,Number($('bpm').value)-1);return saveTempo();});
  $('tapBig').onclick=guard(tapTempo);
  $('metroBtn').onclick=guard(()=>standalone?stopMetronome():startMetronome());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMetronome();});
  window.addEventListener('pagehide',()=>{importJob?.controller.abort();stopMetronome();engine.stop();});
}
async function initialize() {
  try{
    const stored=JSON.parse(readPreference(settingsKey)||'{}') || {};
    settings={...settings,...stored};
    if(!stored.clickVolumeV2 && stored.clickVolume===.6)settings.clickVolume=UI_DEFAULTS.clickVolume;
  }catch{}
  settings.clickVolumeV2=true;
  if (!settings.soundEntryV2) {
    settings={...settings,metronomeEnabled:true,soundEntryV2:true};
    localStorage.setItem(settingsKey,JSON.stringify(settings));
  }
  applyPalette(settings.palette);
  db=await library.openDB();
  projects=await library.listProjects(db);
  if(!projects.length)projects.push(await library.saveProject(db,cleanProject({name:'Mi primer proyecto'})));
  engine=new PlaybackEngine({getAudio:id=>library.getAudio(db,id),getSettings:()=>settings});
  bindEditor();
  const options={
    engine,getSettings:()=>settings,getProjectTempo:()=>current().bpm,saveSettings,saveSong,getCover:id=>library.getCover(db,id),notify:toast,
    onOpen:()=>{stopMetronome();$('libraryPanel').hidden=true;$('projectTools').open=false;},
    back:()=>{$('libraryPanel').hidden=false;refreshLibrary();},
    storageStats:()=>library.storageInfo(db),cleanOrphans:()=>queueWrite(()=>library.clearOrphans(db))
  };
  player=mountPlayer($('playerPanel'),options);
  settingsPanel=mountSettings($('settingsPanel'),options);
  bindEvents();
  selectProject(projects.find(p=>p.id===readPreference(currentKey))?.id || projects[0].id);
}
initialize().catch(report);
if(import.meta.env.PROD && navigator.serviceWorker && window.isSecureContext && !window.Capacitor?.isNativePlatform?.()){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>toast('El navegador no ha podido guardar la aplicación para abrirla sin conexión.'));
}
