-- ============================================================================
-- 0003 — enroll_with_code RPC
--
-- A student joining a course needs to (1) look up the course by join_code
-- and (2) insert a row into enrollments. Step (1) is blocked by
-- courses_student_read (the student isn't enrolled yet, so they can't read
-- the course row). Solve it with a SECURITY DEFINER RPC that does both
-- atomically and bypasses RLS.
--
-- Returns the course_id on success, NULL if no published course matches the
-- code. Idempotent on re-join (ON CONFLICT DO NOTHING).
-- ============================================================================

create or replace function public.enroll_with_code(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _course_id uuid;
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into _course_id
  from public.courses
  where join_code = upper(btrim(_code))
    and status = 'published'
  limit 1;

  if _course_id is null then
    return null;
  end if;

  insert into public.enrollments (course_id, user_id)
  values (_course_id, _uid)
  on conflict do nothing;

  return _course_id;
end;
$$;

grant execute on function public.enroll_with_code(text) to authenticated;
