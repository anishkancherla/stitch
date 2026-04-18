-- ============================================================================
-- Stitch — initial schema
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- Safe to re-run: every CREATE uses IF NOT EXISTS / OR REPLACE where possible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role        as enum ('professor', 'student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_status    as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lecture_source   as enum ('audio_upload', 'live_transcript', 'text_upload');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lecture_status   as enum ('transcribing', 'extracting', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quiz_status      as enum ('draft', 'published', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mastery_source   as enum ('quiz_response', 'manual', 'initial');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Users
--    public.users mirrors auth.users 1:1; the trigger below keeps it in sync.
--    `role` comes from sign-up metadata: supabase.auth.signUp({ options: { data: { role, name }}})
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  role        user_role not null default 'student',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'student')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. Courses & enrollments
-- ----------------------------------------------------------------------------
create table if not exists public.courses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name          text not null,
  professor_id  uuid not null references public.users(id) on delete cascade,
  join_code     text unique,
  status        course_status not null default 'draft',
  created_at    timestamptz not null default now()
);
create index if not exists courses_professor_id_idx on public.courses(professor_id);
create index if not exists courses_join_code_idx    on public.courses(join_code);

create table if not exists public.enrollments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  unique (user_id, course_id)
);
create index if not exists enrollments_course_id_idx on public.enrollments(course_id);
create index if not exists enrollments_user_id_idx   on public.enrollments(user_id);

-- ----------------------------------------------------------------------------
-- 4. Concept graph
-- ----------------------------------------------------------------------------
create table if not exists public.concepts (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  label        text not null,
  description  text,
  position_x   double precision not null default 0,
  position_y   double precision not null default 0
);
create index if not exists concepts_course_id_idx on public.concepts(course_id);

create table if not exists public.prerequisites (
  from_concept_id  uuid not null references public.concepts(id) on delete cascade,
  to_concept_id    uuid not null references public.concepts(id) on delete cascade,
  primary key (from_concept_id, to_concept_id),
  check (from_concept_id <> to_concept_id)
);

-- ----------------------------------------------------------------------------
-- 5. Lectures & transcripts (lectures referenced by subconcepts, so create first)
-- ----------------------------------------------------------------------------
create table if not exists public.lectures (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  title        text not null,
  uploaded_by  uuid not null references public.users(id) on delete set null,
  source_type  lecture_source not null,
  audio_url    text,
  started_at   timestamptz,
  ended_at     timestamptz,
  status       lecture_status not null default 'ready',
  created_at   timestamptz not null default now()
);
create index if not exists lectures_course_id_idx on public.lectures(course_id);

create table if not exists public.transcripts (
  id            uuid primary key default gen_random_uuid(),
  lecture_id    uuid not null references public.lectures(id) on delete cascade,
  timestamp_ms  integer not null default 0,
  speaker       text,
  text          text not null
);
create index if not exists transcripts_lecture_id_idx on public.transcripts(lecture_id, timestamp_ms);

-- ----------------------------------------------------------------------------
-- 6. Subconcepts
-- ----------------------------------------------------------------------------
create table if not exists public.subconcepts (
  id           uuid primary key default gen_random_uuid(),
  concept_id   uuid not null references public.concepts(id) on delete cascade,
  lecture_id   uuid references public.lectures(id) on delete set null,
  label        text not null,
  description  text,
  created_at   timestamptz not null default now()
);
create index if not exists subconcepts_concept_id_idx on public.subconcepts(concept_id);
create index if not exists subconcepts_lecture_id_idx on public.subconcepts(lecture_id);

-- ----------------------------------------------------------------------------
-- 7. Quizzes
-- ----------------------------------------------------------------------------
create table if not exists public.quizzes (
  id            uuid primary key default gen_random_uuid(),
  lecture_id    uuid references public.lectures(id) on delete set null,
  course_id     uuid not null references public.courses(id) on delete cascade,
  title         text not null,
  status        quiz_status not null default 'draft',
  published_at  timestamptz,
  due_at        timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists quizzes_course_id_idx on public.quizzes(course_id);

create table if not exists public.quiz_questions (
  id                    uuid primary key default gen_random_uuid(),
  quiz_id               uuid not null references public.quizzes(id) on delete cascade,
  subconcept_id         uuid references public.subconcepts(id) on delete set null,
  question_text         text not null,
  options_json          jsonb not null,         -- array of strings
  correct_answer_index  integer not null check (correct_answer_index >= 0),
  difficulty            integer not null default 1 check (difficulty between 1 and 3),
  order_index           integer not null default 0,
  edited_by_professor   boolean not null default false
);
create index if not exists quiz_questions_quiz_id_idx on public.quiz_questions(quiz_id);

create table if not exists public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  score         numeric(5, 2)
);
create index if not exists quiz_attempts_quiz_user_idx on public.quiz_attempts(quiz_id, user_id);

create table if not exists public.quiz_responses (
  id                uuid primary key default gen_random_uuid(),
  quiz_attempt_id   uuid not null references public.quiz_attempts(id) on delete cascade,
  quiz_question_id  uuid not null references public.quiz_questions(id) on delete cascade,
  selected_index    integer,
  is_correct        boolean,
  answered_at       timestamptz not null default now(),
  unique (quiz_attempt_id, quiz_question_id)
);
create index if not exists quiz_responses_attempt_idx on public.quiz_responses(quiz_attempt_id);

-- ----------------------------------------------------------------------------
-- 8. Mastery
-- ----------------------------------------------------------------------------
create table if not exists public.user_subconcept_mastery (
  user_id        uuid not null references public.users(id) on delete cascade,
  subconcept_id  uuid not null references public.subconcepts(id) on delete cascade,
  score          double precision not null default 0.5 check (score between 0 and 1),
  last_updated   timestamptz not null default now(),
  primary key (user_id, subconcept_id)
);
create index if not exists usm_user_idx on public.user_subconcept_mastery(user_id);

create table if not exists public.mastery_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  subconcept_id  uuid not null references public.subconcepts(id) on delete cascade,
  delta          double precision not null,
  source         mastery_source not null,
  source_id      uuid,
  created_at     timestamptz not null default now()
);
create index if not exists mastery_events_user_idx on public.mastery_events(user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 9. Backfill triggers
--    (a) On enrollment insert -> create 0.5 mastery rows for every existing subconcept in that course
--    (b) On subconcept insert -> create 0.5 mastery rows for every enrolled student in that course
-- ----------------------------------------------------------------------------
create or replace function public.backfill_mastery_for_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_subconcept_mastery (user_id, subconcept_id, score)
  select new.user_id, sc.id, 0.5
  from public.subconcepts sc
  join public.concepts c on c.id = sc.concept_id
  where c.course_id = new.course_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_backfill_mastery_enrollment on public.enrollments;
create trigger trg_backfill_mastery_enrollment
  after insert on public.enrollments
  for each row execute function public.backfill_mastery_for_enrollment();

create or replace function public.backfill_mastery_for_subconcept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_subconcept_mastery (user_id, subconcept_id, score)
  select e.user_id, new.id, 0.5
  from public.enrollments e
  where e.course_id = (
    select c.course_id from public.concepts c where c.id = new.concept_id
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_backfill_mastery_subconcept on public.subconcepts;
create trigger trg_backfill_mastery_subconcept
  after insert on public.subconcepts
  for each row execute function public.backfill_mastery_for_subconcept();

-- ----------------------------------------------------------------------------
-- 10. Helper: am I a professor?  (used in RLS policies)
-- ----------------------------------------------------------------------------
create or replace function public.is_professor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'professor'
  );
$$;

-- ----------------------------------------------------------------------------
-- 11. Row-Level Security
--     Default deny. Then explicit policies for each table.
--     Service-role key bypasses RLS entirely (used from secure server routes).
-- ----------------------------------------------------------------------------
alter table public.users                    enable row level security;
alter table public.courses                  enable row level security;
alter table public.enrollments              enable row level security;
alter table public.concepts                 enable row level security;
alter table public.prerequisites            enable row level security;
alter table public.lectures                 enable row level security;
alter table public.transcripts              enable row level security;
alter table public.subconcepts              enable row level security;
alter table public.quizzes                  enable row level security;
alter table public.quiz_questions           enable row level security;
alter table public.quiz_attempts            enable row level security;
alter table public.quiz_responses           enable row level security;
alter table public.user_subconcept_mastery  enable row level security;
alter table public.mastery_events           enable row level security;

-- users: anyone authenticated can read their own row; row is created by trigger.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (auth.uid() = id);

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (auth.uid() = id);

-- courses: professor manages own; enrolled students can read.
drop policy if exists courses_prof_all on public.courses;
create policy courses_prof_all on public.courses
  for all using (professor_id = auth.uid())
  with check (professor_id = auth.uid());

drop policy if exists courses_student_read on public.courses;
create policy courses_student_read on public.courses
  for select using (
    exists (
      select 1 from public.enrollments e
      where e.course_id = courses.id and e.user_id = auth.uid()
    )
  );

-- enrollments: a student can enroll/unenroll themselves; professor sees their course's enrollments.
drop policy if exists enrollments_self on public.enrollments;
create policy enrollments_self on public.enrollments
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists enrollments_prof_read on public.enrollments;
create policy enrollments_prof_read on public.enrollments
  for select using (
    exists (
      select 1 from public.courses c
      where c.id = enrollments.course_id and c.professor_id = auth.uid()
    )
  );

-- concepts / prerequisites / lectures / transcripts / subconcepts:
-- professor of the course can do anything; enrolled students can read.
-- Helper macro pattern repeated per table.

-- concepts
drop policy if exists concepts_prof_all on public.concepts;
create policy concepts_prof_all on public.concepts
  for all using (
    exists (select 1 from public.courses c where c.id = concepts.course_id and c.professor_id = auth.uid())
  ) with check (
    exists (select 1 from public.courses c where c.id = concepts.course_id and c.professor_id = auth.uid())
  );

drop policy if exists concepts_student_read on public.concepts;
create policy concepts_student_read on public.concepts
  for select using (
    exists (
      select 1 from public.enrollments e
      where e.course_id = concepts.course_id and e.user_id = auth.uid()
    )
  );

-- prerequisites
drop policy if exists prereqs_prof_all on public.prerequisites;
create policy prereqs_prof_all on public.prerequisites
  for all using (
    exists (
      select 1 from public.concepts c join public.courses co on co.id = c.course_id
      where c.id = prerequisites.from_concept_id and co.professor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.concepts c join public.courses co on co.id = c.course_id
      where c.id = prerequisites.from_concept_id and co.professor_id = auth.uid()
    )
  );

drop policy if exists prereqs_student_read on public.prerequisites;
create policy prereqs_student_read on public.prerequisites
  for select using (
    exists (
      select 1
      from public.concepts c
      join public.enrollments e on e.course_id = c.course_id
      where c.id = prerequisites.from_concept_id and e.user_id = auth.uid()
    )
  );

-- lectures
drop policy if exists lectures_prof_all on public.lectures;
create policy lectures_prof_all on public.lectures
  for all using (
    exists (select 1 from public.courses c where c.id = lectures.course_id and c.professor_id = auth.uid())
  ) with check (
    exists (select 1 from public.courses c where c.id = lectures.course_id and c.professor_id = auth.uid())
  );

drop policy if exists lectures_student_read on public.lectures;
create policy lectures_student_read on public.lectures
  for select using (
    exists (
      select 1 from public.enrollments e
      where e.course_id = lectures.course_id and e.user_id = auth.uid()
    )
  );

-- transcripts (read-only for students; full for professor)
drop policy if exists transcripts_prof_all on public.transcripts;
create policy transcripts_prof_all on public.transcripts
  for all using (
    exists (
      select 1 from public.lectures l join public.courses c on c.id = l.course_id
      where l.id = transcripts.lecture_id and c.professor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.lectures l join public.courses c on c.id = l.course_id
      where l.id = transcripts.lecture_id and c.professor_id = auth.uid()
    )
  );

drop policy if exists transcripts_student_read on public.transcripts;
create policy transcripts_student_read on public.transcripts
  for select using (
    exists (
      select 1
      from public.lectures l
      join public.enrollments e on e.course_id = l.course_id
      where l.id = transcripts.lecture_id and e.user_id = auth.uid()
    )
  );

-- subconcepts
drop policy if exists subconcepts_prof_all on public.subconcepts;
create policy subconcepts_prof_all on public.subconcepts
  for all using (
    exists (
      select 1 from public.concepts c join public.courses co on co.id = c.course_id
      where c.id = subconcepts.concept_id and co.professor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.concepts c join public.courses co on co.id = c.course_id
      where c.id = subconcepts.concept_id and co.professor_id = auth.uid()
    )
  );

drop policy if exists subconcepts_student_read on public.subconcepts;
create policy subconcepts_student_read on public.subconcepts
  for select using (
    exists (
      select 1
      from public.concepts c
      join public.enrollments e on e.course_id = c.course_id
      where c.id = subconcepts.concept_id and e.user_id = auth.uid()
    )
  );

-- quizzes: professor full; students see only published quizzes in their courses.
drop policy if exists quizzes_prof_all on public.quizzes;
create policy quizzes_prof_all on public.quizzes
  for all using (
    exists (select 1 from public.courses c where c.id = quizzes.course_id and c.professor_id = auth.uid())
  ) with check (
    exists (select 1 from public.courses c where c.id = quizzes.course_id and c.professor_id = auth.uid())
  );

drop policy if exists quizzes_student_read_published on public.quizzes;
create policy quizzes_student_read_published on public.quizzes
  for select using (
    quizzes.status = 'published'
    and exists (
      select 1 from public.enrollments e
      where e.course_id = quizzes.course_id and e.user_id = auth.uid()
    )
  );

-- quiz_questions: professor full; students see questions of published quizzes in their courses.
drop policy if exists quiz_questions_prof_all on public.quiz_questions;
create policy quiz_questions_prof_all on public.quiz_questions
  for all using (
    exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.professor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.professor_id = auth.uid()
    )
  );

drop policy if exists quiz_questions_student_read on public.quiz_questions;
create policy quiz_questions_student_read on public.quiz_questions
  for select using (
    exists (
      select 1
      from public.quizzes q
      join public.enrollments e on e.course_id = q.course_id
      where q.id = quiz_questions.quiz_id
        and q.status = 'published'
        and e.user_id = auth.uid()
    )
  );

-- quiz_attempts: students manage their own attempts; professor reads attempts on their course's quizzes.
drop policy if exists quiz_attempts_self on public.quiz_attempts;
create policy quiz_attempts_self on public.quiz_attempts
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists quiz_attempts_prof_read on public.quiz_attempts;
create policy quiz_attempts_prof_read on public.quiz_attempts
  for select using (
    exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_attempts.quiz_id and c.professor_id = auth.uid()
    )
  );

-- quiz_responses: same shape as attempts.
drop policy if exists quiz_responses_self on public.quiz_responses;
create policy quiz_responses_self on public.quiz_responses
  for all using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = quiz_responses.quiz_attempt_id and a.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = quiz_responses.quiz_attempt_id and a.user_id = auth.uid()
    )
  );

drop policy if exists quiz_responses_prof_read on public.quiz_responses;
create policy quiz_responses_prof_read on public.quiz_responses
  for select using (
    exists (
      select 1
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      join public.courses c on c.id = q.course_id
      where a.id = quiz_responses.quiz_attempt_id and c.professor_id = auth.uid()
    )
  );

-- user_subconcept_mastery: students read/update their own; professor reads for their courses.
drop policy if exists usm_self on public.user_subconcept_mastery;
create policy usm_self on public.user_subconcept_mastery
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists usm_prof_read on public.user_subconcept_mastery;
create policy usm_prof_read on public.user_subconcept_mastery
  for select using (
    exists (
      select 1
      from public.subconcepts s
      join public.concepts c on c.id = s.concept_id
      join public.courses co on co.id = c.course_id
      where s.id = user_subconcept_mastery.subconcept_id and co.professor_id = auth.uid()
    )
  );

-- mastery_events: students read their own; professor reads for their courses.
drop policy if exists mastery_events_self on public.mastery_events;
create policy mastery_events_self on public.mastery_events
  for select using (user_id = auth.uid());

drop policy if exists mastery_events_prof_read on public.mastery_events;
create policy mastery_events_prof_read on public.mastery_events
  for select using (
    exists (
      select 1
      from public.subconcepts s
      join public.concepts c on c.id = s.concept_id
      join public.courses co on co.id = c.course_id
      where s.id = mastery_events.subconcept_id and co.professor_id = auth.uid()
    )
  );

-- ============================================================================
-- Done.
-- ============================================================================
