-- =====================================================================
--  Centro Psicológico Integral "Sentirse Bien" · esquema de Supabase
--  Pégalo completo en: Supabase → SQL Editor → New query → Run
--  (Se puede ejecutar de nuevo sin romper nada: usa "if not exists" y "or replace").
--  Zona horaria de las citas: America/Lima (sin horario de verano).
-- =====================================================================

-- ---------- 1. Tablas ----------

-- Ajustes generales (una sola fila, id = 1)
create table if not exists public.settings (
  id                int primary key default 1 check (id = 1),
  slot_minutes      int     not null default 60  check (slot_minutes between 15 and 240),
  min_notice_hours  int     not null default 12  check (min_notice_hours >= 0),
  horizon_days      int     not null default 21  check (horizon_days between 1 and 120),
  accepting_bookings boolean not null default true
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Quién puede entrar al panel (se llena a mano una vez, ver README)
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Horario semanal. weekday: 0 = domingo ... 6 = sábado (igual que JavaScript)
create table if not exists public.availability_rules (
  id         uuid primary key default gen_random_uuid(),
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time     not null,
  end_time   time     not null,
  modes      text[]   not null default '{virtual,domicilio}',
  active     boolean  not null default true,
  check (end_time > start_time),
  check (cardinality(modes) > 0 and modes <@ array['virtual','domicilio']::text[])
);

-- Días libres (feriados, vacaciones, viajes)
create table if not exists public.time_off (
  id        uuid primary key default gen_random_uuid(),
  date_from date not null,
  date_to   date not null,
  note      text,
  check (date_to >= date_from)
);

-- Citas solicitadas
create table if not exists public.appointments (
  id           uuid primary key default gen_random_uuid(),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  mode         text not null check (mode in ('virtual', 'domicilio')),
  who          text not null check (who in ('nino', 'adolescente', 'adulto', 'familia')),
  patient_name text not null check (char_length(patient_name) between 2 and 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  phone        text not null check (phone ~ '^[0-9]{9}$'),
  district     text check (district is null or char_length(district) <= 80),
  notes        text check (notes is null or char_length(notes) <= 600),
  status       text not null default 'pendiente'
               check (status in ('pendiente', 'confirmada', 'rechazada', 'cancelada')),
  created_at   timestamptz not null default now()
);

-- Evita que dos personas tomen la misma hora
create unique index if not exists appointments_one_active_per_start
  on public.appointments (starts_at) where status in ('pendiente', 'confirmada');
create index if not exists appointments_starts_at_idx on public.appointments (starts_at);

-- ---------- 2. Seguridad (RLS) ----------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

alter table public.settings           enable row level security;
alter table public.admins             enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_off           enable row level security;
alter table public.appointments       enable row level security;

-- Sin políticas para "anon" = el público NO puede leer ni escribir tablas directamente.
-- El público solo usa las funciones de la sección 3.
drop policy if exists "admin: todo" on public.settings;
drop policy if exists "admin: todo" on public.availability_rules;
drop policy if exists "admin: todo" on public.time_off;
drop policy if exists "admin: todo" on public.appointments;
drop policy if exists "admins: ver la propia fila" on public.admins;

create policy "admin: todo" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin: todo" on public.availability_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin: todo" on public.time_off
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin: todo" on public.appointments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins: ver la propia fila" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------- 3. Funciones públicas (lo único que ve el sitio) ----------

-- Ajustes que puede ver cualquiera
create or replace function public.get_public_settings()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'slot_minutes',       slot_minutes,
    'horizon_days',       horizon_days,
    'min_notice_hours',   min_notice_hours,
    'accepting_bookings', accepting_bookings
  ) from public.settings where id = 1
$$;

-- Horas libres entre dos fechas para una modalidad ('virtual' o 'domicilio')
create or replace function public.get_available_slots(p_from date, p_to date, p_mode text)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.settings%rowtype;
  v_today  date := (now() at time zone 'America/Lima')::date;
  v_from   date;
  v_to     date;
begin
  select * into s from public.settings where id = 1;
  if p_mode not in ('virtual', 'domicilio') then
    raise exception 'modalidad_invalida';
  end if;
  if not s.accepting_bookings then
    return;
  end if;

  v_from := greatest(p_from, v_today);
  v_to   := least(p_to, v_today + s.horizon_days);
  if v_to < v_from then
    return;
  end if;

  return query
  select distinct (gs.local_ts at time zone 'America/Lima') as slot_start
  from generate_series(0, v_to - v_from) as i
  cross join lateral (select v_from + i as day) d
  join public.availability_rules r
    on r.active
   and r.weekday = extract(dow from d.day)::int
   and p_mode = any (r.modes)
  cross join lateral generate_series(
        d.day + r.start_time,
        d.day + r.end_time - make_interval(mins => s.slot_minutes),
        make_interval(mins => s.slot_minutes)
      ) as gs(local_ts)
  where (gs.local_ts at time zone 'America/Lima') >= now() + make_interval(hours => s.min_notice_hours)
    and not exists (
      select 1 from public.time_off t where d.day between t.date_from and t.date_to
    )
    and not exists (
      select 1 from public.appointments a
      where a.status in ('pendiente', 'confirmada')
        and a.starts_at < (gs.local_ts at time zone 'America/Lima') + make_interval(mins => s.slot_minutes)
        and a.ends_at   > (gs.local_ts at time zone 'America/Lima')
    )
  order by 1;
end;
$$;

-- Crea una solicitud de cita (valida todo en el servidor)
create or replace function public.create_appointment(
  p_start        timestamptz,
  p_mode         text,
  p_who          text,
  p_patient_name text,
  p_contact_name text,
  p_phone        text,
  p_district     text,
  p_notes        text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  s       public.settings%rowtype;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_day   date;
  v_ok    boolean;
  v_id    uuid;
begin
  select * into s from public.settings where id = 1;
  if not s.accepting_bookings then
    raise exception 'reservas_cerradas';
  end if;

  if v_phone ~ '^51[0-9]{9}$' then
    v_phone := substr(v_phone, 3);
  end if;
  if v_phone !~ '^9[0-9]{8}$' then
    raise exception 'telefono_invalido';
  end if;
  if char_length(trim(coalesce(p_patient_name, ''))) < 2 then
    raise exception 'nombre_invalido';
  end if;
  if p_mode = 'domicilio' and coalesce(trim(p_district), '') = '' then
    raise exception 'distrito_requerido';
  end if;
  -- Máximo 3 solicitudes pendientes (a futuro) por celular
  if (select count(*) from public.appointments
      where phone = v_phone and status = 'pendiente' and starts_at > now()) >= 3 then
    raise exception 'demasiadas_solicitudes';
  end if;
  -- Freno contra spam: pocas solicitudes nuevas por cada 10 minutos y por día
  if (select count(*) from public.appointments where created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.appointments where created_at > now() - interval '24 hours') >= 20 then
    raise exception 'sistema_ocupado';
  end if;

  v_day := (p_start at time zone 'America/Lima')::date;
  select exists (
    select 1 from public.get_available_slots(v_day, v_day, p_mode) g where g.slot_start = p_start
  ) into v_ok;
  if not v_ok then
    raise exception 'slot_no_disponible';
  end if;

  begin
    insert into public.appointments
      (starts_at, ends_at, mode, who, patient_name, contact_name, phone, district, notes)
    values
      (p_start, p_start + make_interval(mins => s.slot_minutes), p_mode, p_who,
       trim(p_patient_name), nullif(trim(p_contact_name), ''), v_phone,
       nullif(trim(p_district), ''), nullif(trim(p_notes), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'slot_no_disponible';
  end;

  return v_id;
end;
$$;

-- ---------- 4. Funciones solo para el panel ----------

-- Reemplaza todo el horario semanal de una vez (transacción)
-- p_rules = [{"weekday":6,"start_time":"09:00","end_time":"13:00","modes":["virtual","domicilio"],"active":true}, ...]
create or replace function public.admin_replace_availability(p_rules jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'no_autorizado';
  end if;
  delete from public.availability_rules where true;
  insert into public.availability_rules (weekday, start_time, end_time, modes, active)
  select (e ->> 'weekday')::smallint,
         (e ->> 'start_time')::time,
         (e ->> 'end_time')::time,
         array(select jsonb_array_elements_text(e -> 'modes')),
         coalesce((e ->> 'active')::boolean, true)
  from jsonb_array_elements(p_rules) e;
end;
$$;

-- ---------- 5. Permisos de ejecución ----------
-- Supabase da permiso de ejecución a anon/authenticated directamente (no vía "public"),
-- así que hay que quitárselo a los tres y luego dar solo lo necesario.
revoke all on function public.get_public_settings()            from public, anon, authenticated;
revoke all on function public.get_available_slots(date, date, text) from public, anon, authenticated;
revoke all on function public.create_appointment(timestamptz, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_replace_availability(jsonb) from public, anon, authenticated;
revoke all on function public.is_admin()                        from public, anon, authenticated;

grant execute on function public.get_public_settings()            to anon, authenticated;
grant execute on function public.get_available_slots(date, date, text) to anon, authenticated;
grant execute on function public.create_appointment(timestamptz, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_replace_availability(jsonb) to authenticated;
grant execute on function public.is_admin()                        to authenticated;

-- ---------- 6. Horario de ejemplo (edítalo o bórralo desde el panel) ----------
insert into public.availability_rules (weekday, start_time, end_time, modes)
select * from (values
  (6::smallint, '09:00'::time, '13:00'::time, '{virtual,domicilio}'::text[]),
  (6::smallint, '15:00'::time, '19:00'::time, '{virtual,domicilio}'::text[]),
  (0::smallint, '09:00'::time, '13:00'::time, '{virtual,domicilio}'::text[]),
  (3::smallint, '19:00'::time, '21:00'::time, '{virtual}'::text[])
) as v(weekday, start_time, end_time, modes)
where not exists (select 1 from public.availability_rules);
