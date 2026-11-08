// Panel de Roxana, pensado primero para celular: citas, calendario, horarios, días libres y ajustes.
// Todo dato escrito por un paciente pasa por esc() antes de entrar a innerHTML.
import { getApi } from './api.js';
import { esc, limaDay, limaTime, shortLabel, dayLong, monthLabel, hmLabel, todayLima, addDays, dayParts, waLink, WHO_LABEL } from './util.js';

const root = document.getElementById('ad-root');
const nav = document.getElementById('ad-nav');
const badge = document.getElementById('nav-badge');
const toastEl = document.getElementById('toast');
const dlg = document.getElementById('dlg');

const WEEK = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
const DAY_NAME = Object.fromEntries(WEEK);
const PRESETS = [['Mañana', '09:00', '13:00'], ['Tarde', '15:00', '19:00'], ['Noche', '19:00', '21:00']];
const STATUS_LABEL = { pendiente: 'Por confirmar', confirmada: 'Confirmada', rechazada: 'Cancelada', cancelada: 'Cancelada' };
const INTRO_KEY = 'sb-panel-intro-ok';
const REFRESH_MS = 60_000;

const S = {
  api: null, user: null, view: 'citas', list: 'pendientes', apps: [], days: null, settings: null, off: [], dirty: false,
  month: todayLima().slice(0, 7), day: todayLima(), // calendario: mes que se ve y día elegido
};

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const toHM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const hhmm = (t) => String(t).slice(0, 5);
const isActive = (a) => a.status === 'pendiente' || a.status === 'confirmada';
const phoneLabel = (p) => `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } } };

const ERR_TEXT = {
  no_autorizado: 'Esta cuenta no tiene acceso al panel.',
  slot_ocupado: 'Esa hora ya la tiene otra cita. Cancela esa otra primero.',
};
const errText = (e) => (e && ERR_TEXT[e.code]) || 'No se pudo guardar. Revisa tu conexión a internet e inténtalo otra vez.';

/* ====================== Arranque ====================== */
(async function init() {
  try {
    S.api = await getApi();
    const user = await S.api.getUser();
    if (user) await enter(user); else viewLogin();
  } catch (e) {
    root.innerHTML = `<div class="card"><h1 class="h1">Sin conexión</h1><p class="lead">No pudimos conectar con la base de datos. Revisa tu internet y vuelve a abrir el panel.</p></div>`;
  }
})();

async function enter(user) {
  S.user = user;
  await loadAll();
  nav.hidden = false;
  document.body.classList.add('is-in');
  go(S.view);
}

setInterval(refreshApps, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshApps(); });

async function loadAll() {
  const [apps, rules, settings, off] = await Promise.all([S.api.listAppointments(), S.api.getRules(), S.api.getSettingsAdmin(), S.api.listTimeOff()]);
  S.apps = apps; S.settings = settings; S.off = off;
  S.days = rulesToDays(rules);
  S.dirty = false;
}

// Recarga solo la lista de citas (cada minuto y al volver a la app). No interrumpe si hay un aviso abierto.
async function refreshApps() {
  if (!S.user || document.visibilityState !== 'visible' || dlg.open) return;
  try {
    const apps = await S.api.listAppointments();
    if (JSON.stringify(apps) === JSON.stringify(S.apps)) return;
    S.apps = apps;
    updateBadge();
    if (S.view === 'citas' || S.view === 'calendario') renderView(false);
  } catch { /* sin conexión por un momento: se intenta en el próximo minuto */ }
}

/* ====================== Navegación ====================== */
nav.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) go(b.dataset.view);
});

function go(view) {
  S.view = view;
  nav.querySelectorAll('[data-view]').forEach((b) => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderView(true);
  scrollTo({ top: 0 });
}

function renderView(focus) {
  const html = { citas: viewCitas, calendario: viewCalendario, horarios: viewHorarios, libres: viewLibres, ajustes: viewAjustes }[S.view]();
  root.innerHTML = html;
  root.dataset.view = S.view; // solo para el diseño de escritorio (ancho de cada pantalla)
  document.body.classList.toggle('has-savebar', S.view === 'horarios'); // el aviso sube para no tapar «Guardar»
  updateBadge();
  bind[S.view]?.();
  if (focus) root.querySelector('.h1')?.focus({ preventScroll: true });
}

function updateBadge() {
  const n = pendingList().length;
  badge.hidden = !n;
  badge.textContent = n;
  badge.setAttribute('aria-label', `${n} por confirmar`);
}

/* ====================== Avisos (toast y diálogo) ====================== */
// Aviso abajo, encima de la barra de navegación. action = { href, label } abre un enlace (WhatsApp).
let toastTimer = 0;
function toast(text, { action, bad = false } = {}) {
  toastEl.innerHTML = `<p>${esc(text)}</p>${action ? `<a class="toast-act" href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>` : ''}<button type="button" class="toast-x" aria-label="Cerrar aviso">×</button>`;
  toastEl.hidden = false;
  toastEl.classList.toggle('is-bad', bad);
  toastEl.querySelector('.toast-x').onclick = () => { toastEl.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action || bad ? 12000 : 5000);
}
const fail = (e) => toast(errText(e), { bad: true });

// Diálogo con "sí / no". Devuelve true si eligió la acción principal. body es HTML ya escapado.
function ask({ title, body, ok, cancel = 'No, volver', danger = false }) {
  dlg.innerHTML = `<form method="dialog" class="dlg-in">
    <h2 id="dlg-t">${esc(title)}</h2>
    <div class="dlg-body">${body}</div>
    <div class="dlg-acts">
      <button class="btn ${danger ? 'btn-danger' : 'btn-main'}" value="ok">${esc(ok)}</button>
      <button class="btn btn-soft" value="no">${esc(cancel)}</button>
    </div></form>`;
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* ====================== Login ====================== */
function viewLogin(error = '') {
  nav.hidden = true;
  document.body.classList.remove('is-in');
  root.innerHTML = `<div class="card login">
    <h1 class="h1" tabindex="-1">Entrar a tu panel</h1>
    <p class="lead">Aquí ves las citas y pones tus horarios.</p>
    <form id="login" novalidate>
      <div class="field"><label for="l-email">Correo</label>
        <input id="l-email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" required></div>
      <div class="field"><label for="l-pass">Contraseña</label>
        <div class="pass"><input id="l-pass" type="password" autocomplete="current-password" required>
        <button type="button" class="pass-eye" aria-pressed="false" aria-controls="l-pass">Ver</button></div></div>
      ${error ? `<p class="msg-bad" role="alert">${esc(error)}</p>` : ''}
      <button class="btn btn-main btn-wide" type="submit">Entrar</button>
    </form>
    <p class="hint">Tu sesión queda abierta en este equipo hasta que pulses «Cerrar sesión» en Ajustes.</p>
    ${S.api.isDemo ? '<p class="demo-note"><b>Modo demo:</b> escribe cualquier correo y contraseña. Los cambios se guardan solo en este navegador.</p>' : ''}
  </div>`;
  const f = document.getElementById('login');
  const eye = f.querySelector('.pass-eye');
  eye.addEventListener('click', () => {
    const p = document.getElementById('l-pass');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    eye.textContent = show ? 'Ocultar' : 'Ver';
    eye.setAttribute('aria-pressed', String(show));
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const email = f.querySelector('#l-email').value.trim();
    const pass = f.querySelector('#l-pass').value;
    if (!email || !pass) return viewLogin('Escribe tu correo y tu contraseña.');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await S.api.signIn(email, pass);
      await enter(await S.api.getUser());
    } catch (err) {
      viewLogin(err.code === 'no_autorizado' ? ERR_TEXT.no_autorizado : 'El correo o la contraseña no coinciden. Inténtalo otra vez.');
    }
  });
  document.getElementById('l-email').focus();
}

/* ====================== Citas ====================== */
const byStart = (a, b) => a.starts_at.localeCompare(b.starts_at);
const future = (a) => new Date(a.ends_at).getTime() > Date.now();
const pendingList = () => S.apps.filter((a) => a.status === 'pendiente' && future(a)).sort(byStart);
const nextList = () => S.apps.filter((a) => a.status === 'confirmada' && future(a)).sort(byStart);
const historyList = () => S.apps.filter((a) => !(isActive(a) && future(a))).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 60);

function whenTag(iso) {
  const d = limaDay(iso), t = todayLima();
  if (d === t) return 'Hoy';
  if (d === addDays(t, 1)) return 'Mañana';
  if (d < t) return '';
  for (let k = 2; k <= 6; k++) if (d === addDays(t, k)) return `En ${k} días`;
  return '';
}

function waFor(a, status = a.status) {
  const name = a.contact_name || a.patient_name;
  const when = shortLabel(a.starts_at);
  const mode = a.mode === 'domicilio' ? `a domicilio${a.district ? ` en ${a.district}` : ''}` : 'virtual';
  const hi = `Hola ${name}, soy Roxana Gutiérrez de Sentirse Bien.`;
  const text = status === 'confirmada' ? `${hi} Tu cita quedó confirmada para el ${when} (${mode}).`
    : status === 'pendiente' ? `${hi} Recibí tu solicitud de cita para el ${when} (${mode}).`
      : `${hi} Lamento avisarte que tuve que cancelar la cita del ${when}. ¿Buscamos otro horario?`;
  return waLink(text, `51${a.phone}`);
}

const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5 5 16a8.4 8.4 0 1 1 15.5-4.4z"/></svg>';

function card(a) {
  const tag = whenTag(a.starts_at);
  const mode = a.mode === 'domicilio' ? `A domicilio${a.district ? ` · ${esc(a.district)}` : ''}` : 'Virtual (videollamada)';
  const live = isActive(a) && future(a);
  const acts = [];
  if (a.status === 'pendiente' && live) acts.push(`<button class="btn btn-main" type="button" data-confirm="${esc(a.id)}">Confirmar</button>`);
  if (live) acts.push(`<button class="btn btn-soft" type="button" data-cancel="${esc(a.id)}">Cancelar</button>`);
  acts.push(`<a class="btn btn-wa" href="${esc(waFor(a))}" target="_blank" rel="noopener">${WA_ICON}WhatsApp</a>`);
  if (a.status === 'confirmada' && live) acts.push(addCalButton(a));
  if (!isActive(a) && future(a)) acts.push(`<button class="btn btn-link" type="button" data-reopen="${esc(a.id)}">Volver a poner por confirmar</button>`);
  return `<article class="cita is-${esc(a.status)}" aria-labelledby="c-${esc(a.id)}">
    <div class="cita-top">
      <h3 class="cita-when" id="c-${esc(a.id)}">${esc(shortLabel(a.starts_at))}</h3>
      ${tag ? `<span class="tag">${tag}</span>` : ''}
      ${S.list === 'historial' ? `<span class="state">${STATUS_LABEL[a.status] || ''}${!future(a) && isActive(a) ? ' · ya pasó' : ''}</span>` : ''}
    </div>
    <p class="cita-name">${esc(a.patient_name)} <span>${esc(WHO_LABEL[a.who] || '')}</span></p>
    <ul class="cita-meta">
      <li><b>Modalidad</b> ${mode}</li>
      ${a.contact_name ? `<li><b>Contacto</b> ${esc(a.contact_name)}</li>` : ''}
      <li><b>Celular</b> <a href="tel:+51${esc(a.phone)}">${esc(phoneLabel(a.phone))}</a></li>
    </ul>
    ${a.notes ? `<p class="cita-note"><b>Comentario</b> ${esc(a.notes)}</p>` : ''}
    <div class="cita-acts">${acts.join('')}</div>
  </article>`;
}

function viewCitas() {
  const lists = { pendientes: pendingList(), proximas: nextList(), historial: historyList() };
  const list = lists[S.list];
  const EMPTY = {
    pendientes: ['No tienes solicitudes nuevas.', 'Cuando alguien reserve en la página, aparecerá aquí para que la confirmes.'],
    proximas: ['Aún no tienes citas confirmadas.', 'Las que confirmes aparecerán aquí, ordenadas por fecha.'],
    historial: ['Todavía no hay historial.', 'Aquí verás las citas pasadas y las canceladas.'],
  };
  const seg = [['pendientes', 'Por confirmar', lists.pendientes.length], ['proximas', 'Próximas', lists.proximas.length], ['historial', 'Historial', 0]];
  return `${introCard()}
    <h1 class="h1" tabindex="-1">Citas</h1>
    <div class="seg" role="group" aria-label="Qué citas ver">
      ${seg.map(([k, t, n]) => `<button type="button" data-list="${k}" aria-pressed="${S.list === k}">${t}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}
    </div>
    <div class="citas">${list.length ? list.map(card).join('') : `<div class="empty"><p class="empty-t">${EMPTY[S.list][0]}</p><p>${EMPTY[S.list][1]}</p></div>`}</div>`;
}

function introCard() {
  if (store.get(INTRO_KEY)) return '';
  const hasRules = Object.values(S.days).some((d) => d.on && d.ranges.length);
  return `<section class="intro" aria-labelledby="intro-t">
    <h2 id="intro-t">Primeros pasos</h2>
    <ol>
      <li class="${hasRules ? 'done' : ''}"><span class="n">${hasRules ? '✓' : '1'}</span><div><b>Pon tus horarios</b><p>Los días y horas en que atiendes.</p><button type="button" class="btn-link" data-goto="horarios">Ir a Horarios</button></div></li>
      <li><span class="n">2</span><div><b>Marca tus días libres</b><p>Feriados, viajes o vacaciones.</p><button type="button" class="btn-link" data-goto="libres">Ir a Días libres</button></div></li>
      <li><span class="n">3</span><div><b>Confirma las citas</b><p>Cada reserva llega aquí como «Por confirmar». Al confirmarla, avísale al paciente por WhatsApp con un toque.</p></div></li>
    </ol>
    <button type="button" class="btn btn-soft" data-intro-ok>Entendido</button>
  </section>`;
}

const findApp = (id) => S.apps.find((a) => a.id === id);

async function setStatus(a, status, okText) {
  try {
    await S.api.setStatus(a.id, status);
    S.apps = await S.api.listAppointments();
    renderView(false);
    const fresh = findApp(a.id) || { ...a, status };
    toast(okText, { action: { href: waFor(fresh, status), label: 'Avisar al paciente por WhatsApp' } });
  } catch (e) { fail(e); }
}

// Botones Confirmar / Cancelar / Agregar a mi calendario (los usan la lista de Citas y la agenda del Calendario)
function bindAppActions(scope) {
  scope.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => {
    const a = findApp(b.dataset.confirm);
    b.disabled = true; b.textContent = 'Confirmando…';
    setStatus(a, 'confirmada', `Cita confirmada: ${shortLabel(a.starts_at)}.`);
  }));
  scope.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    const a = findApp(b.dataset.cancel);
    const ok = await ask({
      title: '¿Cancelar esta cita?',
      body: `<p><b>${esc(a.patient_name)}</b><br>${esc(shortLabel(a.starts_at))}</p><p>La hora quedará libre para otra persona. Después podrás avisarle por WhatsApp.</p>`,
      ok: 'Sí, cancelar', danger: true,
    });
    if (ok) setStatus(a, 'cancelada', 'Cita cancelada. La hora quedó libre.');
  }));
  scope.querySelectorAll('[data-addcal]').forEach((b) => b.addEventListener('click', () => addToCalendar(findApp(b.dataset.addcal))));
}

const bind = {
  citas() {
    root.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => { S.list = b.dataset.list; renderView(false); }));
    root.querySelector('[data-intro-ok]')?.addEventListener('click', () => { store.set(INTRO_KEY, '1'); renderView(true); });
    root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
    bindAppActions(root);
    root.querySelectorAll('[data-reopen]').forEach((b) => b.addEventListener('click', async () => {
      const a = findApp(b.dataset.reopen);
      try { await S.api.setStatus(a.id, 'pendiente'); S.apps = await S.api.listAppointments(); S.list = 'pendientes'; renderView(false); toast('La cita volvió a «Por confirmar».'); } catch (e) { fail(e); }
    }));
  },
  calendario: bindCalendario,
  horarios: bindHorarios,
  libres: bindLibres,
  ajustes: bindAjustes,
};

/* ====================== Calendario ====================== */
const DOW = [['L', 'lunes'], ['M', 'martes'], ['M', 'miércoles'], ['J', 'jueves'], ['V', 'viernes'], ['S', 'sábado'], ['D', 'domingo']];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ymShift = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const appsOn = (d) => S.apps.filter((a) => limaDay(a.starts_at) === d).sort(byStart);
const offOn = (d) => S.off.find((o) => d >= o.date_from && d <= o.date_to);
const CHEV = (dir) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;
const CAL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';

function calDay(d, today) {
  const list = appsOn(d);
  const pend = list.filter((a) => a.status === 'pendiente').length;
  const conf = list.filter((a) => a.status === 'confirmada').length;
  const off = offOn(d);
  const said = [cap(dayLong(d))];
  if (d === today) said.push('hoy');
  if (pend) said.push(`${pend} por confirmar`);
  if (conf) said.push(`${conf} confirmada${conf > 1 ? 's' : ''}`);
  if (off) said.push('día libre');
  return `<button type="button" class="cal-day${off ? ' is-off' : ''}${d === today ? ' is-today' : ''}" data-day="${d}" aria-pressed="${d === S.day}" tabindex="${d === S.day ? 0 : -1}" aria-label="${esc(said.join(', '))}">
    <span class="cal-n">${Number(d.slice(8))}</span>
    <span class="cal-dots" aria-hidden="true">${pend ? '<i class="dot dot-p"></i>' : ''}${conf ? '<i class="dot dot-c"></i>' : ''}</span>
  </button>`;
}

function viewCalendario() {
  const ym = S.month, today = todayLima();
  const lead = (new Date(`${ym}-01T12:00:00-05:00`).getUTCDay() + 6) % 7; // la semana empieza en lunes
  const cells = [...Array(lead)].map(() => '<span class="cal-blank" aria-hidden="true"></span>');
  for (let n = 1; n <= daysIn(ym); n++) cells.push(calDay(`${ym}-${pad(n)}`, today));
  return `<h1 class="h1" tabindex="-1">Calendario</h1>
    <div class="cal-wrap">
      <section class="card cal" aria-labelledby="cal-t">
        <div class="cal-head">
          <h2 class="cal-title" id="cal-t" aria-live="polite">${esc(cap(monthLabel(ym)))}</h2>
          <div class="cal-nav">
            <button type="button" class="icon-btn" data-month="-1" aria-label="Mes anterior">${CHEV(-1)}</button>
            <button type="button" class="btn btn-soft btn-sm" data-today>Hoy</button>
            <button type="button" class="icon-btn" data-month="1" aria-label="Mes siguiente">${CHEV(1)}</button>
          </div>
        </div>
        <div class="cal-grid" role="group" aria-label="Días de ${esc(monthLabel(ym))}">
          ${DOW.map(([s, l]) => `<abbr class="cal-dow" title="${l}">${s}</abbr>`).join('')}
          ${cells.join('')}
        </div>
        <ul class="cal-legend">
          <li><i class="dot dot-p" aria-hidden="true"></i>Por confirmar</li>
          <li><i class="dot dot-c" aria-hidden="true"></i>Confirmada</li>
          <li><i class="sw-off" aria-hidden="true"></i>Día libre</li>
        </ul>
      </section>
      <section class="agenda" id="agenda" aria-labelledby="ag-t">${agendaHTML()}</section>
    </div>`;
}

function agendaItem(a) {
  const live = isActive(a) && future(a);
  const mode = a.mode === 'domicilio' ? `A domicilio${a.district ? ` · ${esc(a.district)}` : ''}` : 'Virtual (videollamada)';
  const acts = [];
  if (a.status === 'pendiente' && live) acts.push(`<button class="btn btn-main" type="button" data-confirm="${esc(a.id)}">Confirmar</button>`);
  if (a.status === 'confirmada' && live) acts.push(addCalButton(a));
  if (live) acts.push(`<button class="btn btn-soft" type="button" data-cancel="${esc(a.id)}">Cancelar</button>`);
  return `<li class="ag-item is-${esc(a.status)}">
    <p class="ag-time">${limaTime(a.starts_at)} – ${limaTime(a.ends_at)}</p>
    <span class="st st-${esc(a.status)}">${STATUS_LABEL[a.status] || ''}${isActive(a) && !future(a) ? ' · ya pasó' : ''}</span>
    <p class="ag-name">${esc(a.patient_name)}</p>
    <p class="ag-mode">${mode}</p>
    ${acts.length ? `<div class="cita-acts">${acts.join('')}</div>` : ''}
  </li>`;
}

function agendaHTML() {
  const d = S.day, list = appsOn(d), off = offOn(d);
  const order = [...list.filter(isActive), ...list.filter((a) => !isActive(a))]; // las canceladas al final
  return `<h2 class="ag-title" id="ag-t">${esc(cap(dayLong(d)))}</h2>
    ${off ? `<p class="ag-off">Marcaste este día como libre${off.note ? ` (${esc(off.note)})` : ''}: nadie puede reservar.</p>` : ''}
    ${order.length ? `<ol class="ag-list">${order.map(agendaItem).join('')}</ol>`
      : `<div class="empty"><p class="empty-t">Sin citas este día.</p><p>${d < todayLima() ? 'Este día ya pasó.' : 'Cuando alguien reserve para este día, aparecerá aquí.'}</p></div>`}`;
}

function pickDay(d, { scroll = false } = {}) {
  S.day = d;
  root.querySelectorAll('.cal-day').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.day === d));
    b.tabIndex = b.dataset.day === d ? 0 : -1; // Tab entra al día elegido; las flechas recorren el mes
  });
  const ag = document.getElementById('agenda');
  ag.innerHTML = agendaHTML();
  bindAppActions(ag);
  // En celular la agenda queda debajo del mes: se baja hasta ella solo si no se ve
  if (scroll && ag.getBoundingClientRect().top > innerHeight - 120) {
    ag.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function bindCalendario() {
  const grid = root.querySelector('.cal-grid');
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) pickDay(b.dataset.day, { scroll: true }); });
  // Flechas del teclado para moverse entre días (y de mes al salir del borde)
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const b = e.target.closest('[data-day]');
    if (!step || !b) return;
    e.preventDefault();
    const d = addDays(b.dataset.day, step);
    if (d.slice(0, 7) !== S.month) { S.month = d.slice(0, 7); S.day = d; renderView(false); }
    else pickDay(d);
    root.querySelector(`[data-day="${d}"]`)?.focus();
  });
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    S.month = ymShift(S.month, Number(b.dataset.month));
    const t = todayLima();
    S.day = t.slice(0, 7) === S.month ? t : `${S.month}-01`;
    renderView(false);
    root.querySelector(`[data-month="${b.dataset.month}"]`)?.focus();
  }));
  root.querySelector('[data-today]').addEventListener('click', () => {
    S.month = todayLima().slice(0, 7); S.day = todayLima();
    renderView(false);
    root.querySelector(`[data-day="${S.day}"]`)?.focus();
  });
  bindAppActions(document.getElementById('agenda'));
}

/* ---------- Agregar a mi calendario (Google Calendar o archivo .ics) ----------
   Solo nombre con inicial, modalidad, lugar y celular. Nunca el comentario ni datos clínicos. */
const addCalButton = (a) => `<button class="btn btn-cal" type="button" data-addcal="${esc(a.id)}">${CAL_ICON}Agregar a mi calendario</button>`;

function shortName(full) {
  const w = String(full).trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[1].charAt(0).toUpperCase()}.` : w[0];
}

function eventInfo(a) {
  return {
    title: `${shortName(a.patient_name)} · ${a.mode === 'domicilio' ? 'A domicilio' : 'Virtual'}`,
    where: a.mode === 'domicilio' ? `A domicilio${a.district ? `, ${a.district}` : ''}, Lima` : 'Videollamada',
    notes: `Cita de Sentirse Bien\nCelular: ${phoneLabel(a.phone)}`,
    start: new Date(a.starts_at),
    end: new Date(a.ends_at), // ya viene con la duración de la sesión
  };
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261027T140000Z

function googleLink(a) {
  const e = eventInfo(a);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${utcStamp(e.start)}/${utcStamp(e.end)}`, details: e.notes, location: e.where, ctz: 'America/Lima' });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// Archivo .ics con dos avisos: 1 día antes y 1 hora antes
function icsText(a) {
  const e = eventInfo(a);
  const x = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const alarm = (trigger) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${x(e.title)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sentirse Bien//Panel//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${a.id}@sentirse-bien`, `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`,
    `SUMMARY:${x(e.title)}`, `LOCATION:${x(e.where)}`, `DESCRIPTION:${x(e.notes)}`,
    ...alarm('-P1D'), ...alarm('-PT1H'),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

function downloadIcs(a) {
  const url = URL.createObjectURL(new Blob([icsText(a)], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `cita-${limaDay(a.starts_at)}.ics` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function addToCalendar(a) {
  const e = eventInfo(a);
  dlg.innerHTML = `<div class="dlg-in">
    <h2 id="dlg-t">Agregar a mi calendario</h2>
    <div class="dlg-body">
      <p><b>${esc(e.title)}</b><br>${esc(cap(shortLabel(a.starts_at)))} a ${esc(limaTime(a.ends_at))}</p>
      <p class="hint">Solo va el nombre con inicial, la modalidad y el celular. Nunca el comentario del paciente.</p>
    </div>
    <div class="dlg-acts">
      <a class="btn btn-main" href="${esc(googleLink(a))}" target="_blank" rel="noopener" data-google>Abrir en Google Calendar</a>
      <button class="btn btn-soft" type="button" data-ics>Descargar para el celular (.ics)</button>
      <p class="hint">El archivo trae dos avisos: 1 día antes y 1 hora antes. Al abrirlo en el celular, se guarda en tu calendario. Google Calendar usa tus avisos de siempre.</p>
      <button class="btn btn-link" type="button" data-close>Cerrar</button>
    </div>
  </div>`;
  dlg.showModal();
  dlg.querySelector('[data-google]').addEventListener('click', () => { dlg.close(); toast('Se abrió Google Calendar: revisa los datos y pulsa «Guardar».'); });
  dlg.querySelector('[data-ics]').addEventListener('click', () => { downloadIcs(a); dlg.close(); toast('Archivo descargado. Ábrelo para guardarlo en tu calendario.'); });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
}

/* ====================== Horarios ====================== */
// Borrador por día de la semana: { on, ranges: [{ start, end, modes }] }. Un día apagado guarda sus
// rangos con active = false, así al volver a encenderlo recupera sus horas.
function rulesToDays(rules) {
  const days = {};
  for (const [n] of WEEK) {
    const rs = rules.filter((r) => r.weekday === n);
    const on = rs.some((r) => r.active !== false);
    days[n] = { on, ranges: rs.filter((r) => !on || r.active !== false).map((r) => ({ start: hhmm(r.start_time), end: hhmm(r.end_time), modes: [...r.modes] })).sort((a, b) => a.start.localeCompare(b.start)) };
  }
  return days;
}
const daysToRules = () => WEEK.flatMap(([n]) => S.days[n].ranges.map((r) => ({ weekday: n, start_time: r.start, end_time: r.end, modes: r.modes, active: S.days[n].on })));

const TIMES = Array.from({ length: 35 }, (_, i) => toHM(360 + i * 30)); // 6:00 am a 11:00 pm, cada 30 min
// "09:00","13:00" → "9 am–1 pm"; "19:00","21:00" → "7–9 pm"
function rangeShort(a, b) {
  const part = (hm) => { const [h, m] = hm.split(':').map(Number); return { t: `${h % 12 || 12}${m ? `:${pad(m)}` : ''}`, ap: h < 12 ? 'am' : 'pm' }; };
  const x = part(a), y = part(b);
  return x.ap === y.ap ? `${x.t}–${y.t} ${y.ap}` : `${x.t} ${x.ap}–${y.t} ${y.ap}`;
}
const timeOptions = (sel) => [...new Set([...TIMES, sel])].sort().map((t) => `<option value="${t}" ${t === sel ? 'selected' : ''}>${hmLabel(t)}</option>`).join('');

function slotLen() {
  const m = S.settings.slot_minutes;
  return m % 60 === 0 ? `${m / 60} hora${m > 60 ? 's' : ''}` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutos`;
}

function dayProblem(n) {
  const d = S.days[n], name = DAY_NAME[n];
  if (d.on && !d.ranges.length) return `${name}: agrega un horario o marca «No atiendo».`;
  for (const r of d.ranges) {
    if (r.end <= r.start) return `${name}: la hora «Hasta» debe ser después de «Desde».`;
    if (!r.modes.length) return `${name}: elige Virtual, A domicilio o ambas.`;
  }
  const rs = [...d.ranges].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < rs.length; i++) if (rs[i].start < rs[i - 1].end) return `${name}: hay dos horarios que se cruzan.`;
  return '';
}

function rangeRow(n, r, i) {
  const label = `${DAY_NAME[n]}, horario ${i + 1}`;
  return `<div class="rg" data-d="${n}" data-i="${i}" role="group" aria-label="${label}">
    <div class="rg-times">
      <label>Desde<select data-f="start">${timeOptions(r.start)}</select></label>
      <label>Hasta<select data-f="end">${timeOptions(r.end)}</select></label>
    </div>
    <div class="rg-modes" role="group" aria-label="Modalidad">
      <button type="button" class="mchip" data-m="virtual" aria-pressed="${r.modes.includes('virtual')}">Virtual</button>
      <button type="button" class="mchip" data-m="domicilio" aria-pressed="${r.modes.includes('domicilio')}">A domicilio</button>
    </div>
    <button type="button" class="rg-del" data-del aria-label="Quitar ${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg>Quitar</button>
  </div>`;
}

function dayBlock([n, name]) {
  const d = S.days[n];
  const problem = dayProblem(n);
  return `<section class="day ${d.on ? 'is-on' : ''}" aria-labelledby="day-${n}">
    <div class="day-head">
      <h2 id="day-${n}">${name}</h2>
      <button type="button" class="switch" role="switch" aria-checked="${d.on}" data-toggle="${n}" aria-label="Atiendo los ${name.toLowerCase()}">
        <span class="switch-t">${d.on ? 'Atiendo' : 'No atiendo'}</span><span class="switch-k" aria-hidden="true"></span>
      </button>
    </div>
    ${d.on ? `
      ${d.ranges.map((r, i) => rangeRow(n, r, i)).join('')}
      ${problem ? `<p class="msg-bad">${esc(problem)}</p>` : ''}
      <div class="day-add">
        <span class="day-add-t">Agregar:</span>
        ${PRESETS.map(([t, a, b]) => `<button type="button" class="chip-add" data-preset="${n}" data-a="${a}" data-b="${b}">+ ${t} <small>${rangeShort(a, b)}</small></button>`).join('')}
        <button type="button" class="chip-add" data-preset="${n}" data-a="" data-b="">+ Otro</button>
      </div>
      ${d.ranges.length ? `<button type="button" class="btn-link" data-copy="${n}">Copiar el ${name.toLowerCase()} a otros días</button>` : ''}
    ` : '<p class="day-off">Este día no aparece para reservar.</p>'}
  </section>`;
}

// "Así verán tus pacientes tus horarios": próximos 7 días con el borrador actual (aunque no esté guardado).
function previewDays() {
  const s = S.settings, len = s.slot_minutes;
  const earliest = Date.now() + s.min_notice_hours * 3600e3;
  const today = todayLima();
  const out = [];
  for (let k = 0; k < Math.min(7, s.horizon_days + 1); k++) {
    const d = addDays(today, k);
    const dow = new Date(`${d}T12:00:00-05:00`).getUTCDay();
    const day = S.days[dow];
    const off = S.off.some((o) => d >= o.date_from && d <= o.date_to);
    const items = new Map();
    if (day.on && !off) {
      for (const r of day.ranges) {
        if (!r.modes.length || r.end <= r.start) continue;
        for (let m = toMin(r.start); m + len <= toMin(r.end); m += len) {
          const start = new Date(`${d}T${toHM(m)}:00-05:00`).getTime();
          if (start < earliest) continue;
          if (S.apps.some((a) => isActive(a) && new Date(a.starts_at).getTime() < start + len * 60000 && new Date(a.ends_at).getTime() > start)) continue;
          const prev = items.get(toHM(m)) || [];
          items.set(toHM(m), [...new Set([...prev, ...r.modes])]);
        }
      }
    }
    out.push({ d, on: day.on, off, items: [...items.entries()].sort(([a], [b]) => a.localeCompare(b)) });
  }
  return out;
}

function previewHTML() {
  if (!S.settings.accepting_bookings) return '<p class="msg-bad">Tus reservas están en pausa (Ajustes): ahora nadie ve horarios en la página.</p>';
  return `<ul class="pv">${previewDays().map(({ d, on, off, items }) => {
    const p = dayParts(d);
    const label = d === todayLima() ? 'Hoy' : d === addDays(todayLima(), 1) ? 'Mañana' : `${p.weekday} ${p.short}`;
    const body = off ? '<span class="pv-none">Día libre</span>' : !on ? '<span class="pv-none">No atiendes</span>'
      : !items.length ? '<span class="pv-none">Sin horas libres</span>'
        : items.map(([t, m]) => `<span class="pv-chip">${hmLabel(t)}${m.length === 1 ? `<small>${m[0] === 'virtual' ? 'solo virtual' : 'solo a domicilio'}</small>` : ''}</span>`).join('');
    return `<li><span class="pv-day">${esc(label)}</span><span class="pv-items">${body}</span></li>`;
  }).join('')}</ul>`;
}

function viewHorarios() {
  return `<h1 class="h1" tabindex="-1">Tus horarios</h1>
    <p class="lead">Enciende los días que atiendes y elige desde qué hora hasta qué hora. Cada sesión dura ${slotLen()} (lo cambias en Ajustes). Hora de Lima.</p>
    <div class="days">${WEEK.map(dayBlock).join('')}</div>
    <section class="card preview" aria-labelledby="pv-t">
      <h2 id="pv-t">Así verán tus pacientes tus horarios</h2>
      <p class="hint" id="pv-note">${S.dirty ? 'Incluye tus cambios aunque todavía no los guardes.' : 'Próximos 7 días, sin las horas que ya están tomadas.'}</p>
      <div id="pv">${previewHTML()}</div>
    </section>
    <div class="savebar ${S.dirty ? 'is-dirty' : ''}" id="savebar">
      <p>${S.dirty ? 'Tienes cambios sin guardar.' : 'Todo guardado.'}</p>
      <button type="button" class="btn btn-main" id="save-rules" ${S.dirty ? '' : 'disabled'}>Guardar horarios</button>
    </div>`;
}

function touched(full = true) {
  S.dirty = true;
  if (full) { const y = scrollY; renderView(false); scrollTo({ top: y }); return; }
  document.getElementById('pv').innerHTML = previewHTML();
  document.getElementById('pv-note').textContent = 'Incluye tus cambios aunque todavía no los guardes.';
  const bar = document.getElementById('savebar');
  bar.classList.add('is-dirty');
  bar.querySelector('p').textContent = 'Tienes cambios sin guardar.';
  bar.querySelector('button').disabled = false;
}

function bindHorarios() {
  const refocus = (sel) => root.querySelector(sel)?.focus();
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.toggle), d = S.days[n];
    d.on = !d.on;
    if (d.on && !d.ranges.length) d.ranges.push({ start: '09:00', end: '13:00', modes: ['virtual', 'domicilio'] });
    touched(); refocus(`[data-toggle="${n}"]`);
  }));
  root.querySelectorAll('.rg').forEach((el) => {
    const r = S.days[el.dataset.d].ranges[el.dataset.i];
    el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
      r[s.dataset.f] = s.value;
      // Si deja "Hasta" antes que "Desde", corre "Hasta" una hora para no dejar un rango vacío
      if (s.dataset.f === 'start' && r.end <= r.start) r.end = toHM(Math.min(toMin(r.start) + 60, 23 * 60));
      touched(); refocus(`.rg[data-d="${el.dataset.d}"][data-i="${el.dataset.i}"] [data-f="${s.dataset.f}"]`);
    }));
    el.querySelectorAll('[data-m]').forEach((c) => c.addEventListener('click', () => {
      const m = c.dataset.m;
      r.modes = r.modes.includes(m) ? r.modes.filter((x) => x !== m) : [...r.modes, m];
      touched(); refocus(`.rg[data-d="${el.dataset.d}"][data-i="${el.dataset.i}"] [data-m="${m}"]`);
    }));
    el.querySelector('[data-del]').addEventListener('click', () => {
      S.days[el.dataset.d].ranges.splice(Number(el.dataset.i), 1);
      touched(); refocus(`[data-toggle="${el.dataset.d}"]`);
    });
  });
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.preset), d = S.days[n];
    let { a, b: z } = b.dataset;
    if (!a) { // "Otro": la siguiente hora libre después del último rango
      const last = d.ranges.reduce((m, r) => Math.max(m, toMin(r.end)), 8 * 60);
      a = toHM(Math.min(last, 21 * 60)); z = toHM(Math.min(last + 120, 23 * 60));
    }
    if (d.ranges.some((r) => a < r.end && z > r.start)) { toast(`Ese horario se cruza con otro del ${DAY_NAME[n].toLowerCase()}.`); return; }
    d.ranges.push({ start: a, end: z, modes: ['virtual', 'domicilio'] });
    d.ranges.sort((x, y) => x.start.localeCompare(y.start));
    touched(); refocus(`[data-preset="${n}"]`);
  }));
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const n = Number(b.dataset.copy);
    const others = WEEK.filter(([k]) => k !== n);
    const ok = await ask({
      title: `Copiar el ${DAY_NAME[n].toLowerCase()} a…`,
      body: `<p>Los días que marques tendrán los mismos horarios. Lo que tenían antes se reemplaza.</p>
        <div class="dlg-days">${others.map(([k, name]) => `<label class="daychk"><input type="checkbox" name="d" value="${k}" ${k >= 1 && k <= 5 && n >= 1 && n <= 5 ? 'checked' : ''}><span>${name}</span></label>`).join('')}</div>`,
      ok: 'Copiar', cancel: 'Cancelar',
    });
    if (!ok) return;
    const picked = [...dlg.querySelectorAll('input[name=d]:checked')].map((i) => Number(i.value));
    if (!picked.length) { toast('No marcaste ningún día.'); return; }
    for (const k of picked) S.days[k] = { on: true, ranges: S.days[n].ranges.map((r) => ({ ...r, modes: [...r.modes] })) };
    touched();
    toast(`Copiado a: ${picked.map((k) => DAY_NAME[k].toLowerCase()).join(', ')}. Falta guardar.`);
  }));
  document.getElementById('save-rules').addEventListener('click', async (e) => {
    const problem = WEEK.map(([n]) => dayProblem(n)).find(Boolean);
    if (problem) { toast(problem); return; }
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Guardando…';
    try {
      await S.api.saveRules(daysToRules());
      S.days = rulesToDays(await S.api.getRules());
      S.dirty = false;
      renderView(false);
      toast('Horarios guardados. Ya se ven en la página de reservas.');
    } catch (err) { fail(err); renderView(false); }
  });
}

addEventListener('beforeunload', (e) => { if (S.dirty) e.preventDefault(); });

/* ====================== Días libres ====================== */
function offLabel(o) {
  const a = dayParts(o.date_from), b = dayParts(o.date_to);
  return o.date_from === o.date_to ? `${a.weekday} ${a.short}` : `Del ${a.weekday} ${a.short} al ${b.weekday} ${b.short}`;
}
const isOff = (d) => S.off.some((o) => d >= o.date_from && d <= o.date_to);
const appsBetween = (from, to) => S.apps.filter((a) => isActive(a) && limaDay(a.starts_at) >= from && limaDay(a.starts_at) <= to);

function viewLibres() {
  const t = todayLima(), m = addDays(t, 1);
  const upcoming = S.off.filter((o) => o.date_to >= t);
  const quick = (d, label, k) => {
    const p = dayParts(d);
    return isOff(d)
      ? `<div class="quick is-done"><b>${label}</b><span>${p.weekday} ${p.short}: ya está libre</span></div>`
      : `<button type="button" class="quick" data-quick="${k}"><b>No atiendo ${label.toLowerCase()}</b><span>${p.weekday} ${p.short}</span></button>`;
  };
  return `<h1 class="h1" tabindex="-1">Días libres</h1>
    <p class="lead">En estos días nadie podrá reservar. Si ya tenías citas, no se cancelan solas: te avisamos para que las revises.</p>
    <div class="quicks">${quick(t, 'Hoy', 0)}${quick(m, 'Mañana', 1)}</div>
    <form class="card off-form" id="off-form" novalidate>
      <h2>Varios días (viaje, vacaciones)</h2>
      <div class="two">
        <div class="field"><label for="o-from">Desde</label><input id="o-from" type="date" min="${t}" required></div>
        <div class="field"><label for="o-to">Hasta</label><input id="o-to" type="date" min="${t}"></div>
      </div>
      <div class="field"><label for="o-note">Motivo (opcional, solo lo ves tú)</label><input id="o-note" type="text" maxlength="80" placeholder="Ej.: viaje, feriado"></div>
      <button class="btn btn-main btn-wide" type="submit">Guardar días libres</button>
    </form>
    <h2 class="h2">Próximos días libres</h2>
    ${upcoming.length ? `<ul class="offs">${upcoming.map((o) => `<li><div><b>${esc(offLabel(o))}</b>${o.note ? `<span>${esc(o.note)}</span>` : ''}</div><button type="button" class="btn btn-soft" data-del-off="${esc(o.id)}" aria-label="Quitar ${esc(offLabel(o))}">Quitar</button></li>`).join('')}</ul>`
      : '<div class="empty"><p class="empty-t">No tienes días libres marcados.</p><p>Usa los botones de arriba cuando no vayas a atender.</p></div>'}`;
}

async function addOff(from, to, note) {
  const clash = appsBetween(from, to);
  try {
    await S.api.addTimeOff({ date_from: from, date_to: to, note: note || null });
    S.off = await S.api.listTimeOff();
    renderView(false);
    const range = from === to ? 'ese día' : 'esos días';
    toast(clash.length
      ? `Listo, ${range} nadie podrá reservar. Ojo: ya tienes ${clash.length} cita${clash.length > 1 ? 's' : ''} ${range}; revísala${clash.length > 1 ? 's' : ''} en Citas.`
      : `Listo, ${range} nadie podrá reservar.`);
  } catch (e) { fail(e); }
}

function bindLibres() {
  root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    const d = addDays(todayLima(), Number(b.dataset.quick));
    b.disabled = true;
    addOff(d, d, '');
  }));
  document.getElementById('off-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = document.getElementById('o-from').value;
    const to = document.getElementById('o-to').value || from;
    if (!from) { toast('Elige desde qué día.'); return; }
    if (to < from) { toast('El día «Hasta» no puede ser antes que «Desde».'); return; }
    addOff(from, to, document.getElementById('o-note').value.trim());
  });
  root.querySelectorAll('[data-del-off]').forEach((b) => b.addEventListener('click', async () => {
    try { await S.api.deleteTimeOff(b.dataset.delOff); S.off = await S.api.listTimeOff(); renderView(false); toast('Día libre quitado: ya se puede reservar.'); } catch (e) { fail(e); }
  }));
}

/* ====================== Ajustes ====================== */
const SLOT_OPTS = [[30, '30 minutos'], [45, '45 minutos'], [50, '50 minutos'], [60, '1 hora'], [90, '1 hora y media'], [120, '2 horas']];
const NOTICE_OPTS = [[0, 'Sin aviso (pueden reservar para dentro de un rato)'], [2, '2 horas antes'], [6, '6 horas antes'], [12, '12 horas antes'], [24, '1 día antes'], [48, '2 días antes']];
const HORIZON_OPTS = [[7, '1 semana'], [14, '2 semanas'], [21, '3 semanas'], [30, '1 mes'], [60, '2 meses']];
const opts = (list, v, unit) => [...list, ...(list.some(([k]) => k === v) ? [] : [[v, `${v} ${unit}`]])].sort((a, b) => a[0] - b[0])
  .map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('');

let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S.view === 'ajustes') renderView(false); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function viewAjustes() {
  const s = S.settings;
  return `<h1 class="h1" tabindex="-1">Ajustes</h1>
    <section class="card pause ${s.accepting_bookings ? '' : 'is-paused'}">
      <div><h2>Recibir reservas en la página</h2>
      <p>${s.accepting_bookings ? 'Las personas pueden reservar en línea.' : 'Reservas en pausa: la página invita a escribirte por WhatsApp.'}</p></div>
      <button type="button" class="switch switch-big" role="switch" aria-checked="${s.accepting_bookings}" id="s-acc" aria-label="Recibir reservas en la página">
        <span class="switch-t">${s.accepting_bookings ? 'Activas' : 'En pausa'}</span><span class="switch-k" aria-hidden="true"></span></button>
    </section>
    <section class="card sets">
      <div class="field"><label for="s-slot">Duración de cada sesión</label><select id="s-slot" data-k="slot_minutes">${opts(SLOT_OPTS, s.slot_minutes, 'minutos')}</select></div>
      <div class="field"><label for="s-notice">Aviso mínimo antes de una cita</label><select id="s-notice" data-k="min_notice_hours">${opts(NOTICE_OPTS, s.min_notice_hours, 'horas antes')}</select>
        <p class="hint">Para que nadie reserve a última hora.</p></div>
      <div class="field"><label for="s-hor">Hasta cuántos días adelante se puede reservar</label><select id="s-hor" data-k="horizon_days">${opts(HORIZON_OPTS, s.horizon_days, 'días')}</select></div>
      <p class="hint">Los cambios se guardan solos.</p>
    </section>
    ${standalone() ? '' : `<section class="card">
      <h2>Tener el panel en tu celular</h2>
      ${installEvt ? '<p>Agrega un ícono en tu pantalla de inicio para abrir el panel con un toque.</p><button type="button" class="btn btn-main" id="install">Instalar el panel</button>'
        : isIOS() ? '<p>En Safari, toca el botón <b>Compartir</b> (el cuadrado con la flecha) y luego <b>«Agregar a inicio»</b>.</p>'
          : '<p>En Chrome, abre el menú (los tres puntos) y toca <b>«Instalar app»</b> o <b>«Agregar a la pantalla principal»</b>.</p>'}
    </section>`}
    <section class="card">
      <h2>Tu cuenta</h2>
      <p class="muted">${esc(S.user?.email || '')}</p>
      <button type="button" class="btn btn-soft" id="logout">Cerrar sesión</button>
    </section>`;
}

function bindAjustes() {
  const save = async (patch, okText) => {
    try { await S.api.saveSettings(patch); S.settings = await S.api.getSettingsAdmin(); renderView(false); toast(okText); } catch (e) { fail(e); renderView(false); }
  };
  document.getElementById('s-acc').addEventListener('click', () => {
    const on = !S.settings.accepting_bookings;
    save({ accepting_bookings: on }, on ? 'Listo: ya se puede reservar en la página.' : 'Reservas en pausa. Nadie puede reservar hasta que las actives otra vez.');
  });
  root.querySelectorAll('.sets select').forEach((sel) => sel.addEventListener('change', () => {
    const label = sel.options[sel.selectedIndex].text.replace(/ \(.*\)$/, '').toLowerCase();
    const lead = { slot_minutes: 'Cada sesión dura', min_notice_hours: 'Aviso mínimo:', horizon_days: 'Se puede reservar hasta' }[sel.dataset.k];
    save({ [sel.dataset.k]: Number(sel.value) }, `Guardado. ${lead} ${label}.`);
  }));
  document.getElementById('install')?.addEventListener('click', async () => {
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    renderView(false);
  });
  document.getElementById('logout').addEventListener('click', async () => {
    const ok = await ask({ title: '¿Cerrar sesión?', body: '<p>Para volver a entrar necesitarás tu correo y contraseña.</p>', ok: 'Cerrar sesión', cancel: 'Seguir aquí' });
    if (!ok) return;
    await S.api.signOut();
    S.user = null;
    viewLogin();
  });
}
