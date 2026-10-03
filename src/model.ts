export const keys = ['Centre', 'Window', 'Heater', 'Door', 'Far wall'] as const;
export type Sensor = typeof keys[number];
export type Packet = Record<Sensor, number> & { timestamp: string };
export type Point = { x: number; y: number };
export type Layout = Record<Sensor, Point>;
export const colors: Record<Sensor, string> = { Centre: '#d97706', Window: '#028fc7', Heater: '#e52b36', Door: '#16a34a', 'Far wall': '#9333ea' };
export const defaults: Layout = { Centre: { x: .5, y: .5 }, Window: { x: .24, y: .1 }, Heater: { x: .88, y: .28 }, Door: { x: .12, y: .82 }, 'Far wall': { x: .75, y: .87 } };
export const initial: Record<Sensor, number> = { Centre: 22.1, Window: 18.4, Heater: 32.8, Door: 20.6, 'Far wall': 21.4 };
export function parsePacket(value: unknown): Packet {
  if (!value || typeof value !== 'object') throw new Error('Expected a JSON object.');
  const data = value as Record<string, unknown>;
  for (const key of keys) if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < -55 || (data[key] as number) > 125) throw new Error(`Invalid or missing ${key} reading.`);
  if (typeof data.timestamp !== 'string') throw new Error('Missing timestamp.');
  const normalized = data.timestamp.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4');
  if (!Number.isFinite(Date.parse(normalized))) throw new Error('Invalid measurement timestamp.');
  return { ...Object.fromEntries(keys.map(key => [key, data[key]])), timestamp: new Date(normalized).toISOString() } as Packet;
}
export function interpolate(x: number, y: number, layout: Layout, packet: Packet, width: number, length: number) {
  let sum = 0, weights = 0;
  for (const key of keys) {
    const d2 = ((x - layout[key].x) * width) ** 2 + ((y - layout[key].y) * length) ** 2;
    if (d2 < .00001) return packet[key];
    const weight = 1 / d2; sum += packet[key] * weight; weights += weight;
  }
  return sum / weights;
}
export function temperatureColor(t: number): [number, number, number] {
  const stops = [[15, 109, 169, 213], [21, 168, 207, 175], [26, 234, 210, 137], [35, 226, 139, 103]];
  const value = Math.max(15, Math.min(35, t));
  const index = stops.findIndex((stop, i) => i < stops.length - 1 && value <= stops[i + 1][0]);
  const a = stops[Math.max(0, index)], b = stops[Math.max(0, index) + 1];
  const ratio = (value - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map(i => Math.round(a[i] + (b[i] - a[i]) * ratio)) as [number, number, number];
}
