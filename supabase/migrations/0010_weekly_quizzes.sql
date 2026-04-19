-- ============================================================================
-- 0010 — Weekly quizzes
--
-- Concept-scoped MCQ quizzes the professor generates per "week" (=concept).
-- Each quiz spans every subconcept under its concept, with question count
-- adapted to the number of subconcepts. Each question is tagged with its
-- `subconceptId` so we can per-subconcept-grade attempts and bump the
-- right mastery rows.
--
-- See mdfiles/stitch_spec.md and the AI Stitch Spaces & Weekly Quiz plan
-- for the product motivation.
--
-- v1 scoping:
--   - One quiz per concept. Regenerating REPLACES the existing row (the
--     unique constraint on concept_id makes the upsert simple).
--   - One attempt per student per quiz. Re-takes are out of scope; the
--     UI hides the take button after submission.
--   - Mastery side-effects (per-subconcept bump on >= 60% on that
--     subconcept's questions) live in the server action that writes
--     attempts; no DB trigger needed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

-- One generated quiz per concept. `questions_json` is an array of:
--   {
--     "subconceptId": "<uuid>",
--     "prompt": "...",
--     "choices": ["...", "...", "...", "..."],
--     "correctIndex": 0..3
--   }
-- Schema mirrors `QuizQuestion` from src/lib/spaces.ts plus the extra
-- subconcept tag the weekly quiz needs.
create table if not exists public.weekly_quizzes (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id)  on delete cascade,
  concept_id      uuid not null references public.concepts(id) on delete cascade,
  questions_json  jsonb not null,
  generated_by    uuid not null references public.users(id)    on delete cascade,
  created_at      timestamptz not null default now(),
  unique (concept_id)
);
create index if not exists weekly_quizzes_course_idx on public.weekly_quizzes(course_id);

-- One attempt per (quiz, student). `answers_json` is a number[] aligned
-- to `questions_json`; -1 means unanswered (the UI shouldn't allow that
-- but the server tolerates it).
create table if not exists public.weekly_quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.weekly_quizzes(id) on delete cascade,
  user_id         uuid not null references public.users(id)          on delete cascade,
  answers_json    jsonb not null,
  score_pct       numeric not null,
  submitted_at    timestamptz not null default now(),
  unique (quiz_id, user_id)
);
create index if not exists wqa_user_idx on public.weekly_quiz_attempts(user_id);
create index if not exists wqa_quiz_idx on public.weekly_quiz_attempts(quiz_id);

-- ----------------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------------
alter table public.weekly_quizzes        enable row level security;
alter table public.weekly_quiz_attempts  enable row level security;

-- weekly_quizzes:
--   - Read: any enrolled student in the course OR the course's professor.
--   - Write: server actions only (admin client). No client-write policy.
drop policy if exists wq_read on public.weekly_quizzes;
create policy wq_read on public.weekly_quizzes
  for select using (
    exists (
      select 1
      from public.courses c
      left join public.enrollments e on e.course_id = c.id and e.user_id = auth.uid()
      where c.id = weekly_quizzes.course_id
        and (
          c.professor_id = auth.uid()
          or e.user_id is not null
        )
    )
  );

-- weekly_quiz_attempts:
--   - Student can read + insert their OWN row only.
--   - Professor of the course can read every attempt (for stats).
drop policy if exists wqa_self on public.weekly_quiz_attempts;
create policy wqa_self on public.weekly_quiz_attempts
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists wqa_prof_read on public.weekly_quiz_attempts;
create policy wqa_prof_read on public.weekly_quiz_attempts
  for select using (
    exists (
      select 1
      from public.weekly_quizzes wq
      join public.courses c on c.id = wq.course_id
      where wq.id = weekly_quiz_attempts.quiz_id
        and c.professor_id = auth.uid()
    )
  );

-- ============================================================================
-- Done.
-- ============================================================================
