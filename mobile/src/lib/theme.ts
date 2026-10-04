// The website's palette (frontend/room-view/styles.css), so the app feels like the same product.
export const colors = {
  bg: '#10151d', // the website's navy (frontend/room-view, body background)
  card: 'rgba(255,255,255,0.07)',
  cardStrong: 'rgba(255,255,255,0.11)',
  line: 'rgba(255,255,255,0.14)',
  edge: 'rgba(255,255,255,0.28)', // the light catching the top edge of the glass
  text: '#eef3f9',
  text2: 'rgba(238,243,249,0.66)',
  text3: 'rgba(238,243,249,0.42)',
  accent: '#b9dcff',
  ok: '#7ee2b8',
  warn: '#ffc56b',
  crit: '#ff7a6b',
  cold: '#6fb8ff',
};

// Sharp-ish corners, like the website.
export const radius = { card: 12, control: 8 };

// Ranade, bundled in assets/fonts (loaded in app/_layout.tsx).
export const fonts = {
  light: 'Ranade-Light',
  regular: 'Ranade-Regular',
  medium: 'Ranade-Medium',
  bold: 'Ranade-Bold',
};
