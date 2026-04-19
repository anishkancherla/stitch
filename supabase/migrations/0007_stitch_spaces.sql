-- ============================================================================
-- 0007 — Stitch Spaces
--
-- A Stitch Space is a synchronous two-student room where an LLM directs a
-- step-by-step study session over the pair's combined weak subconcepts.
-- Both students hit "Done" / "Submit" on each step; cards on the room's
-- weak-areas board flip green only when the target student passes a quiz
-- proving they actually learned the concept.
--
-- See mdfiles/stitchspaces.md for the product spec.
--
-- v1 scoping:
--   - Pairs only (exactly 2 members).
--   - The plan is generated once at room creation and stored as JSON. No
--     mid-session re-planning.
--   - Mastery writes through to user_subconcept_mastery on every green
--     flip; mastery_events.source uses the existing 'manual' enum value
--     since we don't want to backfill the enum just for this. Move to a
--     dedicated 'stitch_space' source value in a follow-up if useful.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type stitch_space_status  as enum ('waiting', 'active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stitch_space_card_status as enum ('red', 'attempted', 'green');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- The room itself. plan_json is the LLM's ordered step list — see
-- src/lib/spaces.ts for the TypeScript shape. current_step indexes into
-- plan_json.steps[] and only ever increases.
create table if not exists public.stitch_spaces (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses(id) on delete cascade,
  created_by    uuid not null references public.users(id)   on delete cascade,
  status        stitch_space_status not null default 'waiting',
  plan_json     jsonb,
  current_step  integer not null default 0,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists stitch_spaces_course_idx  on public.stitch_spaces(course_id);
create index if not exists stitch_spaces_creator_idx on public.stitch_spaces(created_by);

-- Membership. Exactly two rows per space in v1 — the (id, user_id) PK
-- prevents duplicates; an app-level guard refuses a third insert.
create table if not exists public.stitch_space_members (
  space_id    uuid not null references public.stitch_spaces(id) on delete cascade,
  user_id     uuid not null references public.users(id)         on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists ssm_user_idx on public.stitch_space_members(user_id);

-- One card per (space, subconcept, target_user). "Both: weak" subconcepts
-- get two card rows — one per student — because the spec is explicit that
-- a single concept can be green for one and red for the other.
create table if not exists public.stitch_space_cards (
  space_id        uuid not null references public.stitch_spaces(id) on delete cascade,
  subconcept_id   uuid not null references public.subconcepts(id)   on delete cascade,
  target_user_id  uuid not null references public.users(id)         on delete cascade,
  status          stitch_space_card_status not null default 'red',
  updated_at      timestamptz not null default now(),
  primary key (space_id, subconcept_id, target_user_id)
);
create index if not exists ssc_space_idx on public.stitch_space_cards(space_id);

-- One row per (student, step). Quiz answers and "Done" presses both land
-- here so the room can derive whether a step is complete (both members
-- present) without a separate per-step status table.
create table if not exists public.stitch_space_responses (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.stitch_spaces(id) on delete cascade,
  step_idx     integer not null,
  user_id      uuid not null references public.users(id) on delete cascade,
  payload_json jsonb not null,
  created_at   timestamptz not null default now(),
  unique (space_id, step_idx, user_id)
);
create index if not exists ssr_space_step_idx on public.stitch_space_responses(space_id, step_idx);

-- ----------------------------------------------------------------------------
-- 3. RLS — same shape as enrollments-gated tables, but gated by space
--           membership instead.
-- ----------------------------------------------------------------------------
alter table public.stitch_spaces           enable row level security;
alter table public.stitch_space_members    enable row level security;
alter table public.stitch_space_cards      enable row level security;
alter table public.stitch_space_responses  enable row level security;

create or replace function public.is_space_member(_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stitch_space_members
    where space_id = _space_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_space_member(uuid) to anon, authenticated;

-- stitch_spaces: a member can read + update their own room (advance the
-- step pointer, end the room, stash plan_json edits). Inserts come from
-- server actions using the admin client, so no client-insert policy.
drop policy if exists stitch_spaces_member_read on public.stitch_spaces;
create policy stitch_spaces_member_read on public.stitch_spaces
  for select using (public.is_space_member(id));

drop policy if exists stitch_spaces_member_update on public.stitch_spaces;
create policy stitch_spaces_member_update on public.stitch_spaces
  for update using (public.is_space_member(id))
  with check (public.is_space_member(id));

-- stitch_space_members: a member can read the membership of their own
-- room (so the UI can render "you and X"). Self-insert is allowed too so
-- the invitee's "Join" click can land their row from the user-scoped
-- client without going through admin.
drop policy if exists ssm_self on public.stitch_space_members;
create policy ssm_self on public.stitch_space_members
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ssm_member_read on public.stitch_space_members;
create policy ssm_member_read on public.stitch_space_members
  for select using (public.is_space_member(space_id));

-- stitch_space_cards: members read + update.
drop policy if exists ssc_member_read on public.stitch_space_cards;
create policy ssc_member_read on public.stitch_space_cards
  for select using (public.is_space_member(space_id));

drop policy if exists ssc_member_update on public.stitch_space_cards;
create policy ssc_member_update on public.stitch_space_cards
  for update using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

-- stitch_space_responses: members can write their own response rows and
-- read everyone's (since both students see each other's answers).
drop policy if exists ssr_self_write on public.stitch_space_responses;
create policy ssr_self_write on public.stitch_space_responses
  for insert with check (
    user_id = auth.uid() and public.is_space_member(space_id)
  );

drop policy if exists ssr_member_read on public.stitch_space_responses;
create policy ssr_member_read on public.stitch_space_responses
  for select using (public.is_space_member(space_id));

-- ----------------------------------------------------------------------------
-- 4. Realtime — the room sync depends on these
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.stitch_spaces;
exception when duplicate_object then null;
         when undefined_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.stitch_space_members;
exception when duplicate_object then null;
         when undefined_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.stitch_space_cards;
exception when duplicate_object then null;
         when undefined_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.stitch_space_responses;
exception when duplicate_object then null;
         when undefined_object then null; end $$;

-- ============================================================================
-- Done.
-- ============================================================================
