import './player-ui.css';
import {defaults as audioDefaults} from './audio-output.js';

export const UI_DEFAULTS = Object.freeze({
  ...audioDefaults, palette: 'original', viewMode: 'rehearsal', wakeLock: false, onlineArtwork: true, onlineTempo:true,
});

export const PALETTES = Object.freeze({
  original: ['Original', '#d4ff54'], lime: ['Verde lima', '#8ff26a'], purple: ['Morado', '#c39aff'],
  blue: ['Azul eléctrico', '#89b6ff'], orange: ['Naranja', '#ffa871'], pink: ['Rosa', '#ff9ac8'],
});

export function applyPalette(name) {
  document.documentElement.style.setProperty('--lime', (PALETTES[name] || PALETTES.original)[1]);
}

const option = (value, label) => new Option(label, value);
const percent = value => Math.round(value * 100) + ' %';
const bytes = value => value >= 1024 ** 3
  ? (value / 1024 ** 3).toLocaleString('es', {maximumFractionDigits: 1}) + ' GB'
  : (value / 1024 ** 2).toLocaleString('es', {maximumFractionDigits: 1}) + ' MB';

function select(key, label, choices = []) {
  return `<label class="fs-field"><span>${label}</span><select data-setting="${key}">${choices.map(([v,n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>`;
}
function toggle(key, label) {
  return `<label class="fs-switch"><input type="checkbox" data-setting="${key}"><span>${label}</span></label>`;
}
function range(key, label, min, max, step) {
  return `<label class="fs-field"><span>${label} <output data-output="${key}"></output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}"></label>`;
}
function group(title, html, open = false) {
  return `<details class="fs-settings-group" ${open ? 'open' : ''}><summary>${title}</summary><div class="fs-group-body">${html}</div></details>`;
}

export function mountSettings(container, {engine, getSettings, saveSettings, storageStats, cleanOrphans, notify}) {
  container.classList.add('fs-settings');
  container.innerHTML = [
    group('Voz y anuncios', [
      toggle('announcements', 'Anunciar el título antes de cada canción'),
      select('voiceLang', 'Idioma'), select('voiceURI', 'Voz para los anuncios'),
      range('announcementGap','Pausa entre el título y el primer clic',0,15,0.5),
      '<p class="fs-help" data-info="voices"></p>',
      range('voiceRate', 'Velocidad de voz', 0.5, 2, 0.05), range('voiceVolume', 'Volumen de voz', 0, 1, 0.01),
      '<button class="btn" type="button" data-action="speak">▶ Escuchar voz</button>',
    ].join(''), true),
    group('Descanso y preparación', [
      toggle('restsEnabled', 'Activar descansos'),
      '<label class="fs-field"><span>Descanso predeterminado entre canciones (s)</span><input data-setting="restSeconds" type="number" min="0" max="3600" step="1"></label>',
      select('manualReady', 'Preparación predeterminada', [['false','Automática'],['true','Esperar «Estamos listos»']]),
      '<p class="fs-help">Para un repertorio mixto, cambia el descanso o la preparación en las canciones que lo necesiten.</p>',
    ].join(''), true),
    group('Metrónomo', [
      toggle('countIn', 'Cuenta de entrada de cuatro clics'), toggle('accent', 'Acentuar el primer pulso'),
      toggle('metronomeEnabled', 'Metrónomo durante la canción'),
      select('clickSound','Sonido del clic',[['classic','Clásico'],['wood','Madera']]),
      range('clickVolume', 'Volumen del metrónomo', 0, 1, 0.01),
    ].join('')),
    group('Reproducción', [
      range('musicVolume', 'Volumen musical', 0, 1, 0.01),
      range('playbackSpeed', 'Velocidad predeterminada', 0.75, 1.25, 0.01),
      toggle('preservesPitch', 'Conservar la tonalidad al cambiar velocidad'),
      select('previewSeconds', 'Duración total de la comparación', [['10','10 segundos'],['12','12 segundos'],['15','15 segundos']]),
      select('repeat', 'Al finalizar el repertorio', [['false','Detener'],['true','Repetir el repertorio']]),
      select('viewMode', 'Vista del reproductor', [['rehearsal','Ensayo'],['live','Directo']]),
      toggle('wakeLock', 'Mantener la pantalla encendida durante la sesión'),
      '<p data-info="wake" class="fs-help"></p>',
    ].join('')),
    group('Apariencia', '<fieldset class="fs-palettes"><legend>Color de acento</legend>' + Object.entries(PALETTES).map(([key,[label,color]]) =>
      `<label style="--swatch:${color}"><input type="radio" name="fs-palette" data-setting="palette" value="${key}"><span>${label}</span></label>`).join('') + '</fieldset>'),
    group('Salidas de audio', [
      toggle('splitStereo', 'Estéreo dividido · música a la izquierda, clic a la derecha'),
      '<p class="fs-help">Para separar los canales, conecta una salida estéreo a dos entradas de la mesa o interfaz. La voz usa la salida del sistema.</p>',
      select('musicSinkId', 'Salida de música', [['','Predeterminada del sistema']]),
      select('clickSinkId', 'Salida de clics', [['','Predeterminada del sistema']]),
      '<div class="fs-button-row"><button type="button" class="btn" data-action="outputs">Actualizar salidas</button><button type="button" class="btn" data-action="authorize">Autorizar dispositivos</button></div><p class="fs-help" data-info="outputs"></p>',
      '<div class="fs-button-row"><button type="button" class="btn" data-action="testMusic">Probar salida de música</button><button type="button" class="btn" data-action="testClick">Probar salida del clic</button></div>',
    ].join('')),
    group('Almacenamiento local', [
      toggle('onlineArtwork','Buscar portadas con conexión'),
      toggle('onlineTempo','Buscar el BPM en internet al importar'),
      '<p class="fs-help">La consulta usa título y artista en MusicBrainz y AcousticBrainz. Si hay resultado, puedes aceptarlo desde la canción.</p>',
      '<p class="fs-help">Si falta la portada, se consulta el título, artista o álbum en MusicBrainz y se guarda la imagen de Cover Art Archive en este dispositivo.</p>',
      '<dl class="fs-storage"><div><dt>Canciones importadas</dt><dd data-stat="audioCount">—</dd></div><div><dt>Archivos de audio</dt><dd data-stat="audioBytes">—</dd></div><div><dt>Espacio disponible estimado</dt><dd data-stat="available">—</dd></div><div><dt>Almacenamiento persistente</dt><dd data-stat="persistent">—</dd></div></dl>',
      '<p class="fs-help" data-info="storage"></p><div class="fs-button-row"><button type="button" class="btn" data-action="clean" disabled>Liberar archivos sin usar</button><button type="button" class="btn" data-action="persist">Solicitar almacenamiento persistente</button></div>',
    ].join('')),
  ].join('');
  const find = (type,key) => container.querySelector(`[data-${type}="${key}"]`);
  const field = key => find('setting', key);
  const action = key => find('action', key);
  const info = (key,value) => { find('info',key).textContent = value; };
  const settings = () => ({...UI_DEFAULTS,...getSettings()});
  let storageVersion = 0;
  let outputVersion = 0;
  let speaking = false;
  let latest = engine.snapshot();
  let lastStorage = null;
  let cleaning = false;
  const fmt = (key,value) => key === 'announcementGap' ? Number(value).toLocaleString('es')+' s' : key === 'voiceRate' ? Number(value).toLocaleString('es') + ' ×' : percent(Number(value));
  function sync() {
    const values = settings();
    applyPalette(values.palette);
    for (const el of container.querySelectorAll('[data-setting]')) {
      const {setting:key} = el.dataset;
      if (el.type === 'radio') el.checked = el.value === values[key];
      else if (el.type === 'checkbox') el.checked = !!values[key];
      else el.value = String(values[key]);
      const output = find('output',key);
      if (output) output.value = fmt(key,values[key]);
    }
    field('restSeconds').disabled = !values.restsEnabled;
    const wakeAvailable = !!navigator.wakeLock?.request;
    field('wakeLock').disabled = !wakeAvailable;
    info('wake',wakeAvailable ? '' : 'Este dispositivo no permite mantener la pantalla encendida desde el navegador.');
    const pitchSupported = 'preservesPitch' in HTMLMediaElement.prototype || 'mozPreservesPitch' in HTMLMediaElement.prototype || 'webkitPreservesPitch' in HTMLMediaElement.prototype;
    field('preservesPitch').disabled = !pitchSupported;
    if (!pitchSupported) field('preservesPitch').parentElement.title = 'El dispositivo controla la tonalidad.';
  }
  function syncTransport() {
    const active = !['idle', 'finished'].includes(latest.state);
    action('speak').disabled = active || speaking;
    action('speak').title = active ? 'Detén la sesión para escuchar una muestra.' : '';
    const supports = engine.supportsOutputs();
    field('musicSinkId').disabled = !supports || active;
    field('clickSinkId').disabled = !supports || active;
    field('splitStereo').disabled = active || !(window.AudioContext || window.webkitAudioContext)?.prototype?.createStereoPanner;
    action('outputs').disabled = !supports;
    action('authorize').hidden = !supports || !(navigator.mediaDevices?.selectAudioOutput || navigator.mediaDevices?.getUserMedia);
    action('authorize').disabled = active;
    action('testMusic').disabled = active;
    action('testClick').disabled = active;
    info('outputs', !supports ? 'Elige altavoz, auriculares o Bluetooth desde las salidas de audio del móvil. El estéreo dividido permite separar música y clic por los canales izquierdo y derecho de una salida estéreo.' :
      active ? 'Detén la sesión para cambiar las salidas.' : navigator.mediaDevices?.selectAudioOutput
        ? 'Autoriza los dispositivos y elige una salida para cada señal. Puedes comprobarlas con los botones de prueba.'
        : 'Autorizar dispositivos solicita permiso de micrófono para mostrar las salidas disponibles. El micrófono se cierra al conceder el permiso.');
  }
  function syncVoices() {
    const {voiceURI, voiceLang} = settings();
    const all = engine.getVoices();
    const langs = [...new Set(['es-ES',voiceLang,...all.map(v => v.lang)].filter(Boolean))].sort();
    const language = field('voiceLang');
    language.replaceChildren(...langs.map(code => option(code,code)));
    language.value = voiceLang;
    const local = all.filter(v => !voiceLang || v.lang.toLowerCase() === voiceLang.toLowerCase());
    const voice = field('voiceURI');
    const chosen = all.find(v => v.voiceURI === voiceURI);
    if (chosen && !local.includes(chosen)) local.push(chosen);
    voice.replaceChildren(option('', /^es\b/i.test(voiceLang) ? 'Automática · DaveFX neuronal' : 'Automática del sistema'), ...local.map(v => option(v.voiceURI, v.name + (v.localService ? '' : ' · en línea'))));
    voice.value = chosen ? voiceURI : '';
    info('voices', chosen && !chosen.localService ? 'La voz seleccionada puede necesitar conexión.' :
      all.length ? '' : 'El dispositivo aún no ha listado voces. Si la voz falla, verás el título en pantalla.');
  }
  async function syncOutputs() {
    const turn = ++outputVersion;
    if (!engine.supportsOutputs()) return;
    try {
      const outputs = await engine.listOutputs();
      if (turn !== outputVersion) return;
      for (const key of ['musicSinkId', 'clickSinkId']) {
        const selectEl = field(key);
        selectEl.replaceChildren(option('', 'Predeterminada del sistema'), ...outputs.filter(x => x.deviceId && x.deviceId !== 'default').map((x,i) => option(x.deviceId, x.label || ('Salida ' + (i+1)))));
        selectEl.value = settings()[key] || '';
        if (selectEl.selectedIndex < 0) selectEl.value = '';
      }
    } catch (error) { info('outputs',error.message || 'No se han podido consultar las salidas.'); }
  }
  async function syncStorage() {
    const turn = ++storageVersion;
    try {
      const stats = await storageStats();
      if (turn !== storageVersion) return;
      lastStorage = stats;
      find('stat','audioCount').textContent = stats.audioCount;
      find('stat','audioBytes').textContent = bytes(stats.audioBytes);
      find('stat','available').textContent = Number.isFinite(stats.available) ? bytes(stats.available) : 'Sin estimación';
      find('stat','persistent').textContent = stats.persistent == null ? 'Desconocido' : stats.persistent ? 'Concedido' : 'Sin conceder';
      info('storage',stats.orphanCount ? `${stats.orphanCount} archivos sin referencias en tus proyectos.` : 'Todos los archivos están en uso.');
      action('clean').disabled = !stats.orphanCount || cleaning;
      action('persist').hidden = !!stats.persistent || !navigator.storage?.persist;
    } catch { info('storage','No se ha podido consultar el almacenamiento.'); }
  }
  async function refresh() {
    sync(); syncVoices(); syncTransport();
    await Promise.all([syncOutputs(),syncStorage()]);
  }
  container.addEventListener('input', ({target}) => {
    const key = target.dataset.setting;
    if (target.type === 'range' && key) find('output',key).value = fmt(key,target.value);
  });
  container.addEventListener('change', async ({target}) => {
    const key = target.dataset.setting;
    if (!key) return;
    if (!target.reportValidity()) { sync(); return; }
    const type = typeof UI_DEFAULTS[key];
    const value = target.type === 'checkbox' ? target.checked : type === 'number' ? Number(target.value) : type === 'boolean' ? target.value === 'true' : target.value;
    const patch = {[key]:value};
    try {
      if (key === 'voiceLang') patch.voiceURI = '';
      if (key === 'musicSinkId' || key === 'clickSinkId') {
        const route = {...settings(),...patch};
        await engine.setOutputs(route.musicSinkId,route.clickSinkId);
      }
      if (key === 'palette') applyPalette(value);
      await saveSettings(patch);
      engine.refreshSettings(); sync(); syncVoices(); syncTransport();
    } catch (error) {
      if (key === 'musicSinkId' || key === 'clickSinkId') {
        try { await saveSettings({musicSinkId:'',clickSinkId:''}); } catch { /* Retain the original routing error. */ }
      }
      notify(error.message || 'No se pudo guardar el ajuste.');
      await refresh();
    }
  });
  container.addEventListener('click', async ({target}) => {
    const id = target.closest('[data-action]')?.dataset.action;
    try {
      if (id === 'speak') {
        speaking = true; syncTransport();
        try { await engine.previewVoice(); } finally { speaking = false; syncTransport(); }
      } else if (id === 'outputs') await syncOutputs();
      else if (id === 'authorize') {
        await engine.authorizeOutputs();
        await syncOutputs();
      } else if (id === 'testMusic' || id === 'testClick') {
        await engine.testOutput(id==='testMusic' ? 'music' : 'click');
        notify('Prueba enviada a la salida de '+(id==='testMusic' ? 'música' : 'clic')+'.');
      } else if (id === 'persist') {
        const granted = await navigator.storage.persist();
        await syncStorage(); notify(granted ? 'Almacenamiento persistente concedido.' : 'El navegador mantiene su política habitual de almacenamiento.');
      } else if (id === 'clean' && !cleaning && lastStorage?.orphanCount) {
        if (!window.confirm('¿Eliminar del dispositivo los archivos que ya no utiliza ningún proyecto?')) return;
        cleaning = true; action('clean').disabled = true;
        try { const count = await cleanOrphans(); notify(`Archivos eliminados: ${count}.`); }
        finally { cleaning = false; await syncStorage(); }
      }
    } catch (error) { notify(error.message || 'No se pudo completar la operación.'); }
  });
  window.speechSynthesis?.addEventListener('voiceschanged',syncVoices);
  navigator.mediaDevices?.addEventListener('devicechange',syncOutputs);
  let transportState;
  engine.subscribe(snapshot => {
    latest = snapshot;
    if (transportState !== snapshot.state) { transportState = snapshot.state; syncTransport(); }
  });
  sync(); syncVoices(); syncTransport();
  return {refresh};
}

