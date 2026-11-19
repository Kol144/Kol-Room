// Onset-strength autocorrelation (Ellis) and tonal-template correlation
// (Krumhansl–Kessler). Both are global estimates over sampled song passages.
const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const notes = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const sum = values => values.reduce((a, b) => a + b, 0);

// Reuse the window, permutations, twiddles and scratch space for each FFT.
function spectrumReader(size) {
  const real = new Float32Array(size), imag = new Float32Array(size);
  const window = new Float32Array(size), reverse = new Uint16Array(size);
  const cos = new Float32Array(size / 2), sin = new Float32Array(size / 2);
  const magnitudes = new Float32Array(size / 2);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
    reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * (size / 2));
    if (i < size / 2) {
      cos[i] = Math.cos(-2 * Math.PI * i / size);
      sin[i] = Math.sin(-2 * Math.PI * i / size);
    }
  }
  return (samples, start) => {
    for (let i = 0; i < size; i++) real[reverse[i]] = samples[start + i] * window[i];
    imag.fill(0);
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2, step = size / width;
      for (let base = 0; base < size; base += width) {
        for (let k = 0; k < half; k++) {
          const lo = base + k, hi = lo + half, w = k * step;
          const r = real[hi] * cos[w] - imag[hi] * sin[w];
          const j = real[hi] * sin[w] + imag[hi] * cos[w];
          real[hi] = real[lo] - r;
          imag[hi] = imag[lo] - j;
          real[lo] += r;
          imag[lo] += j;
        }
      }
    }
    for (let i = 0; i < magnitudes.length; i++) magnitudes[i] = Math.sqrt(real[i] ** 2 + imag[i] ** 2);
    return magnitudes;
  };
}

function onsetEnvelope(samples, rate, spectrum, hop) {
  const bands = new Uint8Array(256);
  for (let i = 0; i < bands.length; i++) bands[i] = Math.min(23, Math.floor(6 * Math.log2(1 + i * rate / (512 * 250))));
  const energy = new Float64Array(24), prev = new Float64Array(24), envelope = [];
  for (let start = 0; start + 512 <= samples.length; start += hop) {
    energy.fill(0);
    const magnitudes = spectrum(samples, start);
    for (let i = 1; i < magnitudes.length; i++) energy[bands[i]] += magnitudes[i];
    let strength = 0;
    for (let i = 0; i < energy.length; i++) {
      const log = Math.log1p(energy[i]);
      strength += Math.max(0, log - prev[i]);
      prev[i] = log;
    }
    envelope.push(start ? strength : 0);
  }
  const mean = sum(envelope) / (envelope.length || 1);
  if (mean < 0.0001) return null;
  return envelope.map(x => x - mean);
}

// Measure the phase of strong attacks on a candidate grid. Keeping the start
// time of each excerpt lets later passages constrain drift over the whole song.
function refineGrid(envelopes, starts, rate, hop, coarse) {
  const passages = [];
  for (const [index,env] of envelopes.entries()) {
    if (!env) continue;
    const attacks = [];
    const threshold = Math.sqrt(sum(env.map(v => v*v)) / env.length) * .65;
    for (let i=2; i<env.length-2; i++) {
      if (env[i] <= threshold || env[i] < env[i-1] || env[i] <= env[i+1]) continue;
      const previous = attacks.at(-1);
      if (previous && i - previous.frame < 6) {
        if (env[i] <= previous.strength) continue;
        attacks.pop();
      }
      attacks.push({frame:i,strength:env[i]});
    }
    if (attacks.length < 5) continue;
    const total = sum(attacks.map(a=>a.strength));
    passages.push(attacks.map(a=>({time:(starts[index] || 0) + (a.frame * hop + 350) / rate,
      weight:a.strength / total})));
  }
  if (!passages.length) return {bpm:coarse, offset:null};
  const span = Math.max(1, passages.at(-1).at(-1).time - passages[0][0].time);
  const step = Math.min(.05, 4/span), radius = Math.min(3,coarse*.016);
  let best = {score:0,bpm:coarse,offset:null};
  for (let bpm=coarse-radius; bpm<=coarse+radius; bpm+=step) {
    let x=0,y=0,local=0;
    const frequency = 2*Math.PI*bpm/60;
    for (const attacks of passages) {
      let a=0,b=0;
      for (const {time,weight} of attacks) {
        a += weight*Math.cos(time*frequency);
        b += weight*Math.sin(time*frequency);
      }
      x+=a; y+=b; local+=Math.hypot(a,b);
    }
    const coherence = Math.hypot(x,y)/passages.length;
    const score = (coherence+local/passages.length)/2 - .025*Math.abs(bpm-coarse)/radius;
    if (coherence >= .38 && score > best.score) {
      best = {score,bpm,offset:((Math.atan2(y,x)+2*Math.PI)%(2*Math.PI))/frequency};
    }
  }
  return best;
}

function estimateTempo(segments, rate, starts) {
  const fft = spectrumReader(512), hop = Math.max(1, Math.round(rate * 0.010));
  const envelopes = segments.map(s => onsetEnvelope(s, rate, fft, hop));
  const frameRate = rate / hop;
  const min = Math.floor(frameRate * 60 / 300), max = Math.ceil(frameRate * 60 / 30);
  const scores = new Float64Array(max + 2);
  for (let lag = min - 1; lag <= max + 1; lag++) {
    let dot = 0, left = 0, right = 0;
    for (const env of envelopes) {
      if (!env || env.length < lag * 4) continue;
      for (let i = lag; i < env.length; i++) {
        dot += env[i] * env[i - lag];
        left += env[i] ** 2;
        right += env[i - lag] ** 2;
      }
    }
    scores[lag] = left && right ? Math.max(0, dot / Math.sqrt(left * right)) : 0;
  }
  const peaks = [];
  for (let lag = min; lag <= max; lag++) {
    if (scores[lag] < 0.23 || scores[lag] < scores[lag - 1] || scores[lag] <= scores[lag + 1]) continue;
    const denominator = scores[lag - 1] - 2 * scores[lag] + scores[lag + 1];
    const delta = denominator ? (scores[lag - 1] - scores[lag + 1]) / (2 * denominator) : 0;
    const bpm = 60 * frameRate / (lag + delta);
    // Penalize a multiple of an equally strong fundamental period.
    const shorter = [2, 3, 4].some(n => lag / n >= min && scores[Math.round(lag / n)] > scores[lag] * 0.80);
    peaks.push({ bpm, strength: scores[lag], score: scores[lag] * (shorter ? 0.72 : 1) });
  }
  peaks.sort((a, b) => b.score - a.score);
  const best = peaks[0];
  if (!best) return { detectedBpm: null, bpmConfidence: 0, bpmAlternatives: [] };
  const grid = refineGrid(envelopes, starts, rate, hop, best.bpm);
  const bpm = Math.round(grid.bpm * 100) / 100;
  const competitor = peaks.find(p => {
    const ratio = Math.max(p.bpm, bpm) / Math.min(p.bpm, bpm);
    return Math.abs(ratio - Math.round(ratio)) > 0.07;
  });
  const confidence = best.strength * (competitor ? 1 - 0.5 * competitor.score / best.score : 1);
  if (confidence < 0.26 || bpm < 20 || bpm > 300) return { detectedBpm: null, bpmConfidence: 0, bpmAlternatives: [] };
  const phase = grid.offset !== null && 60 / bpm - grid.offset < .012 ? 0 : grid.offset;
  return { detectedBpm: bpm, detectedBeatOffset: phase === null ? null : Math.round(phase*1000)/1000, bpmConfidence: Math.min(1, confidence),
    bpmAlternatives: [bpm / 2, bpm * 2].filter(x => x >= 20 && x <= 300).map(x => Math.round(x * 10) / 10) };
}

function estimateKey(segments, rate) {
  const size = 4096, fft = spectrumReader(size), chroma = new Float64Array(12);
  const low = Math.max(2, Math.floor(65 * size / rate));
  const high = Math.min(size / 2 - 2, Math.ceil(2100 * size / rate));
  for (const segment of segments) {
    for (let start = 0; start + size <= segment.length; start += Math.floor(rate * 0.16)) {
      const mag = fft(segment, start);
      let peak = 0, floor = 0;
      for (let i = low; i <= high; i++) { peak = Math.max(peak, mag[i]); floor += mag[i]; }
      floor /= high - low + 1;
      if (peak < 0.01 || peak < floor * 5) continue;
      const frame = new Float64Array(12);
      for (let i = low; i <= high; i++) {
        if (mag[i] < Math.max(peak * 0.075, floor * 3) || mag[i] < mag[i - 1] || mag[i] <= mag[i + 1]) continue;
        const delta = 0.5 * (mag[i - 1] - mag[i + 1]) / (mag[i - 1] - 2 * mag[i] + mag[i + 1]);
        const midi = 69 + 12 * Math.log2((i + delta) * rate / (size * 440));
        const note = Math.round(midi);
        if (Math.abs(note - midi) <= 0.40) frame[note % 12] += mag[i];
      }
      const total = sum(frame);
      if (total) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / total;
    }
  }
  const descending = [...chroma].sort((a, b) => b - a);
  const unknown = { detectedKey: '', keyConfidence: 0 };
  if (!descending[0] || descending[2] < 0.065 * descending[0] || sum(descending.slice(0, 3)) < sum(chroma) * 0.44) return unknown;
  const mean = sum(chroma) / 12, candidates = [];
  for (const [profile, mode] of [[major, 'mayor'], [minor, 'menor']]) {
    const avg = sum(profile) / 12;
    for (let root = 0; root < 12; root++) {
      let dot = 0, x = 0, y = 0;
      for (let i = 0; i < 12; i++) {
        const a = chroma[(i + root) % 12] - mean, b = profile[i] - avg;
        dot += a * b; x += a * a; y += b * b;
      }
      candidates.push({ key: notes[root] + ' ' + mode, score: dot / Math.sqrt(x * y) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, second] = candidates;
  if (best.score < 0.60 || best.score - second.score < 0.045) return unknown;
  return { detectedKey: best.key, keyConfidence: Math.min(1, best.score * Math.min(1, (best.score - second.score) / 0.18)) };
}

// Locate the first supported grid attack in the actual introduction. Isolated
// transients before the music must not start the metronome in leading silence.
function firstBeat(samples, rate, bpm, phase) {
  const hop=Math.round(rate*.010), period=60/bpm;
  const env=onsetEnvelope(samples,rate,spectrumReader(512),hop);
  if (!env) return null;
  const peak=Math.max(...env), beats=new Map();
  const tolerance=Math.min(.07,period*.14);
  for (let i=2;i<env.length-2;i++) {
    if (env[i]<peak*.12 || env[i]<env[i-1] || env[i]<=env[i+1]) continue;
    const time=(i*hop+350)/rate;
    const index=Math.round((time-phase)/period);
    if (index>=0 && Math.abs(time-phase-index*period)<=tolerance) beats.set(index,time);
  }
  for (const index of beats.keys()) {
    let support=0;
    for (let step=1;step<=6;step++) if (beats.has(index+step)) support++;
    if (support>=3) return Math.max(0,phase+index*period);
  }
  return null;
}

export function analyzeSegments(segments, rate, starts = [], intro) {
  const tempo=estimateTempo(segments, rate, starts);
  if (intro && tempo.detectedBpm && tempo.detectedBeatOffset != null) {
    const first=firstBeat(intro,rate,tempo.detectedBpm,tempo.detectedBeatOffset);
    tempo.detectedBeatOffset=first==null ? null : Math.round(first*1000)/1000;
  }
  return { ...tempo, ...estimateKey(segments, rate), analysisStatus: 'Análisis completado' };
}
