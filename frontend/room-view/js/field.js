// The estimated temperature anywhere in the room, from five point sensors plus a few anchors
// (window, door, heater). Used by the GPU (surfaces, haze) and by JS (particles, labels), so both
// must compute the same thing: inverse-distance weighting with a soft radius, plus a small
// vertical gradient because warm air rises. It is an illustration between measured points.

import { SENSORS, WINDOW, DOOR, ROOM } from './layout.js';

export const MAX_SOURCES = 10;
export const STRATIFICATION = 0.35; // °C per metre of height, warmer near the ceiling
export const COLOR_SPAN = 4.0; // °C from the target to full blue / full red
const MID_HEIGHT = 1.2;

// Colour stops from far below the target to far above it.
const STOPS = [
  [-1.0, [0.17, 0.43, 1.0]],
  [-0.5, [0.30, 0.76, 1.0]],
  [0.0, [0.87, 0.93, 0.98]],
  [0.5, [1.0, 0.71, 0.36]],
  [1.0, [1.0, 0.32, 0.25]],
];

export function colorFor(temp, target) {
  const d = Math.max(-1, Math.min(1, (temp - target) / COLOR_SPAN));
  for (let i = 1; i < STOPS.length; i++) {
    if (d <= STOPS[i][0]) {
      const [d0, c0] = STOPS[i - 1], [d1, c1] = STOPS[i];
      const f = (d - d0) / (d1 - d0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function cssColor(temp, target) {
  const [r, g, b] = colorFor(temp, target);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/**
 * Sources of the field from the current state.
 * temps: { name: number|null } (smoothed), controls: demo controls or null, room: room temperature.
 * Each source: { x, y, z, t, s (strength), r (soft radius, m) }.
 */
export function buildSources(temps, controls, room) {
  const sources = [];
  for (const [name, info] of Object.entries(SENSORS)) {
    const t = temps[name];
    if (t == null) continue;
    // The heater probe sits on the hot outlet: keep its influence local.
    const local = name === 'Heater';
    sources.push({ x: info.pos[0], y: info.pos[1], z: info.pos[2], t, s: local ? 0.22 : 1.0, r: local ? 0.25 : 0.45 });
  }
  const win = temps.Window ?? room;
  const door = temps.Door ?? room;
  const zc = (WINDOW.z0 + WINDOW.z1) / 2;
  const open = controls ? { closed: 0, tilted: 0.55, open: 1 }[controls.window] ?? 0 : 0;
  if (open > 0 && win != null) {
    // Cold air enters at the window and sinks along the wall below it.
    sources.push({ x: ROOM.leftWallX + 0.1, y: (WINDOW.y0 + WINDOW.y1) / 2, z: zc, t: win, s: 1.4 * open, r: 0.35 });
    sources.push({ x: ROOM.leftWallX + 0.6, y: 0.25, z: zc, t: win + (win - (room ?? win)) * 0.2, s: 1.1 * open, r: 0.5 });
  } else if (win != null) {
    sources.push({ x: ROOM.leftWallX + 0.02, y: (WINDOW.y0 + WINDOW.y1) / 2, z: zc, t: win, s: 0.6, r: 0.4 });
  }
  if (controls?.door_open && door != null) {
    sources.push({ x: ROOM.leftWallX + 0.3, y: 0.9, z: (DOOR.z0 + DOOR.z1) / 2, t: door, s: 1.2, r: 0.45 });
  }
  return sources.slice(0, MAX_SOURCES);
}

export function sample(sources, x, y, z) {
  let sum = 0, weights = 0;
  for (const s of sources) {
    const dx = x - s.x, dy = y - s.y, dz = z - s.z;
    const w = s.s / (dx * dx + dy * dy + dz * dz + s.r * s.r);
    sum += w * s.t;
    weights += w;
  }
  if (!weights) return null;
  return sum / weights + STRATIFICATION * (y - MID_HEIGHT);
}

// GLSL version of sample() and colorFor(), for the surface and haze materials.
export const GLSL = /* glsl */ `
  uniform vec4 uSrc[${MAX_SOURCES}];   // xyz position, w temperature
  uniform vec2 uSrcP[${MAX_SOURCES}];  // strength, radius
  uniform int uCount;
  uniform float uTarget;

  float fieldAt(vec3 p) {
    float sum = 0.0, weights = 0.0;
    for (int i = 0; i < ${MAX_SOURCES}; i++) {
      if (i >= uCount) break;
      vec3 d = p - uSrc[i].xyz;
      float w = uSrcP[i].x / (dot(d, d) + uSrcP[i].y * uSrcP[i].y);
      sum += w * uSrc[i].w;
      weights += w;
    }
    return sum / max(weights, 1e-6) + ${STRATIFICATION.toFixed(3)} * (p.y - ${MID_HEIGHT.toFixed(2)});
  }

  vec3 rampColor(float t) {
    float d = clamp((t - uTarget) / ${COLOR_SPAN.toFixed(1)}, -1.0, 1.0);
    vec3 c0 = vec3(0.17, 0.43, 1.0), c1 = vec3(0.30, 0.76, 1.0), c2 = vec3(0.87, 0.93, 0.98),
         c3 = vec3(1.0, 0.71, 0.36), c4 = vec3(1.0, 0.32, 0.25);
    if (d < -0.5) return mix(c0, c1, (d + 1.0) / 0.5);
    if (d < 0.0) return mix(c1, c2, (d + 0.5) / 0.5);
    if (d < 0.5) return mix(c2, c3, d / 0.5);
    return mix(c3, c4, (d - 0.5) / 0.5);
  }
`;

export function writeUniforms(uniforms, sources, target) {
  for (let i = 0; i < MAX_SOURCES; i++) {
    const s = sources[i];
    if (s) {
      uniforms.uSrc.value[i].set(s.x, s.y, s.z, s.t);
      uniforms.uSrcP.value[i].set(s.s, s.r);
    }
  }
  uniforms.uCount.value = sources.length;
  uniforms.uTarget.value = target;
}
