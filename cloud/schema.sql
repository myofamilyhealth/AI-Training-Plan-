-- Vacaville Composite — the whole database.
--
-- Run this once, in the Supabase SQL editor. It is safe to run again: every
-- statement is guarded, so re-running fixes a half-finished setup rather than
-- erroring or duplicating anything.
--
-- The shape of it: a rider owns their rides and their profile; a team is a row
-- with a join code; membership is the join between them. Every rule about who
-- can read what lives here, in row-level security, not in the page — the page
-- is public and anyone can read its source, so the database has to be the thing
-- that says no.

-- ---------------------------------------------------------------- tables

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  created_at  timestamptz not null default now()
);

-- One row per account. Created automatically by the trigger at the bottom, so
-- the page never has to remember to make one.
create table if not exists public.riders (
  id           uuid primary key references auth.users on delete cascade,
  username     text not null unique,
  display_name text,
  ftp          integer,
  weight_kg    numeric,
  rest_hr      integer,
  max_hr       integer,
  unit         text not null default 'mi',
  updated_at   timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id   uuid not null references public.teams on delete cascade,
  rider_id  uuid not null references public.riders on delete cascade,
  role      text not null default 'rider' check (role in ('rider', 'coach')),
  joined_at timestamptz not null default now(),
  primary key (team_id, rider_id)
);

-- A ride, as the page already holds it. `id` is the id the browser assigns, so
-- uploading the same file twice lands on the same row instead of a second one.
-- No GPS, no track, no route: this is the summary the site actually uses.
create table if not exists public.rides (
  rider_id      uuid not null references public.riders on delete cascade,
  id            text not null,
  day           date not null,
  start_at      text,
  name          text,
  source        text,
  manual        boolean not null default false,
  distance_m    numeric,
  moving_s      integer,
  elapsed_s     integer,
  elevation_m   numeric,
  avg_hr        integer,
  max_hr        integer,
  avg_watts     integer,
  max_watts     integer,
  np            integer,
  tss           numeric,
  intensity     numeric,
  avg_cadence   integer,
  avg_speed_mps numeric,
  calories      integer,
  curve         jsonb,
  updated_at    timestamptz not null default now(),
  primary key (rider_id, id)
);

create index if not exists rides_rider_day on public.rides (rider_id, day desc);

-- ------------------------------------------------------------- who is who
--
-- These are SECURITY DEFINER on purpose. A policy on team_members that itself
-- queries team_members recurses forever; asking through a function that runs as
-- the owner breaks the loop. Each is locked to a fixed search_path so nothing
-- can be shadowed out from under it.

create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where rider_id = auth.uid()
$$;

create or replace function public.shares_team(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members a
    join public.team_members b on a.team_id = b.team_id
    where a.rider_id = auth.uid() and b.rider_id = other)
$$;

create or replace function public.is_coach(team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = team and rider_id = auth.uid() and role = 'coach')
$$;

-- ------------------------------------------------------------- joining
--
-- The code is checked in here rather than in the page, and the teams table is
-- not readable by non-members, so the code cannot be read out of the database
-- by someone who does not already have it.
--
-- The first person through the door is the coach. After that, everyone is a
-- rider until a coach says otherwise.

create or replace function public.join_team(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n integer;
begin
  select id into t from public.teams where upper(join_code) = upper(btrim(code));
  if t is null then
    raise exception 'That join code does not match a team.';
  end if;
  select count(*) into n from public.team_members where team_id = t;
  insert into public.team_members (team_id, rider_id, role)
  values (t, auth.uid(), case when n = 0 then 'coach' else 'rider' end)
  on conflict (team_id, rider_id) do nothing;
  return t;
end $$;

create or replace function public.set_role(member uuid, team uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach(team) then
    raise exception 'Only a coach can change roles.';
  end if;
  if new_role not in ('rider', 'coach') then
    raise exception 'Unknown role.';
  end if;
  update public.team_members set role = new_role
   where team_id = team and rider_id = member;
end $$;

-- --------------------------------------------------------- a new account
--
-- Signing up creates the rider row. The username is the part of the synthetic
-- email before the @ — riders never see or type an email address.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.riders (id, username, display_name)
  values (new.id,
          split_part(new.email, '@', 1),
          coalesce(nullif(new.raw_user_meta_data->>'display_name', ''),
                   split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- the rules

alter table public.teams        enable row level security;
alter table public.riders       enable row level security;
alter table public.team_members enable row level security;
alter table public.rides        enable row level security;

drop policy if exists "members read their team" on public.teams;
create policy "members read their team" on public.teams
  for select using (id in (select public.my_team_ids()));

drop policy if exists "read yourself and your teammates" on public.riders;
create policy "read yourself and your teammates" on public.riders
  for select using (id = auth.uid() or public.shares_team(id));

drop policy if exists "edit only yourself" on public.riders;
create policy "edit only yourself" on public.riders
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "insert only yourself" on public.riders;
create policy "insert only yourself" on public.riders
  for insert with check (id = auth.uid());

drop policy if exists "see who is on your team" on public.team_members;
create policy "see who is on your team" on public.team_members
  for select using (team_id in (select public.my_team_ids()));

-- Joining goes through join_team(), never a direct insert: that is what makes
-- the code mean something.
drop policy if exists "leave, or be removed by a coach" on public.team_members;
create policy "leave, or be removed by a coach" on public.team_members
  for delete using (rider_id = auth.uid() or public.is_coach(team_id));

drop policy if exists "read your own rides and your team's" on public.rides;
create policy "read your own rides and your team's" on public.rides
  for select using (rider_id = auth.uid() or public.shares_team(rider_id));

drop policy if exists "write only your own rides" on public.rides;
create policy "write only your own rides" on public.rides
  for insert with check (rider_id = auth.uid());

drop policy if exists "update only your own rides" on public.rides;
create policy "update only your own rides" on public.rides
  for update using (rider_id = auth.uid()) with check (rider_id = auth.uid());

drop policy if exists "delete only your own rides" on public.rides;
create policy "delete only your own rides" on public.rides
  for delete using (rider_id = auth.uid());

-- ------------------------------------------------------------------ team

insert into public.teams (name, join_code)
values ('Vacaville Composite', 'DIRTDOGS')
on conflict (join_code) do nothing;
