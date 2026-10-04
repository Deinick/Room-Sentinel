// What a reading means, the same way the website shows it (frontend/room-view).
import type { Issue, Latest } from './api';
import { colors } from './theme';

export const SENSORS = [
  { key: 'Centre', label: 'Room centre' },
  { key: 'Window', label: 'Window' },
  { key: 'Heater', label: 'Heater' },
  { key: 'Door', label: 'Door' },
  { key: 'Far wall', label: 'Far wall' },
] as const;

// The median of these is "the room temperature" (window and heater are local hot / cold spots).
const AMBIENT = ['Centre', 'Far wall', 'Door'];

export const STATUS_TEXT: Record<string, string> = {
  ok: 'Reporting',
  missing: 'No signal',
  disconnected: 'Not responding (reads -127)',
  power_on: 'Stuck at power-on value (85)',
  out_of_range: 'Impossible reading',
};

export function roomTemperature(latest?: Latest): number | null {
  if (!latest) return null;
  const values = AMBIENT.map(k => latest.sensors[k]).filter(s => s?.status === 'ok' && s.temp != null).map(s => s.temp as number).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export type RoomStatus = { label: string; color: string };

export function roomStatus(latest: Latest | undefined, issues: Issue[]): RoomStatus {
  if (!latest) return { label: 'Waiting', color: colors.warn };
  if (!latest.live) return { label: 'Offline', color: colors.warn };
  const serious = issues.filter(i => i.severity !== 'INFO');
  if (serious.some(i => i.severity === 'CRITICAL')) return { label: 'Critical', color: colors.crit };
  if (serious.length) return { label: 'Warning', color: colors.warn };
  return { label: 'Normal', color: colors.ok };
}

/** Blue below the target, pale near it, orange above — the website's scale (±4 °C). */
export function tempColor(temp: number, target = 21): string {
  const d = Math.max(-1, Math.min(1, (temp - target) / 4));
  const stops: [number, number[]][] = [[-1, [43, 110, 255]], [-0.5, [77, 194, 255]], [0, [222, 237, 250]], [0.5, [255, 181, 92]], [1, [255, 82, 64]]];
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const [d0, c0] = stops[i - 1], [d1, c1] = stops[i];
      const f = (d - d0) / (d1 - d0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(',')})`;
    }
  }
  return 'rgb(255,82,64)';
}

export function forecastText(issues: Issue[]): string | null {
  const withForecast = issues.find(i => typeof i.evidence?.forecast_minutes === 'number');
  if (!withForecast) return null;
  const m = withForecast.evidence.forecast_minutes as number;
  const about = m < 15 ? Math.max(1, Math.round(m)) : 5 * Math.round(m / 5);
  const word = (withForecast.evidence.direction === 'warm' || withForecast.kind === 'FAST_WARMING') ? 'Above' : 'Below';
  return `${word} ${withForecast.evidence.forecast_limit_c} °C in about ${about} min`;
}

export const kindLabel = (kind: string) => kind.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
