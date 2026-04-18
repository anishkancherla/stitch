-- ============================================================================
-- CS 161 demo seed
--
-- Populates the existing CS 161 course (id 8f205a5f-…) with 8 concepts,
-- 6 lectures, ~28 subconcepts, and varied mastery scores for the test
-- student so the heatmap renders interesting cells out of the box.
--
-- Idempotent — safe to re-run; existing rows are skipped via ON CONFLICT.
-- ============================================================================

-- IDs used throughout (inlined as literals so this also works pasted into
-- the Supabase SQL editor, which doesn't honor psql \set):
--   course_id  = 8f205a5f-c775-4148-a28d-c5996429ed95   -- CS 161
--   prof_id    = e0002fff-65c7-46e8-987a-3f56ef7851be   -- prof@test.com
--   student_id = ee70c391-82a2-43ff-8c59-d219c3113332   -- student@test.com

-- ----------------------------------------------------------------------------
-- 1. Ensure the test student is enrolled. The trg_backfill_mastery_enrollment
--    trigger will then create 0.5 mastery rows when subconcepts get added.
-- ----------------------------------------------------------------------------
insert into public.enrollments (user_id, course_id)
values ('ee70c391-82a2-43ff-8c59-d219c3113332',
        '8f205a5f-c775-4148-a28d-c5996429ed95')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. Concepts (rows of the heatmap, ordered by created_at).
-- ----------------------------------------------------------------------------
insert into public.concepts (course_id, label, description)
select '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid, label, description
from (values
  ('Recursion & Induction',  'Recursive structure of algorithms and inductive proofs of correctness.'),
  ('Asymptotic Analysis',    'Big-O, Big-Theta, Big-Omega, and reasoning about runtime.'),
  ('Sorting',                'Comparison-based sorting algorithms and lower bounds.'),
  ('Divide & Conquer',       'Splitting problems into subproblems; recurrences.'),
  ('Dynamic Programming',    'Overlapping subproblems and optimal substructure.'),
  ('Greedy Algorithms',      'Locally optimal choices and when they globally optimize.'),
  ('Graph Algorithms',       'Traversal, shortest paths, and graph representations.'),
  ('Hashing',                'Hash functions, hash tables, and collision resolution.')
) as t(label, description)
where not exists (
  select 1 from public.concepts c
  where c.course_id = '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid
    and c.label = t.label
);

-- ----------------------------------------------------------------------------
-- 3. Lectures (columns of the heatmap, ordered by started_at).
-- ----------------------------------------------------------------------------
insert into public.lectures (course_id, title, uploaded_by, source_type, started_at, status)
select '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid,
       title,
       'e0002fff-65c7-46e8-987a-3f56ef7851be'::uuid,
       'text_upload'::lecture_source,
       started_at::timestamptz,
       'ready'::lecture_status
from (values
  ('Intro & Recursion',        '2026-03-30 10:00:00+00'),
  ('Big-O & Sorting Basics',   '2026-04-06 10:00:00+00'),
  ('Divide and Conquer',       '2026-04-13 10:00:00+00'),
  ('Dynamic Programming I',    '2026-04-20 10:00:00+00'),
  ('Greedy & Graph Intro',     '2026-04-27 10:00:00+00'),
  ('BFS, DFS, Hashing',        '2026-05-04 10:00:00+00')
) as t(title, started_at)
where not exists (
  select 1 from public.lectures l
  where l.course_id = '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid
    and l.title = t.title
);

-- ----------------------------------------------------------------------------
-- 4. Subconcepts. Each row maps a (concept label, lecture title) pair to a
--    subconcept label. Trigger then auto-creates mastery rows at 0.5 for
--    every enrolled student.
-- ----------------------------------------------------------------------------
insert into public.subconcepts (concept_id, lecture_id, label, description)
select c.id, l.id, sc.label, sc.description
from (values
  -- L1: Intro & Recursion
  ('Recursion & Induction', 'Intro & Recursion',      'Base cases',                'Identifying terminating cases.'),
  ('Recursion & Induction', 'Intro & Recursion',      'Recursive calls',           'Self-reference and stack growth.'),
  ('Recursion & Induction', 'Intro & Recursion',      'Mathematical induction',    'Proving correctness by induction.'),
  ('Asymptotic Analysis',   'Intro & Recursion',      'Why runtime matters',       'Motivating asymptotic thinking.'),

  -- L2: Big-O & Sorting Basics
  ('Asymptotic Analysis',   'Big-O & Sorting Basics', 'Big-O notation',            'Upper bounds on runtime.'),
  ('Asymptotic Analysis',   'Big-O & Sorting Basics', 'Theta and Omega',           'Tight and lower bounds.'),
  ('Sorting',               'Big-O & Sorting Basics', 'Insertion sort',            'Quadratic comparison-based sort.'),
  ('Sorting',               'Big-O & Sorting Basics', 'Selection sort',            'Quadratic by repeated min selection.'),

  -- L3: Divide and Conquer
  ('Divide & Conquer',      'Divide and Conquer',     'Merge sort',                'Stable O(n log n) sort by merging.'),
  ('Divide & Conquer',      'Divide and Conquer',     'Quicksort partitioning',    'Pivot-based in-place partition.'),
  ('Divide & Conquer',      'Divide and Conquer',     'Master theorem',            'Closed forms for D&C recurrences.'),
  ('Sorting',               'Divide and Conquer',     'Sorting lower bounds',      'Why comparison sort is Ω(n log n).'),
  ('Recursion & Induction', 'Divide and Conquer',     'Recurrence relations',      'Translating recursion to runtime.'),

  -- L4: Dynamic Programming I
  ('Dynamic Programming',   'Dynamic Programming I',  'Memoization vs tabulation', 'Top-down vs bottom-up DP.'),
  ('Dynamic Programming',   'Dynamic Programming I',  'Overlapping subproblems',   'Why caching helps.'),
  ('Dynamic Programming',   'Dynamic Programming I',  'Optimal substructure',      'Composing optimal solutions.'),
  ('Recursion & Induction', 'Dynamic Programming I',  'Top-down recursion',        'DP formulated as recursion.'),

  -- L5: Greedy & Graph Intro
  ('Greedy Algorithms',     'Greedy & Graph Intro',   'Greedy choice property',    'When local optima are global.'),
  ('Greedy Algorithms',     'Greedy & Graph Intro',   'Activity selection',        'Classic interval scheduling.'),
  ('Greedy Algorithms',     'Greedy & Graph Intro',   'Huffman coding',            'Greedy optimal prefix codes.'),
  ('Graph Algorithms',      'Greedy & Graph Intro',   'Graph representations',     'Adjacency lists vs matrices.'),

  -- L6: BFS, DFS, Hashing
  ('Graph Algorithms',      'BFS, DFS, Hashing',      'Breadth-first search',      'Layered exploration with a queue.'),
  ('Graph Algorithms',      'BFS, DFS, Hashing',      'Depth-first search',        'Recursive exploration with a stack.'),
  ('Graph Algorithms',      'BFS, DFS, Hashing',      'Connected components',      'Counting components via DFS.'),
  ('Hashing',               'BFS, DFS, Hashing',      'Hash tables',               'Average O(1) lookup.'),
  ('Hashing',               'BFS, DFS, Hashing',      'Collision resolution',      'Chaining strategies.'),
  ('Hashing',               'BFS, DFS, Hashing',      'Open addressing',           'Linear/quadratic probing.')
) as sc(concept_label, lecture_title, label, description)
join public.concepts c
  on c.course_id = '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid
 and c.label = sc.concept_label
join public.lectures l
  on l.course_id = '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid
 and l.title = sc.lecture_title
where not exists (
  select 1 from public.subconcepts s
  where s.concept_id = c.id and s.lecture_id = l.id and s.label = sc.label
);

-- ----------------------------------------------------------------------------
-- 5. Vary the test student's mastery scores so the heatmap is interesting.
--    Trigger has already created rows at 0.5 — we just UPDATE them.
-- ----------------------------------------------------------------------------
update public.user_subconcept_mastery m
set score = v.target,
    last_updated = now()
from public.subconcepts s
join public.concepts c on c.id = s.concept_id
join (values
  -- Recursion: strong overall
  ('Base cases',                0.95),
  ('Recursive calls',           0.90),
  ('Mathematical induction',    0.80),
  ('Recurrence relations',      0.75),
  ('Top-down recursion',        0.85),

  -- Asymptotic: developing
  ('Why runtime matters',       0.65),
  ('Big-O notation',            0.60),
  ('Theta and Omega',           0.45),

  -- Sorting: weak
  ('Insertion sort',            0.35),
  ('Selection sort',            0.30),
  ('Sorting lower bounds',      0.20),

  -- Divide & Conquer: mid
  ('Merge sort',                0.55),
  ('Quicksort partitioning',    0.50),
  ('Master theorem',            0.40),

  -- DP: weak (the classic pain point)
  ('Memoization vs tabulation', 0.25),
  ('Overlapping subproblems',   0.30),
  ('Optimal substructure',      0.15),

  -- Greedy: developing
  ('Greedy choice property',    0.45),
  ('Activity selection',        0.55),
  ('Huffman coding',            0.30),

  -- Graphs: solid
  ('Graph representations',     0.75),
  ('Breadth-first search',      0.85),
  ('Depth-first search',        0.80),
  ('Connected components',      0.65),

  -- Hashing: strong
  ('Hash tables',               0.95),
  ('Collision resolution',      0.85),
  ('Open addressing',           0.80)
) as v(label, target) on v.label = s.label
where c.course_id = '8f205a5f-c775-4148-a28d-c5996429ed95'::uuid
  and m.subconcept_id = s.id
  and m.user_id = 'ee70c391-82a2-43ff-8c59-d219c3113332'::uuid;
