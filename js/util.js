import { CONFIG } from './config.js';

const TZ = CONFIG.TIMEZONE;

/** Escapa texto antes de ponerlo dentro de innerHTML (nombres, notas, etc.). */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const weekdayFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'long' });
const shortFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

/** "2026-10-25" en hora de Lima a partir de un instante (ISO o Date). */
export const limaDay = (iso) => dayFmt.format(new Date(iso));
/** "9:00 am" en hora de Lima. */
export const limaTime = (iso) => timeFmt.format(new Date(iso)).replace(/\s*([AP])M$/, (_, x) => ` ${x.toLowerCase()}m`);

/** "15:30" (como se guarda en la base) → "3:30 pm" */
export function hmLabel(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
export const todayLima = () => limaDay(new Date());

/** Suma días a una fecha "YYYY-MM-DD" (Lima no tiene horario de verano). */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return limaDay(d);
}

export function dayParts(ymd) {
  const d = new Date(`${ymd}T12:00:00-05:00`);
  return { weekday: weekdayFmt.format(d), short: shortFmt.format(d).replace('.', '') };
}

/** "sábado 25 de octubre, 10:00 am" */
export const longLabel = (iso) => `${longFmt.format(new Date(iso))}, ${limaTime(iso)}`;

/** "martes, 27 de octubre" a partir de "2026-10-27" */
export const dayLong = (ymd) => longFmt.format(new Date(`${ymd}T12:00:00-05:00`));

const monthFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, month: 'long', year: 'numeric' });
/** "octubre 2026" a partir de "2026-10" */
export const monthLabel = (ym) => monthFmt.format(new Date(`${ym}-15T12:00:00-05:00`)).replace(' de ', ' ');

/** "sábado 1 nov, 9:00 am" (para el panel) */
export function shortLabel(iso) {
  const d = new Date(iso);
  return `${weekdayFmt.format(d)} ${shortFmt.format(d).replace('.', '')}, ${limaTime(iso)}`;
}

/** Deja solo los 9 dígitos de un celular peruano; devuelve '' si no es válido. */
export function normPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (/^51\d{9}$/.test(d)) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? d : '';
}

export const waLink = (text, number = CONFIG.WHATSAPP) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export const WHO_LABEL = { nino: 'Niño o niña', adolescente: 'Adolescente', adulto: 'Adulto', familia: 'Familia' };
export const MODE_LABEL = { virtual: 'Virtual', domicilio: 'A domicilio' };
