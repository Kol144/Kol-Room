import './player-ui.css';
import {beatPeriod, effectiveBpm, validLoop} from './audio-output.js';

const coverFallback = './icons/drum-cover.webp';
const terminalStates = new Set(['idle','finished','error']);
const phaseLabels = {
  loading: 'Preparando audio', preparing: '¿Estamos listos?', announcing: 'Anunciando canción',
  announcementGap: 'Pausa antes de la cuenta',
  countIn: 'Cuenta de entrada', playing: 'Reproduciendo ahora', practice: 'Práctica A–B',
  resting: 'Descanso entre canciones', paused: 'En pausa', finished: 'Repertorio finalizado',
  error: 'Reproducción interrumpida', idle: 'Reproductor', preview: 'Comparación de velocidad',
};

function clock(seconds) {
  const s = Math.floor(Math.max(0,Number(seconds) || 0));
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}
const tempo = (song, general) => {
  if (!song) return '';
  const value = effectiveBpm(song,general);
  return Number.isFinite(value) ? Math.round(value).toLocaleString('es') + ' BPM' : '';
};
const button = (action, text, css = '') => `<button class="btn ${css}" type="button" data-action="${action}">${text}</button>`;
const ids = (root,key) => Object.fromEntries([...root.querySelectorAll(`[data-${key}]`)].map(el => [el.dataset[key],el]));
const speedValue = n => Math.round(n*100) + ' %';

function coverSlot(img, getCover) {
  let key, objectUrl = '';
  return async id => {
    const value = id || '';
    if (key === value) return;
    key = value;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    img.src = coverFallback;
    if (!value) return;
    try {
      const blob = await getCover(value);
      if (key === value && blob) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob); img.src = objectUrl;
      }
    } catch { /* A missing optional cover can always use the Kol Room artwork. */ }
  };
}

function wakeController(enabled, notify) {
  let active = false, requested = false, lock = null, version = 0;
  function needed() { return active && enabled() && !document.hidden && !!navigator.wakeLock; }
  async function update(value) {
    active = value;
    if (!needed()) {
      if (requested || lock) version++;
      requested = false;
      const old = lock; lock = null;
      if (old) await old.release().catch(() => {});
      return;
    }
    if (requested || lock) return;
    requested = true;
    const id = ++version;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (id !== version || !needed()) { await acquired.release(); return; }
      lock = acquired;
      acquired.addEventListener('release', () => { if (lock === acquired) lock = null; });
    } catch {
      if (id === version) notify('El dispositivo no ha permitido mantener encendida la pantalla.');
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requested = !!lock; update(active); });
  return update;
}

export function mountPlayer(container, {engine, getSettings, getProjectTempo, saveSettings, saveSong, getCover, back, onOpen, notify}) {
  container.classList.add('fs-player');
  container.innerHTML = `
    <div class="fs-player-nav">
      ${button('back','‹ Repertorio','fs-back')}
      <button type="button" class="btn" data-action="live" aria-pressed="false">Modo directo</button>
    </div>
    <div class="fs-stage">
      <section class="fs-deck" aria-label="Reproductor">
        <div class="fs-sleeve"><img data-part="cover" alt="" src="${coverFallback}"></div>
        <div class="fs-deck-main">
          <div class="fs-phase" data-part="phase" role="status"></div>
          <h2 data-part="title" tabindex="-1"></h2><p class="fs-artist" data-part="artist"></p>
          <div class="fs-track-facts"><span data-part="bpm"></span><span data-part="key"></span></div>
          <div class="fs-count" data-part="beats" aria-label="Cuatro pulsos de entrada" hidden>
            <span>1</span><span>2</span><span>3</span><span>4</span>
          </div>
          <div class="fs-countdown" data-part="countdown" role="timer" hidden></div>
          <p class="fs-statusline" data-part="message" role="status"></p>
          <div class="fs-timeline" data-part="timeline">
            <div class="fs-track"><div data-part="loopMark" class="fs-loop-mark" hidden></div><input type="range" data-field="seek" min="0" max="1" step="0.01" value="0" aria-label="Posición de reproducción"></div>
            <div class="fs-times"><span data-part="elapsed">00:00</span><span data-part="duration">00:00</span></div>
          </div>
          <div class="fs-transport">
            ${button('previous','Anterior')}${button('main','Reproducir','primary fs-main-control')}${button('next','Siguiente')}
          </div>
          <div class="fs-button-row fs-secondary">
            <button class="btn fs-metro-toggle" type="button" data-action="toggleMetro" aria-pressed="false">Activar metrónomo</button>
            ${button('stop','■ Detener')}${button('restart','Reiniciar canción')}${button('skipRest','Saltar descanso')}${button('addRest','Añadir +10 s')}${button('repeat','Repetir repertorio')}
          </div>
        </div>
      </section>
      <aside class="fs-nextqueue" aria-label="Cola de reproducción">
        <section class="fs-next" data-part="nextCard"><h3>Siguiente canción</h3>
          <div class="fs-next-track"><img data-part="nextCover" alt="" src="${coverFallback}"><div><strong data-part="nextTitle"></strong><span data-part="nextArtist"></span><small data-part="nextBpm"></small></div></div>
        </section>
        <section class="fs-queue"><div class="fs-queue-head"><h3>Cola de reproducción</h3><small data-part="queueCount"></small></div><ol data-part="queue"></ol></section>
      </aside>
    </div>
    <div class="fs-panels" data-part="panels">
      <details class="fs-settings-group">
        <summary>Mezcla y metrónomo</summary><div class="fs-group-body">
          <label class="fs-field"><span>Volumen musical <output data-part="musicVolume"></output></span><input type="range" data-field="musicVolume" min="0" max="1" step="0.01"></label>
          <label class="fs-field"><span>Volumen de clics <output data-part="clickVolume"></output></span><input type="range" data-field="clickVolume" min="0" max="1" step="0.01"></label>
          <label class="fs-field"><span>Metrónomo durante esta canción</span><select data-field="metro"><option value="">Usar ajuste general</option><option value="on">Activar</option><option value="off">Desactivar</option></select></label>
          <label class="fs-field"><span>Primer pulso del tema (s)</span><input type="number" data-field="offset" min="0" step="0.001" value="0"></label>
          <div class="fs-button-row">${button('markOffset','Marcar primer pulso aquí')}${button('resetOffset','Restablecer a 0')}</div>
          <p class="fs-help">Los clics siguen un tempo fijo a partir del primer pulso. Una grabación con cambios de tempo requiere reajuste.</p>
        </div>
      </details>
      <details class="fs-settings-group" data-part="practicePanel">
        <summary>Práctica · velocidad y bucle A–B</summary><div class="fs-group-body">
          <label class="fs-field"><span>Velocidad propuesta <output data-part="speed"></output></span><input type="range" data-field="speed" min="0.75" max="1.25" step="0.01"></label>
          <p class="fs-help" data-part="speedHelp"></p>
          <button class="btn" type="button" data-action="matchTempo">Ajustar al metrónomo</button>
          <div class="fs-button-row">${button('preview','▶ Escuchar vista previa')}${button('cancelPreview','Finalizar vista previa')}</div>
          <div class="fs-button-row">${button('applySpeed','Aplicar velocidad','primary')}${button('cancelSpeed','Cancelar')}${button('resetSpeed','Volver al 100 %')}</div>
          <fieldset class="fs-loop-fields"><legend>Bucle A–B</legend>
            <div class="fs-ab-grid"><label class="fs-field"><span>A · Inicio (s)</span><input type="number" data-field="a" min="0" step="0.01"></label>
              <label class="fs-field"><span>B · Final (s)</span><input type="number" data-field="b" min="0" step="0.01"></label>
              ${button('markA','Marcar A aquí')}${button('markB','Marcar B aquí')}
            </div>
            <label class="fs-field"><span>Repeticiones (0 = continuas)</span><input type="number" data-field="repeats" min="0" max="9999" step="1" value="0"></label>
            <label class="fs-switch"><input type="checkbox" data-field="practiceCount"><span>Cuenta de entrada al iniciar el bucle</span></label>
            <div class="fs-button-row">${button('loop','▶ Practicar fragmento','primary')}${button('exitLoop','Salir del bucle')}${button('clearLoop','Borrar selección')}</div>
          </fieldset>
          <fieldset class="fs-loop-fields"><legend>Fragmentos guardados</legend>
            <div class="fs-fragment-save"><label class="fs-field"><span>Nombre del fragmento</span><input type="text" data-field="regionName" maxlength="80" placeholder="Ej. Redoble final"></label>${button('saveRegion','Guardar')}</div>
            <label class="fs-field"><span>Recuperar fragmento</span><select data-field="regions"></select></label>
            <div class="fs-button-row">${button('removeRegion','Quitar fragmento guardado')}</div>
          </fieldset>
          <p class="fs-help" data-part="practiceHelp"></p>
        </div>
      </details>
    </div>`;
  const p = ids(container,'part'), f = ids(container,'field'), btn = ids(container,'action');
  const setHero = coverSlot(p.cover,getCover), setNext = coverSlot(p.nextCover,getCover);
  const updateWake = wakeController(() => getSettings().wakeLock,notify);
  let selection = [], originalMode = 'single', singleIndex = 0, visible = false;
  let state = engine.snapshot(), queueKey = '', regionKey = '', songKey = '';
  let seeking = false, speedDirty = false, draftRate = 1, a = null, b = null;
  let fieldEdit = null, renderedSettings = '';
  const currentSong = () => state.song || selection[originalMode === 'single' ? singleIndex : 0];
  const actualRate = () => currentSong()?.playbackSpeed ?? getSettings().playbackSpeed ?? 1;
  const stateActive = () => !terminalStates.has(state.state);
  const duration = () => Number(state.duration || currentSong()?.duration || 0);
  function updateMark() {
    const total = duration();
    const valid = validLoop({a,b},total);
    p.loopMark.hidden = !valid;
    if (valid) {
      p.loopMark.style.left = (100*a/total) + '%';
      p.loopMark.style.width = (100*(b-a)/total) + '%';
    }
    return valid;
  }
  function renderRegions(song) {
    const regions = song?.loopRegions || [];
    const key = JSON.stringify([song?.id,regions]);
    if (key === regionKey) return;
    regionKey = key;
    const selected = f.regions.value;
    f.regions.replaceChildren(new Option('Seleccionar fragmento…',''),...regions.map((r,i) => new Option(r.name + ' · ' + clock(r.a) + '–' + clock(r.b),String(i))));
    if ([...f.regions.options].some(o => o.value === selected)) f.regions.value = selected;
    btn.removeRegion.disabled = f.regions.value === '';
  }
  function renderQueue(queue, index) {
    const key = JSON.stringify([index,queue.map(s => [s.id,s.title,s.artist])]);
    if (queueKey === key) return;
    queueKey = key;
    p.queueCount.textContent = queue.length ? (index + 1) + ' / ' + queue.length : '';
    p.queue.replaceChildren(...queue.map((song,i) => {
      const li = document.createElement('li');
      if (i === index) li.setAttribute('aria-current','step');
      const num = document.createElement('span'); num.textContent = String(i+1).padStart(2,'0');
      const track = document.createElement('div'); const title = document.createElement('strong'); title.textContent = song.title;
      const artist = document.createElement('small'); artist.textContent = song.artist || '';
      track.append(title,artist); li.append(num,track); return li;
    }));
  }
  function renderTimes() {
    if (!p.countdown.hidden) p.countdown.textContent = clock(Math.ceil(state.remaining));
    if (!p.beats.hidden) [...p.beats.children].forEach((beat,i) => beat.classList.toggle('lit',i+1 === state.beat));
    if (!seeking) {
      f.seek.value = String(state.position || 0);
      const positionLabel = clock(state.position);
      if (p.elapsed.textContent !== positionLabel) p.elapsed.textContent = positionLabel;
      const spoken = positionLabel + ' de ' + clock(duration());
      if (f.seek.getAttribute('aria-valuetext') !== spoken) f.seek.setAttribute('aria-valuetext',spoken);
    }
  }
  function render(snapshot, force = true) {
    const previous = state;
    state = snapshot;
    if (!visible) return;
    const cfg = getSettings();
    const settingsKey = [cfg.musicVolume,cfg.clickVolume,cfg.playbackSpeed,cfg.repeat,cfg.viewMode,cfg.wakeLock,cfg.countIn].join('|');
    if (!force && settingsKey === renderedSettings &&
        ['state','song','next','queue','index','duration','mode','message','pausedFrom','completed','loop','previewStage'].every(key => previous[key] === state[key])) {
      renderTimes(); return;
    }
    renderedSettings = settingsKey;
    const song = currentSong();
    const inSet = state.mode === 'set' && stateActive();
    const preview = state.state === 'preview';
    const resting = state.state === 'resting' || (state.state === 'paused' && state.pausedFrom === 'resting');
    const entering = state.state === 'countIn' || (state.state === 'paused' && state.pausedFrom === 'countIn');
    const live = cfg.viewMode === 'live';
    const finished = state.state === 'finished';
    const single = originalMode === 'single';
    const queue = single || !state.queue.length ? selection : state.queue;
    const index = single ? singleIndex : Math.max(0,state.index);
    const next = state.next ?? queue[index+1];
    const coverSong = resting && next ? next : song;
    const trackChanged = songKey !== (song?.id || '');
    if (trackChanged) {
      songKey = song?.id || ''; speedDirty = false;
      a = null; b = null; f.a.value = ''; f.b.value = ''; f.regionName.value = ''; f.regions.value = '';
      f.practiceCount.checked = cfg.countIn; f.repeats.value = '0'; seeking = false;
    }
    container.classList.toggle('fs-live',live);
    btn.live.setAttribute('aria-pressed',String(live)); btn.live.textContent = live ? 'Volver a ensayo' : 'Modo directo';
    const phase = state.state === 'paused' && resting ? 'Descanso pausado' :
      state.state === 'finished' && originalMode !== 'set' ? 'Reproducción finalizada' : phaseLabels[state.state] || '';
    if (p.phase.textContent !== phase) p.phase.textContent = phase;
    p.title.textContent = finished && originalMode === 'set' ? 'Repertorio finalizado' : (coverSong?.title || 'Reproductor');
    p.artist.textContent = finished && originalMode === 'set' ? `${state.completed} canciones reproducidas` : (coverSong?.artist || '');
    p.bpm.textContent = tempo(coverSong,cfg); p.key.textContent = coverSong?.key || '';
    p.key.hidden = !p.key.textContent; p.bpm.hidden = finished;
    p.beats.hidden = !entering;
    p.countdown.hidden = !resting;
    const msg = preview ? (state.previewStage === 'original' ? 'Fragmento original · 100 %' : 'Fragmento a velocidad propuesta · ' + speedValue(draftRate)) :
      resting ? 'Siguiente canción' : (state.message || '');
    if (p.message.textContent !== msg) p.message.textContent = msg;
    setHero(coverSong?.coverId); setNext(next?.coverId);
    p.nextCard.hidden = !next;
    if (next) { p.nextTitle.textContent = next.title; p.nextArtist.textContent = next.artist || ''; p.nextBpm.textContent = tempo(next,cfg); }
    renderQueue(queue,resting && next ? Math.max(0,queue.findIndex(s => s.id === next.id)) : index);
    renderRegions(song);
    btn.main.textContent = ({preparing:'▶ Estamos listos', paused:'▶ Continuar', error:'Reintentar',
      resting:'Pausar descanso', idle:'▶ Reproducir', finished:'▶ Reproducir de nuevo', preview:'Finalizar muestra'})[state.state] || 'Pausar';
    btn.main.disabled = state.state === 'loading';
    btn.previous.disabled = index === 0 || preview || (!single && !stateActive());
    btn.next.disabled = preview || (single ? !next :
      !stateActive() && state.state !== 'error' || (!next && state.state !== 'preparing' && state.state !== 'error'));
    btn.next.textContent = state.state === 'preparing' || state.state === 'error' ? 'Saltar canción' : 'Siguiente';
    btn.stop.disabled = !stateActive() && state.state !== 'error';
    btn.restart.hidden = live || resting || preview || finished || state.state === 'idle';
    btn.repeat.hidden = live || originalMode !== 'set';
    btn.repeat.setAttribute('aria-pressed',String(cfg.repeat));
    btn.skipRest.hidden = !resting; btn.addRest.hidden = !resting;
    p.timeline.hidden = resting || entering || ['preparing','finished','announcing','error'].includes(state.state);
    const seekable = ['playing','practice'].includes(state.state) || (state.state === 'paused' && ['playing','practice','loaded'].includes(state.pausedFrom));
    f.seek.disabled = !seekable || !duration();
    f.seek.max = String(duration() || 1);
    renderTimes();
    p.duration.textContent = clock(duration());
    const hasRegion = updateMark();
    for (const key of ['musicVolume','clickVolume']) if (fieldEdit !== key) {
      f[key].value = cfg[key]; p[key].value = speedValue(cfg[key]);
    }
    if (document.activeElement !== f.offset) f.offset.value = String(song?.beatOffset || 0);
    f.metro.value = song?.metronomeEnabledOverride == null ? '' : song.metronomeEnabledOverride ? 'on' : 'off';
    const metroOn = song?.metronomeEnabledOverride ?? cfg.metronomeEnabled;
    btn.toggleMetro.textContent = metroOn ? 'Metrónomo activado · Desactivar' : 'Activar metrónomo';
    btn.toggleMetro.setAttribute('aria-pressed',String(metroOn));
    btn.toggleMetro.disabled = !song || preview;
    if (!speedDirty) { draftRate = actualRate(); f.speed.value = draftRate; }
    p.speed.value = speedValue(draftRate);
    const target = getProjectTempo(), ratio = target * beatPeriod(song) / 60;
    btn.matchTempo.textContent = 'Ajustar al metrónomo · '+target+' BPM';
    btn.matchTempo.disabled = !song || preview || ratio < .75 || ratio > 1.25;
    p.speedHelp.textContent = `Aplicada: ${speedValue(actualRate())}. La comparación comienza en la posición de la barra y usa el mismo fragmento a ambas velocidades.`;
    p.practiceHelp.textContent = inSet ? 'Abre una canción individual para comparar velocidad o practicar un bucle fuera de la cola.' : '';
    if (song && (ratio < .75 || ratio > 1.25)) p.speedHelp.textContent += ' El tempo del metrónomo queda fuera del intervalo de práctica (75–125 %).';
    btn.preview.disabled = inSet || preview || !song || !(seekable || ['idle','finished'].includes(state.state));
    btn.cancelPreview.hidden = !preview;
    btn.applySpeed.disabled = preview || !speedDirty;
    btn.cancelSpeed.disabled = !speedDirty || preview;
    btn.resetSpeed.disabled = preview || (actualRate() === 1 && draftRate === 1);
    btn.loop.disabled = inSet || preview || !song || !hasRegion;
    btn.exitLoop.hidden = !state.loop;
    btn.markOffset.disabled = !seekable;
    btn.markA.disabled = !seekable; btn.markB.disabled = !seekable;
    btn.saveRegion.disabled = !hasRegion; btn.clearLoop.disabled = a == null && b == null;
    updateWake(stateActive() && !preview);
  }
  function playSingle(index) {
    const song = selection[index];
    if (!song) return;
    singleIndex = index;
    return engine.start([song],{mode:'single'});
  }
  function show(songs,mode,songId) {
    const playable = songs.filter(song => song?.audioId);
    const index = mode === 'single' ? playable.findIndex(song => song.id === songId) : 0;
    if (!playable.length || index < 0) { notify('Importa un audio reproducible para empezar.'); return; }
    onOpen?.(); visible = true; container.hidden = false;
    selection = playable.map(song => ({...song})); originalMode = mode;
    songKey = ''; queueKey = ''; speedDirty = false;
    const result = mode === 'single' ? playSingle(index) : engine.start(selection,{mode});
    render(engine.snapshot()); p.title.focus({preventScroll:true});
    return result;
  }
  function close() {
    visible = false; container.hidden = true;
    engine.stop(); setHero(null); setNext(null); updateWake(false);
    selection = []; songKey = ''; regionKey = ''; queueKey = ''; back?.();
  }
  async function changeGeneral(patch) {
    await saveSettings(patch); engine.refreshSettings(); render(engine.snapshot());
  }
  async function changeSong(patch) {
    const original = currentSong(); if (!original) return;
    const saved = await saveSong(original.id,patch);
    if (!visible) return;
    const amended = saved && saved.id === original.id ? saved : {...original,...patch};
    selection = selection.map(song => song.id === original.id ? amended : song);
    const queued = engine.snapshot().queue.find(s => s.id === amended.id);
    if (queued && Object.keys(patch).some(key => queued[key] !== amended[key])) engine.updateSong(amended);
    render(engine.snapshot());
  }
  function syncBounds() {
    const parse = el => el.value === '' || !Number.isFinite(el.valueAsNumber) ? null : el.valueAsNumber;
    a = parse(f.a); b = parse(f.b); render(state);
  }
  function startLoop() {
    if (state.mode === 'set' && stateActive()) return;
    if (!updateMark()) { notify('El final B debe estar después de A y dentro de la canción.'); return; }
    if (!f.repeats.reportValidity()) return;
    return engine.start([currentSong()],{mode:'practice',loop:{a,b,repeats:Number(f.repeats.value)},countIn:f.practiceCount.checked});
  }
  async function onAction(id) {
    const song = currentSong();
    switch (id) {
      case 'back': close(); break;
      case 'live': await changeGeneral({viewMode:getSettings().viewMode === 'live' ? 'rehearsal' : 'live'}); break;
      case 'main':
        if (state.state === 'preparing') engine.ready();
        else if (state.state === 'paused') await engine.resume();
        else if (state.state === 'error') await engine.retry();
        else if (state.state === 'preview') engine.cancelPreview();
        else if (terminalStates.has(state.state)) {
          if (originalMode === 'single') await playSingle(singleIndex);
          else await engine.start(selection,{mode:'set'});
        }
        else engine.pause();
        break;
      case 'stop': engine.stop(); break;
      case 'previous':
        if (originalMode === 'single') await playSingle(singleIndex-1);
        else await engine.previous();
        break;
      case 'next':
        if (originalMode === 'single') await playSingle(singleIndex+1);
        else await engine.next();
        break;
      case 'restart': await engine.restart(); break;
      case 'addRest': engine.addRest(10); break;
      case 'skipRest': await engine.skipRest(); break;
      case 'repeat': await changeGeneral({repeat:!getSettings().repeat}); break;
      case 'markOffset': await changeSong({beatOffset:+state.position.toFixed(3)}); break;
      case 'resetOffset': await changeSong({beatOffset:0}); break;
      case 'toggleMetro': await changeSong({metronomeEnabledOverride:!(song.metronomeEnabledOverride ?? getSettings().metronomeEnabled)}); break;
      case 'preview': await engine.preview(song,draftRate,state.position || 0); break;
      case 'cancelPreview': engine.cancelPreview(); break;
      case 'matchTempo': draftRate=getProjectTempo()*beatPeriod(song)/60; speedDirty=true; f.speed.value=draftRate; break;
      case 'applySpeed': await changeSong({playbackSpeed:draftRate}); speedDirty = false; break;
      case 'resetSpeed': await changeSong({playbackSpeed:1}); speedDirty = false; break;
      case 'cancelSpeed': speedDirty = false; break;
      case 'markA': f.a.value = (state.position || 0).toFixed(2); syncBounds(); break;
      case 'markB': f.b.value = (state.position || 0).toFixed(2); syncBounds(); break;
      case 'loop': await startLoop(); break;
      case 'exitLoop': engine.setLoop(null); break;
      case 'clearLoop':
        if (state.loop) engine.setLoop(null);
        f.a.value = ''; f.b.value = ''; f.regions.value = ''; f.regionName.value = ''; syncBounds(); break;
      case 'saveRegion': {
        const name = f.regionName.value.trim();
        if (!name) { f.regionName.focus(); notify('Escribe un nombre para guardar este fragmento.'); return; }
        if (!updateMark()) return;
        const regions = [...(song.loopRegions || [])];
        const existing = regions.findIndex(r => r.name === name);
        if (existing !== -1 && !window.confirm('¿Sustituir el fragmento guardado con este nombre?')) return;
        const region = {name,a,b};
        if (existing === -1) regions.push(region); else regions[existing] = region;
        await changeSong({loopRegions:regions});
        if (currentSong()?.id === song.id) f.regions.value = String(existing === -1 ? regions.length-1 : existing);
        notify('Fragmento guardado.'); break;
      }
      case 'removeRegion': {
        if (f.regions.value === '') return;
        const selected = Number(f.regions.value);
        if (!window.confirm('¿Quitar este fragmento guardado?')) return;
        await changeSong({loopRegions:song.loopRegions.filter((_,i) => i !== selected)});
        f.regions.value = ''; break;
      }
    }
    render(engine.snapshot());
    btn.removeRegion.disabled = f.regions.value === '';
  }
  container.addEventListener('click',e => {
    const target = e.target.closest('[data-action]');
    if (target && !target.disabled) onAction(target.dataset.action).catch(error => notify(error.message || 'No se pudo completar la operación.'));
  });
  container.addEventListener('input',({target}) => {
    const key = target.dataset.field;
    if (key === 'seek') { seeking = true; p.elapsed.textContent = clock(target.value); }
    else if (key === 'speed') { speedDirty = true; draftRate = Number(target.value); render(state); }
    else if (key === 'musicVolume' || key === 'clickVolume') { fieldEdit = key; p[key].value = speedValue(target.value); }
    else if (key === 'a' || key === 'b') syncBounds();
  });
  f.seek.addEventListener('blur', () => { seeking = false; render(state); });
  f.seek.addEventListener('pointercancel', () => { seeking = false; render(state); });
  container.addEventListener('change',async ({target}) => {
    const key = target.dataset.field;
    try {
      if (key === 'seek') { seeking = false; await engine.seek(Number(target.value)); }
      else if (key === 'metro') await changeSong({metronomeEnabledOverride:target.value === '' ? null : target.value === 'on'});
      else if (key === 'offset' && f.offset.reportValidity()) await changeSong({beatOffset:Number(target.value)});
      else if (key === 'musicVolume' || key === 'clickVolume') {
        fieldEdit = null; await changeGeneral({[key]:Number(target.value)});
      } else if (key === 'regions' && target.value !== '') {
        const region = currentSong()?.loopRegions?.[Number(target.value)];
        if (region) { f.a.value = region.a; f.b.value = region.b; f.regionName.value = region.name; syncBounds(); }
      }
      btn.removeRegion.disabled = f.regions.value === '';
    } catch (error) { notify(error.message || 'No se pudo guardar el cambio.'); }
  });
  engine.subscribe(snapshot => render(snapshot,false));
  return {openSet:songs => show(songs,'set'), openSong:(songs,songId) => show(songs,'single',songId), close, refresh:() => render(engine.snapshot())};
}

