// Cursor personalizado: la Ψ del logo sigue al mouse y suelta hojitas y puntos (violeta, menta, coral).
// Solo con puntero preciso (mouse) y sin "reducir movimiento". Nunca bloquea clics (pointer-events: none).
// Rendimiento: un único requestAnimationFrame, máximo 30 partículas reutilizadas, solo transform y opacity.
const fine = matchMedia('(pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// Trazo de la Ψ tomado de assets/logo/emblema.svg
const PSI = 'M840 1261 1022 1288V1341H476V1288L658 1261V835Q378 835 250 736Q122 637 122 410V79L0 53V0H314V415Q314 586 396 670.5Q478 755 658 756V79L476 53V0H1022V53L840 79V756Q1021 755 1103.5 671Q1186 587 1186 415V0H1500V53L1378 79V410Q1378 636 1250.5 735.5Q1123 835 840 835Z';
const COLORS = ['#5E3F9A', '#BDE9DA', '#F4866A', '#8C78B5'];
const MAX = 30;
const LIFE = 750; // ms
const STEP = 16; // px recorridos entre partícula y partícula
const INTERACTIVE = 'a, button, [role="button"], label, summary, .opt, .mode, .day, .slot, input[type="checkbox"], input[type="radio"]';
const TEXT = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select';

let on = false;
let cursor, dots = [], live = [], raf = 0;
let x = -100, y = -100, lastX = 0, lastY = 0, moved = false;

function build() {
  cursor = document.createElement('div');
  cursor.className = 'psi-cursor is-hidden';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = `<svg viewBox="0 0 1500 1341"><path d="${PSI}"/></svg>`;
  document.body.appendChild(cursor);
  for (let i = 0; i < MAX; i++) {
    const d = document.createElement('span');
    d.className = 'psi-dot';
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    dots.push(d);
  }
}

function spawn(px, py, dx, dy) {
  const d = dots.find((el) => !el._busy);
  if (!d) return; // ya hay 30 en pantalla
  d._busy = true;
  d.className = Math.random() < 0.5 ? 'psi-dot leaf' : 'psi-dot';
  d.style.background = COLORS[(Math.random() * COLORS.length) | 0];
  live.push({ el: d, x: px, y: py, vx: -dx * 0.04 + (Math.random() - 0.5) * 0.9, vy: -dy * 0.04 + Math.random() * 0.5, rot: Math.random() * 360, vr: (Math.random() - 0.5) * 8, t0: performance.now() });
}

function frame(now) {
  if (moved) {
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    moved = false;
  }
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i];
    const k = (now - p.t0) / LIFE;
    if (k >= 1) {
      p.el.style.opacity = '0';
      p.el._busy = false;
      live.splice(i, 1);
      continue;
    }
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr; // caen despacio, girando
    p.el.style.opacity = String(1 - k);
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg) scale(${1 - k * 0.5})`;
  }
  raf = requestAnimationFrame(frame);
}

function onMove(e) {
  x = e.clientX; y = e.clientY; moved = true;
  const dx = x - lastX, dy = y - lastY;
  if (dx * dx + dy * dy > STEP * STEP) {
    spawn(x, y, dx, dy);
    lastX = x; lastY = y;
  }
  if (!cursor.classList.contains('is-text')) cursor.classList.remove('is-hidden');
}

function onOver(e) {
  const t = e.target instanceof Element ? e.target : null;
  cursor.classList.toggle('is-hover', !!t?.closest(INTERACTIVE));
  const text = !!t?.closest(TEXT);
  cursor.classList.toggle('is-text', text);
  cursor.classList.toggle('is-hidden', text);
}
const onDown = () => cursor.classList.add('is-down');
const onUp = () => cursor.classList.remove('is-down');
const onLeave = () => cursor.classList.add('is-hidden');

function enable() {
  if (on) return;
  on = true;
  if (!cursor) build();
  document.documentElement.classList.add('psi-on');
  addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('pointerup', onUp, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  raf = requestAnimationFrame(frame);
}

function disable() {
  if (!on) return;
  on = false;
  document.documentElement.classList.remove('psi-on');
  removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerover', onOver);
  removeEventListener('pointerdown', onDown);
  removeEventListener('pointerup', onUp);
  document.documentElement.removeEventListener('pointerleave', onLeave);
  cancelAnimationFrame(raf);
  cursor.classList.add('is-hidden');
  for (const p of live) { p.el.style.opacity = '0'; p.el._busy = false; }
  live = [];
}

const update = () => (fine.matches && !calm.matches ? enable() : disable());
update();
fine.addEventListener('change', update);
calm.addEventListener('change', update);
