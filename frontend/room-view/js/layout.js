// Room layout in metres, in the coordinates of room.glb after scaling it by 0.01 (the model is in cm).
// x: left wall (-2.12) to the open side (1.88) · y: floor (0) to 2.4 · z: far end (-5.42) to back wall (1.92)
// The model has no window, door or radiator: the window replaces the painting above the sofa,
// the door replaces the small painting at the far end, and the air vent in the corner is the heater.
// Later this comes from the backend (one layout per device), so the website and the app agree.

export const ROOM = {
  min: { x: -2.1194, y: 0, z: -5.4238 },
  max: { x: 1.8806, y: 2.4, z: 1.9172 },
  leftWallX: -2.1194,
  backWallZ: 1.9172,
};

export const WINDOW = { z0: -1.2, z1: 0.5, y0: 1.05, y1: 2.05 };
export const DOOR = { z0: -5.35, z1: -4.45, y0: 0, y1: 2.05 };
export const HEATER = { x: -1.73, y: 0.28, z: 1.89 };
export const HIDDEN_NODES = ['paint1', 'paint3'];

export const SENSORS = {
  Centre: { pos: [-0.12, 1.2, -1.75], label: 'Room centre', note: 'Hanging in the middle of the room' },
  Window: { pos: [-1.98, 1.45, -0.35], label: 'Window', note: 'Next to the window above the sofa' },
  Heater: { pos: [-1.73, 0.48, 1.8], label: 'Heater', note: 'On the warm-air outlet' },
  Door: { pos: [-1.98, 1.1, -4.9], label: 'Door', note: 'Beside the door at the far end' },
  'Far wall': { pos: [1.6, 1.4, 1.82], label: 'Far wall', note: 'On the back wall, by the wardrobe' },
};
export const SENSOR_NAMES = Object.keys(SENSORS);
export const AMBIENT = ['Centre', 'Far wall', 'Door'];

export const CAMERA_PRESETS = {
  overview: { pos: [6.4, 6.0, -8.4], target: [-0.3, 0.15, -1.8] },
  window: { pos: [2.6, 2.5, -2.9], target: [-1.9, 1.15, -0.2] },
  door: { pos: [2.2, 2.4, -3.0], target: [-2.0, 0.95, -4.9] },
  heater: { pos: [1.4, 1.9, -1.4], target: [-1.6, 0.5, 1.6] },
  top: { pos: [-0.12, 10.5, -1.74], target: [-0.12, 0, -1.75] },
};
