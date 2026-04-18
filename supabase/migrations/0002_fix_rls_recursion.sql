-- ============================================================================
-- 0002 — Fix RLS infinite recursion
--
-- The §11 policies in 0001_init.sql cross-reference each other
-- (courses ↔ enrollments, concepts → enrollments → courses, etc.). When
-- Postgres evaluates a query against any of those tables, RLS triggers RLS
-- triggers RLS → "infinite recursion detected in policy for relation".
--
-- Fix: replace every cross-table EXISTS subquery in a policy with a
-- SECURITY DEFINER helper function. SECURITY DEFINER runs as the function
-- owner (postgres in Supabase, which has BYPASSRLS), so the inner reads
-- don't re-evaluate RLS. The cycle is broken.
--
-- Safe to re-run: every helper uses CREATE OR REPLACE; every policy uses
-- DROP IF EXISTS + CREATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper functions
-- ----------------------------------------------------------------------------

create or replace function public.is_enrolled(_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments
    where course_id = _course_id and user_id = auth.uid()
  );
$$;

create or replace function public.owns_course(_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses
    where id = _course_id and professor_id = auth.uid()
  );
$$;

create or replace function public.course_of_concept(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select course_id from public.concepts where id = _id;
$$;

create or replace function public.course_of_lecture(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select course_id from public.lectures where id = _id;
$$;

create or replace function public.course_of_subconcept(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.course_id
  from public.subconcepts s
  join public.concepts c on c.id = s.concept_id
  where s.id = _id;
$$;

create or replace function public.course_of_quiz(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select course_id from public.quizzes where id = _id;
$$;

create or replace function public.course_of_quiz_question(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.course_id
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  where qq.id = _id;
$$;

create or replace function public.course_of_quiz_attempt(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.course_id
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where qa.id = _id;
$$;

create or replace function public.attempt_owned_by_me(_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quiz_attempts
    where id = _attempt_id and user_id = auth.uid()
  );
$$;

create or replace function public.course_of_quiz_response(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.course_id
  from public.quiz_responses qr
  join public.quiz_attempts qa on qa.id = qr.quiz_attempt_id
  join public.quizzes q on q.id = qa.quiz_id
  where qr.id = _id;
$$;

-- Make these callable from the Supabase client roles.
grant execute on function public.is_enrolled(uuid)               to anon, authenticated;
grant execute on function public.owns_course(uuid)               to anon, authenticated;
grant execute on function public.course_of_concept(uuid)         to anon, authenticated;
grant execute on function public.course_of_lecture(uuid)         to anon, authenticated;
grant execute on function public.course_of_subconcept(uuid)      to anon, authenticated;
grant execute on function public.course_of_quiz(uuid)            to anon, authenticated;
grant execute on function public.course_of_quiz_question(uuid)   to anon, authenticated;
grant execute on function public.course_of_quiz_attempt(uuid)    to anon, authenticated;
grant execute on function public.course_of_quiz_response(uuid)   to anon, authenticated;
grant execute on function public.attempt_owned_by_me(uuid)       to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Replace every cross-table policy with one that calls a helper.
-- ----------------------------------------------------------------------------

-- courses
drop policy if exists courses_student_read on public.courses;
create policy courses_student_read on public.courses
  for select using (public.is_enrolled(id));

-- enrollments
drop policy if exists enrollments_prof_read on public.enrollments;
create policy enrollments_prof_read on public.enrollments
  for select using (public.owns_course(course_id));

-- concepts
drop policy if exists concepts_prof_all on public.concepts;
create policy concepts_prof_all on public.concepts
  for all using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

drop policy if exists concepts_student_read on public.concepts;
create policy concepts_student_read on public.concepts
  for select using (public.is_enrolled(course_id));

-- prerequisites
drop policy if exists prereqs_prof_all on public.prerequisites;
create policy prereqs_prof_all on public.prerequisites
  for all using (public.owns_course(public.course_of_concept(from_concept_id)))
  with check (public.owns_course(public.course_of_concept(from_concept_id)));

drop policy if exists prereqs_student_read on public.prerequisites;
create policy prereqs_student_read on public.prerequisites
  for select using (public.is_enrolled(public.course_of_concept(from_concept_id)));

-- lectures
drop policy if exists lectures_prof_all on public.lectures;
create policy lectures_prof_all on public.lectures
  for all using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

drop policy if exists lectures_student_read on public.lectures;
create policy lectures_student_read on public.lectures
  for select using (public.is_enrolled(course_id));

-- transcripts
drop policy if exists transcripts_prof_all on public.transcripts;
create policy transcripts_prof_all on public.transcripts
  for all using (public.owns_course(public.course_of_lecture(lecture_id)))
  with check (public.owns_course(public.course_of_lecture(lecture_id)));

drop policy if exists transcripts_student_read on public.transcripts;
create policy transcripts_student_read on public.transcripts
  for select using (public.is_enrolled(public.course_of_lecture(lecture_id)));

-- subconcepts
drop policy if exists subconcepts_prof_all on public.subconcepts;
create policy subconcepts_prof_all on public.subconcepts
  for all using (public.owns_course(public.course_of_concept(concept_id)))
  with check (public.owns_course(public.course_of_concept(concept_id)));

drop policy if exists subconcepts_student_read on public.subconcepts;
create policy subconcepts_student_read on public.subconcepts
  for select using (public.is_enrolled(public.course_of_concept(concept_id)));

-- quizzes
drop policy if exists quizzes_prof_all on public.quizzes;
create policy quizzes_prof_all on public.quizzes
  for all using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

drop policy if exists quizzes_student_read_published on public.quizzes;
create policy quizzes_student_read_published on public.quizzes
  for select using (status = 'published' and public.is_enrolled(course_id));

-- quiz_questions
drop policy if exists quiz_questions_prof_all on public.quiz_questions;
create policy quiz_questions_prof_all on public.quiz_questions
  for all using (public.owns_course(public.course_of_quiz(quiz_id)))
  with check (public.owns_course(public.course_of_quiz(quiz_id)));

drop policy if exists quiz_questions_student_read on public.quiz_questions;
create policy quiz_questions_student_read on public.quiz_questions
  for select using (
    public.is_enrolled(public.course_of_quiz(quiz_id))
    and exists (
      -- quizzes table is queried via security-definer course_of_quiz already,
      -- but we still need to gate on the quiz being published. Cheap inline
      -- check; quizzes RLS would otherwise hide the row from the student.
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id and q.status = 'published'
    )
  );

-- quiz_attempts
drop policy if exists quiz_attempts_prof_read on public.quiz_attempts;
create policy quiz_attempts_prof_read on public.quiz_attempts
  for select using (public.owns_course(public.course_of_quiz(quiz_id)));

-- quiz_responses
drop policy if exists quiz_responses_self on public.quiz_responses;
create policy quiz_responses_self on public.quiz_responses
  for all using (public.attempt_owned_by_me(quiz_attempt_id))
  with check (public.attempt_owned_by_me(quiz_attempt_id));

drop policy if exists quiz_responses_prof_read on public.quiz_responses;
create policy quiz_responses_prof_read on public.quiz_responses
  for select using (public.owns_course(public.course_of_quiz_attempt(quiz_attempt_id)));

-- user_subconcept_mastery
drop policy if exists usm_prof_read on public.user_subconcept_mastery;
create policy usm_prof_read on public.user_subconcept_mastery
  for select using (public.owns_course(public.course_of_subconcept(subconcept_id)));

-- mastery_events
drop policy if exists mastery_events_prof_read on public.mastery_events;
create policy mastery_events_prof_read on public.mastery_events
  for select using (public.owns_course(public.course_of_subconcept(subconcept_id)));

-- ============================================================================
-- Done. The professor's create-course flow should now succeed.
-- ============================================================================
