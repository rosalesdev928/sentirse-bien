// Videos decorativos en bucle:
//  - Columnas laterales (.rail video): solo en pantallas de 1400 px o más.
//  - Fondo de la banda superior de las páginas interiores (.band-video): en pantallas de 768 px o más.
// Nunca con "reducir movimiento" ni "ahorro de datos", y recién cuando el video se acerca a la pantalla.
// Si el archivo no existe o falla, el <video> se quita y queda la ilustración o el fondo de color.
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const GROUPS = [
  { sel: '.rail video[data-src]', mq: matchMedia('(min-width: 1400px)') },
  { sel: '.band-video[data-src]', mq: matchMedia('(min-width: 768px)') },
];
const allowed = (mq) => mq.matches && !calm.matches && !navigator.connection?.saveData;

function start(v) {
  const src = v.dataset.src;
  if (!src) return;
  v.removeAttribute('data-src');
  v.addEventListener('playing', () => v.classList.add('is-on'), { once: true });
  v.addEventListener('error', () => v.remove(), { once: true });
  v.src = src;
  v.play().catch(() => { /* autoplay bloqueado: queda la ilustración */ });
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !calm.matches) { start(e.target); io.unobserve(e.target); }
    }
  }, { rootMargin: '300px 0px' })
  : null;

function watch() {
  for (const g of GROUPS) {
    if (!allowed(g.mq)) continue;
    document.querySelectorAll(g.sel).forEach((v) => (io ? io.observe(v) : start(v)));
  }
}

watch();
GROUPS.forEach((g) => g.mq.addEventListener('change', watch));
calm.addEventListener('change', (e) => {
  if (e.matches) document.querySelectorAll('.rail video, .band-video').forEach((v) => v.pause());
});
