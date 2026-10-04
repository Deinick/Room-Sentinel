// Barely visible particles drifting behind the page, almost the colour of the dark background.
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let particles = [];
let w = 0, h = 0, ratio = 1;

function resize() {
  ratio = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const count = Math.round(Math.min(90, (w * h) / 16000));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 1 + Math.random() * 2.6,
    vx: (Math.random() - 0.5) * 0.12,
    vy: -0.04 - Math.random() * 0.1, // a slow upward drift
    a: 0.03 + Math.random() * 0.06,
    phase: Math.random() * Math.PI * 2,
  }));
}

function frame(t) {
  ctx.clearRect(0, 0, w, h);
  for (const p of particles) {
    if (!still) {
      p.x += p.vx + Math.sin(t / 4000 + p.phase) * 0.05;
      p.y += p.vy;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(190, 210, 240, ${p.a})`;
    ctx.fill();
  }
  if (!still) requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
