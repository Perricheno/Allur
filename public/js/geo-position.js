/** Arc-length interpolation keeps simulated trains on the captured railway geometry. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const p = (b[0] - a[0]) * rad, q = (b[1] - a[1]) * rad;
  const h = Math.sin(p / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(q / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function prepareGeometry(segments) {
  return segments.map(points => {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + distanceKm(points[i - 1], points[i]));
    return { points, lengths, total: lengths.at(-1) };
  });
}
export function coordinateAt(geometry, index) {
  const x = Math.max(0, Math.min(geometry.length, index));
  const segment = geometry[Math.min(geometry.length - 1, Math.floor(x))];
  const fraction = x === geometry.length ? 1 : x - Math.floor(x);
  const target = fraction * segment.total;
  let k = 1;
  while (k < segment.lengths.length - 1 && segment.lengths[k] < target) k++;
  const a = segment.points[k - 1], b = segment.points[k];
  const span = segment.lengths[k] - segment.lengths[k - 1];
  const f = span ? (target - segment.lengths[k - 1]) / span : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
export function indexOfLocation(loc) {
  return loc.kind === 'move' ? loc.from + (loc.to - loc.from) * Math.max(0, Math.min(1, loc.f)) : loc.idx;
}
