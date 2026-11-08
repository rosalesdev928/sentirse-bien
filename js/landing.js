// Landing: tarjeta de reserva (4 pasos), enlaces de WhatsApp/correo y video del inicio.
import { CONFIG } from './config.js';
import { getApi } from './api.js';
import { esc, limaDay, limaTime, todayLima, addDays, dayParts, longLabel, normPhone, waLink, WHO_LABEL, MODE_LABEL } from './util.js';

const root = document.getElementById('reservar');
const title = document.getElementById('hero-title');
const DEFAULT_TITLE = title ? title.textContent : '';

// El titular se adapta a quién viene a consulta (se vuelve al original al reiniciar).
const HERO_BY_WHO = {
  nino: 'Psicoterapia para niños y niñas, acompañando a sus familias',
  adolescente: 'Psicoterapia para adolescentes, con espacio para ser escuchados',
  adulto: 'Psicoterapia para adultos, con calma y sin apuro',
  familia: 'Psicoterapia para adolescentes, niños y sus familias',
};

const ERRORS = {
  slot_no_disponible: 'Ese horario acaba de ser tomado. Elige otro, por favor.',
  telefono_invalido: 'Revisa el celular: debe tener 9 dígitos y empezar con 9.',
  nombre_invalido: 'Escribe el nombre completo de quien recibirá la terapia.',
  distrito_requerido: 'Indica el distrito donde sería la atención a domicilio.',
  demasiadas_solicitudes: 'Ya tienes varias solicitudes pendientes con este celular. Escríbenos por WhatsApp y lo coordinamos.',
  sistema_ocupado: 'En este momento hay muchas solicitudes. Escríbenos por WhatsApp y lo coordinamos.',
  reservas_cerradas: 'Por ahora no estamos recibiendo reservas en línea. Escríbenos por WhatsApp.',
  no_autorizado: 'No tienes permiso para esto.',
  error: 'No pudimos completar la solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.',
};

const state = { step: 1, who: null, mode: null, slots: [], byDay: {}, day: null, slot: null, error: '', busy: false, loadError: false, done: null, form: {} };
let api = null;
let settings = null;

/* ---------- Enlaces de contacto ---------- */
function wireContacts() {
  document.querySelectorAll('[data-wa]').forEach((a) => {
    a.href = waLink(a.dataset.waText || 'Hola, quisiera información.');
    a.target = '_blank';
    a.rel = 'noopener';
    if (a.hasAttribute('data-wa-label')) {
      const n = CONFIG.WHATSAPP.replace(/^51/, '');
      a.textContent = `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
    }
  });
  document.querySelectorAll('[data-mail]').forEach((a) => { a.href = `mailto:${CONFIG.EMAIL}`; a.textContent = CONFIG.EMAIL; });
}

/* ---------- Video del inicio ----------
   Solo se carga si hay archivo (data-src), la pantalla es ancha, no se pidió ahorrar datos
   y no está activado "reducir movimiento". Si no, queda la imagen de portada. */
function wireHeroVideo() {
  const v = document.querySelector('.hero-video');
  const src = v?.dataset.src;
  if (!src) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia('(min-width: 768px)');
  if (calm.matches || !wide.matches || navigator.connection?.saveData) return;
  const s = document.createElement('source');
  s.src = src;
  s.type = 'video/mp4';
  v.appendChild(s);
  v.load();
  v.play().catch(() => { /* el navegador bloqueó el autoplay: queda la portada */ });
  calm.addEventListener('change', (e) => { if (e.matches) v.pause(); });
}

/* ---------- Tarjeta de reserva ---------- */
const STEPS = 4;
const header = (n) => `
  <p class="step-label">Paso ${n} de ${STEPS}</p>
  <div class="bar-track" aria-hidden="true"><div class="bar" style="width:${(n / STEPS) * 100}%"></div></div>`;

function crumbs() {
  const items = [];
  if (state.who) items.push(['who', WHO_LABEL[state.who]]);
  if (state.mode) items.push(['mode', MODE_LABEL[state.mode]]);
  if (state.slot) items.push(['slot', longLabel(state.slot)]);
  if (!items.length) return '';
  return `<div class="crumbs">${items.map(([k, t]) => `<button class="crumb" type="button" data-back="${k}" aria-label="Cambiar: ${esc(t)}">${esc(t)} ✎</button>`).join('')}</div>`;
}

function render(focus = true) {
  if (!root) return;
  let html = '';
  if (state.done) html = viewDone();
  else if (settings && !settings.accepting_bookings) html = viewClosed();
  else if (state.step === 1) html = viewWho();
  else if (state.step === 2) html = viewMode();
  else if (state.step === 3) html = viewSlots();
  else html = viewForm();
  root.innerHTML = `<div class="stepin">${html}</div>`;
  if (title) title.textContent = state.who && !state.done ? HERO_BY_WHO[state.who] : DEFAULT_TITLE;
  if (focus) root.querySelector('.step-title')?.focus({ preventScroll: true });
  bind();
}

function viewClosed() {
  return `<h2 class="step-title" tabindex="-1">Reservas en pausa</h2>
    <p class="muted" style="margin-top:12px">Por ahora no recibimos reservas en línea. Escríbenos y coordinamos tu cita.</p>
    <a class="wa-btn" href="${waLink('Hola, quisiera coordinar una cita en Sentirse Bien.')}" target="_blank" rel="noopener">Escribir por WhatsApp</a>`;
}

function viewWho() {
  return `${header(1)}
    <h2 class="step-title" tabindex="-1">¿Para quién es la cita?</h2>
    <div class="opts">${Object.entries(WHO_LABEL).map(([k, t]) => `<button class="opt" type="button" data-who="${k}">${esc(t)}</button>`).join('')}</div>
    <p class="hint">Sin compromiso: primero coordinamos por WhatsApp.</p>`;
}

function viewMode() {
  return `${header(2)}${crumbs()}
    <h2 class="step-title" tabindex="-1">¿Cómo prefieres la sesión?</h2>
    <div class="opts">
      <button class="mode" type="button" data-mode="virtual"><strong>Virtual</strong><span>Por videollamada, desde donde estés.</span></button>
      <button class="mode" type="button" data-mode="domicilio"><strong>A domicilio</strong><span>Voy a tu casa, en cualquier distrito de Lima.</span></button>
    </div>`;
}

function viewSlots() {
  const days = Object.keys(state.byDay).sort();
  let body;
  if (state.busy) body = '<p class="muted" style="margin-top:16px" role="status">Buscando horarios…</p>';
  else if (state.loadError) body = `<p class="error" role="alert">${esc(ERRORS.error)}</p>`;
  else if (!days.length) {
    body = `<p class="muted" style="margin-top:16px">Todavía no hay horarios publicados para esta modalidad. Escríbenos y buscamos uno juntos.</p>
      <a class="wa-btn" href="${waLink(`Hola, quisiera una cita ${MODE_LABEL[state.mode].toLowerCase()} para ${WHO_LABEL[state.who].toLowerCase()}.`)}" target="_blank" rel="noopener">Coordinar por WhatsApp</a>`;
  } else {
    const slots = state.byDay[state.day] || [];
    body = `<div class="days" role="group" aria-label="Día">${days.map((d) => {
      const p = dayParts(d);
      return `<button class="day" type="button" data-day="${d}" aria-pressed="${d === state.day}"><small>${esc(p.weekday)}</small><b>${esc(p.short)}</b></button>`;
    }).join('')}</div>
    <div class="slots" role="group" aria-label="Hora">${slots.length
      ? slots.map((s) => `<button class="slot" type="button" data-slot="${s}" aria-pressed="${s === state.slot}">${limaTime(s)}</button>`).join('')
      : '<p class="muted">Elige un día para ver las horas.</p>'}</div>
    <p class="hint">Horas en hora de Lima. Cada sesión dura ${settings?.slot_minutes || 60} minutos.</p>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
    <button class="btn-main" type="button" data-next ${state.slot ? '' : 'disabled'}>Continuar</button>`;
  }
  return `${header(3)}${crumbs()}<h2 class="step-title" tabindex="-1">Elige día y hora</h2>${body}`;
}

function viewForm() {
  const f = state.form;
  const needsDistrict = state.mode === 'domicilio';
  const forOther = state.who !== 'adulto';
  return `${header(4)}${crumbs()}
    <h2 class="step-title" tabindex="-1">Tus datos de contacto</h2>
    <form class="form" novalidate>
      <div class="field"><label for="f-patient">${state.who === 'adulto' ? 'Tu nombre' : 'Nombre de quien recibirá la terapia'}</label>
        <input id="f-patient" name="patient_name" autocomplete="${state.who === 'adulto' ? 'name' : 'off'}" required maxlength="80" value="${esc(f.patient_name)}"></div>
      ${forOther ? `<div class="field"><label for="f-contact">Tu nombre (madre, padre o apoderado)</label>
        <input id="f-contact" name="contact_name" autocomplete="name" maxlength="80" value="${esc(f.contact_name)}"></div>` : ''}
      <div class="field"><label for="f-phone">Celular (WhatsApp)</label>
        <input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="9XX XXX XXX" maxlength="20" value="${esc(f.phone)}"></div>
      ${needsDistrict ? `<div class="field"><label for="f-district">Distrito</label>
        <input id="f-district" name="district" required maxlength="60" placeholder="Ej.: Surco, San Juan de Lurigancho…" value="${esc(f.district)}"></div>` : ''}
      <div class="field"><label for="f-notes">Algo que quieras contarnos (opcional)</label>
        <textarea id="f-notes" name="notes" maxlength="400">${esc(f.notes)}</textarea></div>
      <div class="hp" aria-hidden="true"><label>No llenar<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" name="consent" ${f.consent ? 'checked' : ''}><span>Acepto que usen estos datos solo para coordinar mi cita. No se comparten con terceros.</span></label>
      ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
      <button class="btn-main" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Enviando…' : 'Solicitar cita'}</button>
    </form>
    <p class="hint">La cita queda <b>pendiente</b> hasta que la confirmemos por WhatsApp.</p>`;
}

function viewDone() {
  const d = state.done;
  // Aviso opcional a Roxana: solo nombre, fecha y modalidad (nunca el comentario ni datos clínicos).
  const msg = [
    'Hola Roxana, acabo de solicitar una cita en Sentirse Bien.',
    `Paciente: ${d.patient}`,
    d.contact ? `Me contacto yo: ${d.contact}` : '',
    `Fecha: ${longLabel(d.start)}`,
    `Modalidad: ${MODE_LABEL[d.mode]}`,
  ].filter(Boolean).join('\n');
  return `<div class="ok-badge" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#2A1B3D" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h2 class="step-title" tabindex="-1">¡Solicitud enviada!</h2>
    <p class="summary">${esc(longLabel(d.start))} · ${esc(MODE_LABEL[d.mode])}</p>
    <p class="muted" style="margin-top:12px">Te escribiremos al ${esc(d.phone)} para confirmar.</p>
    <a class="wa-btn" href="${waLink(msg)}" target="_blank" rel="noopener">Avisar a Roxana por WhatsApp</a>
    <p class="hint">Es opcional: tu solicitud ya quedó registrada.</p>
    <button class="btn-ghost" type="button" data-reset>Reservar otra cita</button>`;
}

/* ---------- Eventos ---------- */
function bind() {
  root.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => { state.who = b.dataset.who; state.step = 2; render(); }));
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => chooseMode(b.dataset.mode)));
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { state.day = b.dataset.day; state.slot = null; state.error = ''; render(false); root.querySelector(`[data-day="${state.day}"]`)?.focus(); }));
  root.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => { state.slot = b.dataset.slot; state.error = ''; render(false); root.querySelector(`[data-slot="${state.slot}"]`)?.focus(); }));
  root.querySelector('[data-next]')?.addEventListener('click', () => { if (state.slot) { state.error = ''; state.step = 4; render(); } });
  root.querySelector('[data-reset]')?.addEventListener('click', reset);
  root.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.back;
    state.error = '';
    if (k === 'who') { state.step = 1; state.slot = null; }
    else if (k === 'mode') { state.step = 2; state.slot = null; }
    else { state.step = 3; state.slot = null; }
    render();
  }));
  const form = root.querySelector('form');
  if (form) {
    form.addEventListener('input', () => { state.form = readForm(form); });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(form); });
  }
}

function readForm(form) {
  const g = (n) => form.elements[n]?.value ?? '';
  return { patient_name: g('patient_name'), contact_name: g('contact_name'), phone: g('phone'), district: g('district'), notes: g('notes'), consent: form.elements.consent?.checked || false };
}

async function chooseMode(mode) {
  state.mode = mode; state.step = 3; state.slot = null; state.day = null; state.error = ''; state.loadError = false; state.busy = true;
  render();
  try {
    const from = todayLima();
    const to = addDays(from, settings?.horizon_days || 21);
    state.slots = await api.getSlots(from, to, mode);
    state.byDay = {};
    for (const s of state.slots) (state.byDay[limaDay(s)] ||= []).push(s);
    state.day = Object.keys(state.byDay).sort()[0] || null;
  } catch (e) {
    state.loadError = true;
  }
  state.busy = false;
  render(false);
  root.querySelector('.step-title')?.focus({ preventScroll: true });
}

async function submit(form) {
  const data = readForm(form);
  state.form = data;
  if (form.elements.website.value) return; // trampa para bots
  const phone = normPhone(data.phone);
  if (data.patient_name.trim().length < 2) return fail(ERRORS.nombre_invalido, 'patient_name');
  if (!phone) return fail(ERRORS.telefono_invalido, 'phone');
  if (state.mode === 'domicilio' && !data.district.trim()) return fail(ERRORS.distrito_requerido, 'district');
  if (!data.consent) return fail('Marca la casilla para poder enviar la solicitud.', 'consent');

  state.busy = true; state.error = ''; render(false);
  try {
    await api.createAppointment({
      start: state.slot, mode: state.mode, who: state.who, patient_name: data.patient_name.trim(),
      contact_name: data.contact_name.trim(), phone, district: data.district.trim(), notes: data.notes.trim(),
    });
    state.done = { start: state.slot, mode: state.mode, patient: data.patient_name.trim(), contact: data.contact_name.trim(), phone };
    state.busy = false;
    render();
  } catch (e) {
    state.busy = false;
    if (e.code === 'slot_no_disponible') {
      state.error = ERRORS.slot_no_disponible; state.slot = null; state.step = 3;
      await chooseMode(state.mode); // refresca los horarios
      state.error = ERRORS.slot_no_disponible; render(false);
      return;
    }
    state.error = ERRORS[e.code] || ERRORS.error;
    render(false);
    root.querySelector('.error')?.scrollIntoView({ block: 'nearest' });
  }
}

function fail(message, field) {
  state.error = message; render(false);
  const el = root.querySelector(`[name="${field}"]`);
  el?.focus();
}

function reset() {
  Object.assign(state, { step: 1, who: null, mode: null, slots: [], byDay: {}, day: null, slot: null, error: '', busy: false, loadError: false, done: null, form: {} });
  render();
}

/* ---------- Inicio ---------- */
wireContacts();
wireHeroVideo();
if (root) {
  root.innerHTML = '<p class="muted" role="status">Cargando…</p>';
  getApi()
    .then(async (a) => { api = a; settings = await a.getSettings(); render(false); })
    .catch(() => {
      root.innerHTML = `<h2 class="step-title">Reserva por WhatsApp</h2>
        <p class="muted" style="margin-top:12px">Por ahora no podemos mostrar los horarios. Escríbenos y coordinamos tu cita.</p>
        <a class="wa-btn" href="${waLink('Hola, quisiera coordinar una cita en Sentirse Bien.')}" target="_blank" rel="noopener">Escribir por WhatsApp</a>`;
    });
}
