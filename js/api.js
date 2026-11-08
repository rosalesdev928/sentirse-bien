// Capa de datos. La página y el panel solo hablan con esto.
//  - Si config.js tiene SUPABASE_URL → usa Supabase (base de datos real).
//  - Si no → MODO DEMO con localStorage (misma interfaz, para probar sin base de datos).
import { CONFIG } from './config.js';
import { addDays, todayLima, limaDay } from './util.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const KNOWN = ['slot_no_disponible', 'slot_ocupado', 'telefono_invalido', 'nombre_invalido', 'distrito_requerido', 'demasiadas_solicitudes', 'sistema_ocupado', 'reservas_cerradas', 'modalidad_invalida', 'no_autorizado'];

function appError(message) {
  const code = KNOWN.find((k) => String(message || '').includes(k)) || 'error';
  const e = new Error(message || code);
  e.code = code;
  return e;
}

const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const pad = (n) => String(n).padStart(2, '0');

let cached;
export function getApi() {
  if (!cached) cached = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY ? supabaseBackend() : Promise.resolve(demoBackend());
  return cached;
}

/* ====================== SUPABASE ====================== */
async function supabaseBackend() {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const run = async (q) => { const { data, error } = await q; if (error) throw appError(error.message); return data; };

  return {
    isDemo: false,
    getSettings: () => run(sb.rpc('get_public_settings')),
    async getSlots(from, to, mode) {
      const rows = await run(sb.rpc('get_available_slots', { p_from: from, p_to: to, p_mode: mode }));
      return rows.map((r) => r.slot_start);
    },
    createAppointment: (p) => run(sb.rpc('create_appointment', {
      p_start: p.start, p_mode: p.mode, p_who: p.who, p_patient_name: p.patient_name,
      p_contact_name: p.contact_name || null, p_phone: p.phone, p_district: p.district || null, p_notes: p.notes || null,
    })),

    // ---- panel ----
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw appError(error.message);
      if (!(await run(sb.rpc('is_admin')))) { await sb.auth.signOut(); throw appError('no_autorizado'); }
    },
    signOut: () => sb.auth.signOut(),
    async getUser() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      return (await run(sb.rpc('is_admin'))) ? data.session.user : null;
    },
    getRules: () => run(sb.from('availability_rules').select('*').order('weekday').order('start_time')),
    async saveRules(rules) { await run(sb.rpc('admin_replace_availability', { p_rules: rules })); },
    getSettingsAdmin: () => run(sb.from('settings').select('*').eq('id', 1).single()),
    async saveSettings(patch) { await run(sb.from('settings').update(patch).eq('id', 1)); },
    listTimeOff: () => run(sb.from('time_off').select('*').order('date_from')),
    async addTimeOff(r) { await run(sb.from('time_off').insert(r)); },
    async deleteTimeOff(id) { await run(sb.from('time_off').delete().eq('id', id)); },
    listAppointments: () => run(sb.from('appointments').select('*').order('starts_at', { ascending: false }).limit(300)),
    async setStatus(id, status) {
      const { error } = await sb.from('appointments').update({ status }).eq('id', id);
      // 23505 = el índice único: esa hora ya la tiene otra cita activa
      if (error) throw appError(error.code === '23505' ? 'slot_ocupado' : error.message);
    },
  };
}

/* ====================== MODO DEMO ====================== */
function demoBackend() {
  const KEY = 'sentirse-bien-demo-v1';
  let memory = null;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  const seed = () => ({
    settings: { slot_minutes: 60, min_notice_hours: 12, horizon_days: 21, accepting_bookings: true },
    rules: [
      { id: uid(), weekday: 6, start_time: '09:00', end_time: '13:00', modes: ['virtual', 'domicilio'], active: true },
      { id: uid(), weekday: 6, start_time: '15:00', end_time: '19:00', modes: ['virtual', 'domicilio'], active: true },
      { id: uid(), weekday: 0, start_time: '09:00', end_time: '13:00', modes: ['virtual', 'domicilio'], active: true },
      { id: uid(), weekday: 3, start_time: '19:00', end_time: '21:00', modes: ['virtual'], active: true },
    ],
    time_off: [],
    appointments: [],
  });
  const load = () => {
    if (memory) return memory;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.rules) { memory = s; return s; } } catch { /* sin localStorage */ }
    memory = seed();
    return memory;
  };
  const save = (db) => { memory = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignorar */ } };
  const active = (a) => a.status === 'pendiente' || a.status === 'confirmada';

  function slots(db, from, to, mode) {
    const s = db.settings;
    if (!s.accepting_bookings) return [];
    if (mode !== 'virtual' && mode !== 'domicilio') throw appError('modalidad_invalida');
    const today = todayLima();
    const maxDay = addDays(today, s.horizon_days);
    const first = from > today ? from : today;
    const last = to < maxDay ? to : maxDay;
    const earliest = Date.now() + s.min_notice_hours * 3600e3;
    const out = new Set();
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (db.time_off.some((t) => d >= t.date_from && d <= t.date_to)) continue;
      const dow = new Date(`${d}T12:00:00-05:00`).getUTCDay();
      for (const r of db.rules) {
        if (!r.active || r.weekday !== dow || !r.modes.includes(mode)) continue;
        for (let m = toMin(r.start_time); m + s.slot_minutes <= toMin(r.end_time); m += s.slot_minutes) {
          const start = new Date(`${d}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00-05:00`);
          const end = new Date(start.getTime() + s.slot_minutes * 60000);
          if (start.getTime() < earliest) continue;
          if (db.appointments.some((a) => active(a) && new Date(a.starts_at) < end && new Date(a.ends_at) > start)) continue;
          out.add(start.toISOString());
        }
      }
    }
    return [...out].sort();
  }

  return {
    isDemo: true,
    async getSettings() { return load().settings; },
    async getSlots(from, to, mode) { return slots(load(), from, to, mode); },
    async createAppointment(p) {
      const db = load();
      const phone = String(p.phone || '').replace(/\D/g, '').replace(/^51(?=\d{9}$)/, '');
      if (!/^9\d{8}$/.test(phone)) throw appError('telefono_invalido');
      if (String(p.patient_name || '').trim().length < 2) throw appError('nombre_invalido');
      if (p.mode === 'domicilio' && !String(p.district || '').trim()) throw appError('distrito_requerido');
      const now = Date.now();
      if (db.appointments.filter((a) => a.phone === phone && a.status === 'pendiente' && new Date(a.starts_at) > now).length >= 3) throw appError('demasiadas_solicitudes');
      const since = (ms) => db.appointments.filter((a) => now - new Date(a.created_at) < ms).length;
      if (since(10 * 60e3) >= 5 || since(24 * 3600e3) >= 20) throw appError('sistema_ocupado');
      const day = limaDay(p.start);
      if (!slots(db, day, day, p.mode).some((x) => new Date(x).getTime() === new Date(p.start).getTime())) throw appError('slot_no_disponible');
      const start = new Date(p.start);
      const row = {
        id: uid(), starts_at: start.toISOString(), ends_at: new Date(start.getTime() + db.settings.slot_minutes * 60000).toISOString(),
        mode: p.mode, who: p.who, patient_name: p.patient_name.trim(), contact_name: (p.contact_name || '').trim() || null,
        phone, district: (p.district || '').trim() || null, notes: (p.notes || '').trim() || null,
        status: 'pendiente', created_at: new Date().toISOString(),
      };
      db.appointments.push(row);
      save(db);
      return row.id;
    },

    // ---- panel (en demo cualquier contraseña sirve) ----
    async signIn() { sessionStorage.setItem('sb-demo-admin', '1'); },
    async signOut() { sessionStorage.removeItem('sb-demo-admin'); },
    async getUser() { return sessionStorage.getItem('sb-demo-admin') ? { email: 'demo@sentirsebien.local' } : null; },
    async getRules() { return [...load().rules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)); },
    async saveRules(rules) { const db = load(); db.rules = rules.map((r) => ({ id: uid(), active: true, ...r })); save(db); },
    async getSettingsAdmin() { return { ...load().settings }; },
    async saveSettings(patch) { const db = load(); db.settings = { ...db.settings, ...patch }; save(db); },
    async listTimeOff() { return [...load().time_off].sort((a, b) => a.date_from.localeCompare(b.date_from)); },
    async addTimeOff(r) { const db = load(); db.time_off.push({ id: uid(), note: null, ...r }); save(db); },
    async deleteTimeOff(id) { const db = load(); db.time_off = db.time_off.filter((t) => t.id !== id); save(db); },
    async listAppointments() { return [...load().appointments].sort((a, b) => b.starts_at.localeCompare(a.starts_at)); },
    async setStatus(id, status) {
      const db = load();
      const a = db.appointments.find((x) => x.id === id);
      if (!a) return;
      if (active({ status }) && db.appointments.some((x) => x !== a && active(x) && x.starts_at === a.starts_at)) throw appError('slot_ocupado');
      a.status = status;
      save(db);
    },
  };
}
