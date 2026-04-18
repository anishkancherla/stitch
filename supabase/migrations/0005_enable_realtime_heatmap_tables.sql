-- ============================================================================
-- 0005 — Enable Realtime on the rest of the heatmap-shaping tables
--
-- Lecture uploads insert new rows into `lectures`, `subconcepts`, and (rarely)
-- `concepts`. The student / prof course pages need to react to those inserts
-- to render new columns / rows / cells without a manual refresh, so add them
-- to the supabase_realtime publication.
--
-- Idempotent: each ALTER is wrapped in its own DO block that swallows
-- duplicate_object (already in publication) and undefined_object (no
-- publication, e.g. local Supabase without Realtime).
-- ============================================================================

do $$
begin
  alter publication supabase_realtime add table public.subconcepts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lectures;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.concepts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
