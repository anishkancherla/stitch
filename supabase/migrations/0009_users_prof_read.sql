-- ============================================================================
-- 0009 — Allow professors to read enrolled-student rows in public.users
--
-- The original `users_self_select` policy only let a user read their own row.
-- The professor's "Students" tab needs to display name + email for every
-- student enrolled in their course (roster table + per-student detail page).
--
-- This is read-only and scoped: the prof can only see rows for users who are
-- enrolled in at least one course they own. Students still cannot see anyone
-- else's row.
-- ============================================================================

drop policy if exists users_prof_read_enrolled on public.users;
create policy users_prof_read_enrolled on public.users
  for select using (
    exists (
      select 1
      from public.enrollments e
      join public.courses     c on c.id = e.course_id
      where e.user_id = users.id
        and c.professor_id = auth.uid()
    )
  );

-- ============================================================================
-- Done.
-- ============================================================================
