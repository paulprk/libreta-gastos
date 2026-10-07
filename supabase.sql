-- Pegar en Supabase → SQL Editor → New query → Run.
-- Una fila por movimiento. Nada se borra de verdad: borrar marca deleted = true.

create table if not exists public.movimientos (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo        text not null check (tipo in ('gasto', 'ingreso')),
  monto       numeric(14, 2) not null check (monto > 0),
  categoria   text not null default 'Varios',
  nota        text not null default '',
  ts          bigint not null,
  deleted     boolean not null default false,
  updated_at  bigint not null
);

create index if not exists movimientos_user_idx on public.movimientos (user_id);

alter table public.movimientos enable row level security;

-- Cada persona ve, crea y modifica solo sus movimientos. No hay permiso para borrar filas.
drop policy if exists "ver los propios" on public.movimientos;
create policy "ver los propios" on public.movimientos
  for select using (auth.uid() = user_id);

drop policy if exists "crear los propios" on public.movimientos;
create policy "crear los propios" on public.movimientos
  for insert with check (auth.uid() = user_id);

drop policy if exists "editar los propios" on public.movimientos;
create policy "editar los propios" on public.movimientos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
