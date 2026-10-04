export const keys = ['Centre', 'Window', 'Heater', 'Door', 'Far wall'] as const;
export type Sensor = typeof keys[number];
export type Packet = Record<Sensor, number> & { timestamp: string };
export type Point = { x: number; y: number };
export type Layout = Record<Sensor, Point>;
export const colors: Record<Sensor, string> = { Centre: '#d97706', Window: '#028fc7', Heater: '#e52b36', Door: '#16a34a', 'Far wall': '#9333ea' };
export const defaults: Layout = { Centre: { x: .5, y: .5 }, Window: { x: .24, y: .1 }, Heater: { x: .88, y: .28 }, Door: { x: .12, y: .82 }, 'Far wall': { x: .75, y: .87 } };
export const initial: Record<Sensor, number> = { Centre: 22.1, Window: 18.4, Heater: 32.8, Door: 20.6, 'Far wall': 21.4 };
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
/** The dashboard shows one room: the chosen device if it is in the stream, else the first real device, else the first demo device. A sensor without a value keeps its previous one. */
export function packetFromLive(latest: Record<string, { time: string; mode: string; age_seconds: number; sensors: Record<string, { temp: number | null }> }>, previous: Packet, chosen: string | null): { deviceId: string; packet: Packet; time: string } | null {
  const entries = Object.entries(latest);
  const entry = (chosen !== null && latest[chosen] ? [chosen, latest[chosen]] as const : undefined) ?? entries.find(([, r]) => r.mode === 'device') ?? entries[0];
  if (!entry) return null;
  const [deviceId, reading] = entry;
  // Arrival time, not reading.time: the demo device's clock can run faster than real time.
  const timestamp = new Date(Date.now() - reading.age_seconds * 1000).toISOString();
  return { deviceId, time: reading.time, packet: { ...Object.fromEntries(keys.map(k => [k, reading.sensors[k]?.temp ?? previous[k]])), timestamp } as Packet };
}
