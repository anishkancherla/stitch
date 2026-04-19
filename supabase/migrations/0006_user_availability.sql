-- ============================================================================
-- Stitch — Manual availability layer (slice 2 of contextual matching pivot).
--
-- One row per (user, day, contiguous block). The ribbon's match panel
-- intersects requester's blocks against each candidate's blocks to derive
-- weekly overlap hours, which feed the matching score.
--
-- Source column is forward-looking — 'gcal' rows will be written by a sync
-- worker once Google Calendar OAuth lands. For now everything is 'manual'.
-- ============================================================================

create table if not exists public.user_availability (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),  -- 0 = Sun
  start_time   time not null,
  end_time     time not null,
  source       text not null default 'manual' check (source in ('manual','gcal')),
  created_at   timestamptz not null default now(),
  -- Block sanity. Half-open [start, end) so adjacent blocks can touch.
  check (end_time > start_time)
);

create index if not exists user_availability_user_idx
  on public.user_availability(user_id, day_of_week);

alter table public.user_availability enable row level security;

-- Self-manage: a user reads + writes only their own rows.
drop policy if exists user_availability_self on public.user_availability;
create policy user_availability_self on public.user_availability
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Cross-read for matching: anyone enrolled in a course can read the
-- availability of their classmates in that course. Scoped through
-- enrollments so this can't be used to scrape strangers — both rows must
-- share at least one course.
drop policy if exists user_availability_classmate_read on public.user_availability;
create policy user_availability_classmate_read on public.user_availability
  for select using (
    exists (
      select 1
      from public.enrollments mine
      join public.enrollments theirs on theirs.course_id = mine.course_id
      where mine.user_id  = auth.uid()
        and theirs.user_id = user_availability.user_id
    )
  );
