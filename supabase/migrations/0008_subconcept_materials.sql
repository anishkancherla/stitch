-- ============================================================================
-- 0008 — Subconcept materials
--
-- Per-subconcept lecture extract used to ground Stitch Space teach steps and
-- the planner's quiz authoring. Populated at lecture-upload time alongside
-- subconcept rows; one row per subconcept.
--
-- `summary`     — 1–2 sentence plain-prose digest of what the subconcept
--                 actually means in the prof's framing.
-- `key_points`  — 4–7 short bullet strings (claims, formulas, examples,
--                 pitfalls). Drawn straight from the slides so the planner
--                 can echo the prof's specific wording into teach
--                 instructions and quiz distractors.
--
-- We store materials in a sidecar table (rather than columns on
-- subconcepts) so that re-extracting later, or feeding multiple lectures
-- into one subconcept, doesn't churn the subconcept row's primary key /
-- triggers.
-- ============================================================================

create table if not exists public.subconcept_materials (
  subconcept_id uuid primary key references public.subconcepts(id) on delete cascade,
  summary       text not null default '',
  key_points    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- RLS — anyone enrolled in the course can read materials for any subconcept
-- in that course; the course's professor can also read. Writes happen only
-- through server actions using the admin client, so no client-write policy.
-- ----------------------------------------------------------------------------
alter table public.subconcept_materials enable row level security;

drop policy if exists subconcept_materials_read on public.subconcept_materials;
create policy subconcept_materials_read on public.subconcept_materials
  for select using (
    exists (
      select 1
      from public.subconcepts s
      join public.concepts    c on c.id = s.concept_id
      join public.courses     co on co.id = c.course_id
      left join public.enrollments e on e.course_id = co.id and e.user_id = auth.uid()
      where s.id = subconcept_materials.subconcept_id
        and (
          co.professor_id = auth.uid()
          or e.user_id is not null
        )
    )
  );

-- ============================================================================
-- Done.
-- ============================================================================
