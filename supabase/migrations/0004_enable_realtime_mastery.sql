-- ============================================================================
-- 0004 — Enable Realtime on user_subconcept_mastery
--
-- Adds the table to the supabase_realtime publication so Postgres emits
-- INSERT/UPDATE/DELETE events that the JS client can subscribe to. The
-- prof's class heatmap uses this to re-render when any enrolled student's
-- mastery changes, instead of requiring a manual refresh.
--
-- Idempotent — wrapped in a DO block that swallows the "already exists"
-- error if the table is already in the publication.
-- ============================================================================

do $$
begin
  alter publication supabase_realtime add table public.user_subconcept_mastery;
exception
  when duplicate_object then
    null;
  when undefined_object then
    -- supabase_realtime publication doesn't exist (e.g. local without Realtime).
    null;
end $$;
