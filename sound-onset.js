// Inspect each channel before mixing. A stereo intro can cancel in mono.
// A short window retains quiet attacks while rejecting DC and low-level dither.
export function firstSound(channels, rate) {
  const window = Math.max(1, Math.round(rate * .006));
  const length = channels[0]?.length || 0;
  for (let start = 0; start < length; start += window) {
    const end = Math.min(start + window, length);
    let first = end;
    for (const channel of channels) {
      let sum = 0, squares = 0, min = Infinity, max = -Infinity;
      for (let i = start; i < end; i++) {
        const v = channel[i];
        sum += v;
        squares += v * v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const count = end - start, mean = sum / count;
      if (squares / count - mean * mean < 1e-6 && max - min < .018) continue;
      const baseline = channel[Math.max(0, start - 1)];
      let i = start;
      while (i < end && Math.abs(channel[i] - baseline) < .001) i++;
      first = Math.min(first, i);
    }
    if (first < end) return first / rate;
  }
  return null;
}
