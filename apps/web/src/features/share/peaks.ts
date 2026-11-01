/** The loudest absolute sample in each of `count` equal slices, across channels, scaled so the top is 1. */
export function computePeaks(channels: Float32Array[], count: number): number[] {
  const length = channels[0]?.length ?? 0;
  const peaks = new Array<number>(count).fill(0);
  if (!length || count <= 0) return peaks;
  for (let p = 0; p < count; p++) {
    const from = Math.floor((p * length) / count);
    const to = Math.max(from + 1, Math.floor(((p + 1) * length) / count));
    let max = 0;
    for (const ch of channels) {
      for (let i = from; i < to && i < length; i++) {
        const v = Math.abs(ch[i] ?? 0);
        if (v > max) max = v;
      }
    }
    peaks[p] = max;
  }
  const top = Math.max(...peaks);
  return top > 0 ? peaks.map((v) => v / top) : peaks;
}
