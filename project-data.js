const makeId = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

function bounded(value, min, max, fallback) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback;
  return Math.max(min, Math.min(max, Number(value)));
}

function source(value, hasLegacyValue) {
  return ['default', 'manual', 'detected'].includes(value) ? value : hasLegacyValue ? 'manual' : 'default';
}

export function cleanSong(raw, projectBpm = 120) {
  const song = raw || {};
  const created = Number(song.createdAt) || Date.now();
  return {
    ...song,
    id: song.id || makeId(),
    title: String(song.title || 'Sin título'),
    artist: String(song.artist || ''),
    lyrics: String(song.lyrics || ''),
    bpm: Math.round(bounded(song.bpm, 20, 300, bounded(projectBpm, 20, 300, 120))),
    bpmSource: song.bpmSource === 'online' ? 'online' : source(song.bpmSource, Number(song.bpm) > 0),
    key: String(song.key || ''),
    keySource: source(song.keySource, Boolean(song.key)),
    detectedBpm: song.detectedBpm ? Math.round(bounded(song.detectedBpm, 20, 300, 120)) : null,
    detectedBeatPeriod: bounded(song.detectedBeatPeriod, .2, 3, null) ??
      (song.detectedBpm >= 20 && song.detectedBpm <= 300 && Number(song.detectedBpm) % 1 ? 60 / song.detectedBpm : null),
    soundOnset: bounded(song.soundOnset, 0, Infinity, null),
    onlineBpm: song.onlineBpm >= 20 && song.onlineBpm <= 300 ? Math.round(song.onlineBpm) : null,
    onlineBeatPeriod: bounded(song.onlineBeatPeriod, .2, 3, null),
    detectedKey: String(song.detectedKey || ''),
    bpmConfidence: bounded(song.bpmConfidence, 0, 1, 0),
    keyConfidence: bounded(song.keyConfidence, 0, 1, 0),
    bpmAlternatives: Array.isArray(song.bpmAlternatives) ? song.bpmAlternatives.map(Math.round) : [],
    analysisStatus: String(song.analysisStatus || 'Pendiente'),
    audioId: song.audioId || null,
    coverId: song.coverId || null,
    embeddedCoverId: song.embeddedCoverId || null,
    duration: bounded(song.duration, 0, Infinity, 0),
    playbackSpeed: bounded(song.playbackSpeed, 0.75, 1.25, null),
    restOverride: bounded(song.restOverride, 0, 86400, null),
    manualReadyOverride: typeof song.manualReadyOverride === 'boolean' ? song.manualReadyOverride : null,
    metronomeEnabledOverride: typeof song.metronomeEnabledOverride === 'boolean' ? song.metronomeEnabledOverride : null,
    beatOffset: bounded(song.beatOffset, -86400, 86400, 0),
    beatOffsetSource: source(song.beatOffsetSource, Boolean(song.beatOffset)),
    loopRegions: Array.isArray(song.loopRegions) ? song.loopRegions : [],
    createdAt: created,
    updatedAt: Number(song.updatedAt) || created,
  };
}

export function cleanProject(raw) {
  const project = raw || {};
  const oldTheme = project.theme || {};
  const name = String(project.name || 'Mi proyecto');
  return {
    ...project,
    id: project.id || makeId(),
    name,
    saved: typeof project.saved === 'boolean' ? project.saved : name !== 'Mi primer proyecto',
    bpm: Math.round(bounded(project.bpm, 20, 300, 120)),
    key: project.key || '',
    mode: project.mode || 'Mayor',
    note: project.note || '',
    theme: {
      ...oldTheme,
      bg: oldTheme.bg || '#101010',
      panel: oldTheme.panel || oldTheme.pad || '#1e1e1e',
      border: oldTheme.border || '#333333',
    },
    repertoire: Array.isArray(project.repertoire) ? project.repertoire.map(song => cleanSong(song, project.bpm)) : [],
    created: Number(project.created) || Date.now(),
  };
}

// A fresh estimate may replace an earlier estimate. The manual choice
// (including a deliberately empty key) belongs to the musician.
export function applyAnalysis(song, result, projectBpm = 120) {
  const next = { ...song, detectedBpm: result.detectedBpm ? Math.round(result.detectedBpm) : null, detectedKey: result.detectedKey || '',
    soundOnset: result.soundOnset ?? null,
    detectedBeatPeriod: result.detectedBpm ? 60 / result.detectedBpm : null,
    detectedBeatOffset: result.detectedBeatOffset ?? null,
    bpmConfidence: result.bpmConfidence || 0, keyConfidence: result.keyConfidence || 0,
    bpmAlternatives: (result.bpmAlternatives || []).map(Math.round), analysisStatus: result.analysisStatus, updatedAt: Date.now() };
  if (song.bpmSource !== 'manual' && song.bpmSource !== 'online') {
    next.bpm = next.detectedBpm || Math.round(bounded(projectBpm, 20, 300, 120));
    next.bpmSource = next.detectedBpm ? 'detected' : 'default';
  }
  if (song.keySource !== 'manual') {
    next.key = next.detectedKey;
    next.keySource = next.detectedKey ? 'detected' : 'default';
  }
  if (song.beatOffsetSource !== 'manual') {
    const aligned = next.detectedBeatOffset != null && [1, .5, 2].some(factor => Math.abs(next.bpm - next.detectedBpm * factor) <= 1);
    next.beatOffset = aligned ? next.detectedBeatOffset : 0;
    next.beatOffsetSource = aligned ? 'detected' : 'default';
  }
  return next;
}

export function clearOnlineTempo(song, projectBpm) {
  if (song.bpmSource === 'online') {
    song.bpm = song.detectedBpm || projectBpm;
    song.bpmSource = song.detectedBpm ? 'detected' : 'default';
  }
  song.onlineBpm = null;
  song.onlineBeatPeriod = null;
  song.onlineBpmURL = '';
  song.onlineBpmSource = '';
}

export function applyOnlineTempo(song, result) {
  song.onlineBpm = Math.round(result.bpm);
  song.onlineBeatPeriod = result.beatPeriod;
  song.onlineBpmSource = result.source;
  song.onlineBpmURL = result.url;
  if (song.bpmSource === 'manual' || song.preferLocalTempo) return;
  if (result.verified || !song.detectedBpm || Math.abs(song.detectedBpm - song.onlineBpm) <= 1) {
    song.bpm = song.onlineBpm;
    song.bpmSource = 'online';
  }
}
