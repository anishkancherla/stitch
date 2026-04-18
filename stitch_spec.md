# Stitch — Build Spec

A platform where professors build course knowledge graphs from their syllabi and lectures, quizzes are auto-generated and professor-approved, and students build personalized mastery over those graphs by taking quizzes. Student matching comes last.

---

## 1. Core Flow

The entire product follows one linear pipeline. Everything else is supporting infrastructure.

```
1. Professor uploads syllabus
         ↓
2. LLM extracts top-level CONCEPTS (+ prerequisite edges)
         ↓
3. Professor uploads a lecture (audio file or live transcript)
         ↓
4. LLM extracts SUBCONCEPTS from the lecture, each mapped to a parent concept
         ↓
5. LLM generates quiz questions per subconcept
         ↓
6. Professor reviews & tweaks the quiz (edit, remove, rewrite)
         ↓
7. Professor publishes the quiz to enrolled students
         ↓
8. Students take the quiz on their own time
         ↓
9. Each response updates mastery on the relevant subconcept (and rolls up to parent concept)
         ↓
10. (Later) Matching system pairs students using the mastery graph
```

Everything else — matching, social features, live student flagging, cross-course comparison — is deferred until this backbone works.

---

## 2. Two-Tier Concept Hierarchy

The key structural decision. Mastery data has two levels:

**Concepts** — top-level items extracted from the **syllabus**. Stable across the whole course. Example: "Dynamic Programming," "Graph Traversal."

**Subconcepts** — fine-grained items extracted from **individual lectures**. Each subconcept has a parent concept. Example under "Dynamic Programming": "Memoization vs tabulation," "Overlapping subproblems," "Bottom-up construction."

Why this matters:
- Mastery is tracked at the **subconcept** level (that's where quiz questions live)
- Concept-level mastery is **aggregated** (mean of its subconcepts)
- The UI renders this as a **heatmap grid**: concepts as rows, subconcepts as colored cells within each row
- Matching compares two students' grids cell-by-cell

```
Concept: "Dynamic Programming"
  ├── Subconcept: "Memoization vs tabulation"     (from Lecture 4)
  ├── Subconcept: "Overlapping subproblems"       (from Lecture 4)
  ├── Subconcept: "Knapsack variants"             (from Lecture 5)
  └── Subconcept: "Longest common subsequence"    (from Lecture 5)
```

### 2.1 Heatmap UX (GitHub contribution style)

Every view of mastery is a tight grid of colored cells, same visual language as the GitHub contribution graph.

```
              L1    L2    L3    L4    L5    L6    L7    L8
Recursion     ■     ■     ▪                 ▪
DP            .     .     .     ■     ▪     .     ▫
Graphs        .     .     .     .     .     ■     ■     ■
Greedy        .     .     .     .     .     .     .     ▫
...

Legend: ▫ weak  ▪ developing  ■ strong   . not covered
```

- **Rows** = concepts from the syllabus (~8–20 rows)
- **Columns** = lectures, left-to-right in chronological order (time axis)
- **Cells** = aggregate mastery on that concept from that lecture's subconcepts (mean of subconcepts under concept X covered in lecture Y)
- **Color** = red (weak) → yellow (developing) → green (strong)
- **Empty/grey** = that concept wasn't covered in that lecture
- **Click any cell** → side panel expands showing the individual subconcepts for that (concept, lecture) pair, with their own colors and recent quiz performance

The two-tier hierarchy (concepts → subconcepts) is handled by progressive disclosure rather than cramming both levels into the grid. The grid stays uniform and scannable; subconcept detail is one click away.

Labels: lecture numbers or dates across the top, concept names on the left. Intensity legend in the bottom-right corner.

### 2.2 Views that fall out of the same grid

One component, four features:

**Student personal heatmap** — their own mastery cells. Green = solid, red = needs work.

**Student diff view** — after submitting a quiz, cells that changed briefly animate with the mastery delta shown in the tooltip.

**Professor class heatmap** — same grid, cell color aggregates across all enrolled students. Two toggleable metrics:
- **Average mastery** — mean across the class (shows overall health)
- **% struggling** — % of students below 0.5 mastery (more actionable: red cells = "I need to re-teach this")

Click a cell → anonymized breakdown (counts, not individual names). Privacy preserved by always aggregating.

**Match compare view** — two students' grids side by side, cells highlighted where one is strong and the other is weak. Visually obvious matches: "your red column is their green column."

### 2.3 Why this layout works

- **Time is free** — columns chronological = built-in timeline feel without a separate timeline view
- **Scales** — works with 8 concepts or 40
- **One component, four views** — student, diff, class, compare all render from the same grid primitive with different data sources
- **Familiar** — anyone who's used GitHub immediately understands what they're looking at
- **Zero viz libraries** — plain Tailwind CSS grid

### 2.4 Stitches — the core matching metaphor

When you layer two students' heatmaps, each cell is one of four overlap types:

| Student A | Student B | Meaning |
|---|---|---|
| Green | Green | Redundant — both know it |
| Red | Red | Shared gap — neither can help |
| Green | Red (or vice versa) | **Stitch** — one teaches the other |
| Empty | * | Not covered yet, no signal |

A **stitch** is a single cell where mastery complements. The more stitches between two students, the more they can learn from each other. This is why the app is called Stitch — each pairing is literally a stitch between two heatmaps.

**Pairwise stitch score** between students A and B:
```python
def stitch_score(A, B, cells):
    score = 0
    for cell in cells:
        a, b = A.mastery[cell], B.mastery[cell]
        if a >= 0.7 and b < 0.4:
            score += (a - b)
        elif b >= 0.7 and a < 0.4:
            score += (b - a)
    return score
```
Weighted by the mastery gap so extreme complements count more than marginal ones.

**Personal stitch score** for a student = count of classmates whose pairwise score with them is above a threshold (e.g., 3.0). Answers "how many good partners exist for me in this class?"

**Overlay UX — two modes:**

1. **Side-by-side** — two grids next to each other, stitch cells highlighted in a distinct color across both grids
2. **True overlay** — single merged grid where
   - Green cells = their strength covers your weakness
   - Red cells = your strength covers theirs
   - Grey = no stitch (both strong, both weak, or not covered)
   - Stitch count + total score shown at the top

**Professor group formation:**

- Professor picks group size (2–4) and clicks "Form Groups"
- System partitions the class to maximize total stitch score across all groups
- **Algorithm**: greedy for small classes (match the top-scoring pair first, remove them from the pool, repeat; then fill incomplete groups); local-search swap-and-improve for classes > 30
- Groups render as small heatmap clusters — each group's collective coverage shown as a mini combined grid
- Professor can drag students between groups; total score updates live
- Export roster as CSV or push to LMS

---

## 3. Data Model

### 3.1 Users & courses

```sql
users(id, email, name, role, institution, created_at)
  -- role ∈ { 'professor', 'student' }

courses(id, code, name, institution, professor_id, join_code, status, created_at)
  -- status ∈ { 'draft', 'published', 'archived' }
  -- join_code: short string students use to enroll

enrollments(id, user_id, course_id, enrolled_at)
```

### 3.2 Concept graph

```sql
concepts(id, course_id, label, description, order_index)
prerequisites(from_concept_id, to_concept_id)

subconcepts(id, concept_id, lecture_id, label, description, order_index, created_at)
```

### 3.3 Lectures & transcripts

```sql
lectures(id, course_id, title, uploaded_by, source_type, audio_url,
         started_at, ended_at, status)
  -- source_type ∈ { 'audio_upload', 'live_transcript', 'text_upload' }
  -- status ∈ { 'transcribing', 'extracting', 'ready', 'failed' }

transcripts(id, lecture_id, timestamp_ms, speaker, text)
```

### 3.4 Quizzes

```sql
quizzes(id, lecture_id, course_id, title, status, published_at, due_at)
  -- status ∈ { 'draft', 'published', 'closed' }

quiz_questions(id, quiz_id, subconcept_id, question_text, options_json,
               correct_answer_index, difficulty, order_index, edited_by_professor)

quiz_attempts(id, quiz_id, user_id, started_at, submitted_at, score)

quiz_responses(id, quiz_attempt_id, quiz_question_id, selected_index,
               is_correct, answered_at)
```

### 3.5 Mastery

```sql
user_subconcept_mastery(user_id, subconcept_id, score, last_updated)
  -- score ∈ [0.0, 1.0], default 0.5

mastery_events(id, user_id, subconcept_id, delta, source, source_id, created_at)
  -- source ∈ { 'quiz_response', 'manual', 'initial' }
  -- audit log for debugging and future model training
```

Concept-level mastery is **not stored** — it's computed on read as the mean of the user's subconcept mastery values under that concept.

### 3.6 Matching (computed on demand, mostly)

Pairwise stitch scores are computed on-demand from `user_subconcept_mastery` — no need to cache unless class sizes get huge. When groups are formed, store them:

```sql
study_groups(id, course_id, formed_by, group_size, total_stitch_score, created_at)
group_members(group_id, user_id)
```

Optional cache table for performance (add if scoring gets slow at scale):
```sql
stitch_scores(user_a_id, user_b_id, course_id, score, computed_at)
  -- refreshed when either user's mastery changes
```

---

## 4. Professor Workflow (Detail)

### 4.1 Create a course & upload syllabus

1. Professor signs up, selects role = professor
2. Creates a course: `code`, `name`, `institution`
3. Uploads a syllabus (PDF or pasted text)
4. **Extraction pipeline** runs:
   - LLM reads the syllabus
   - Returns a JSON structure: `{ concepts: [...], prerequisites: [...] }`
   - Validation pass (§6) confirms it looks right
   - Concepts written to DB
5. Professor lands on a concept editor view
   - List of extracted concepts with descriptions
   - Can rename, delete, add concepts manually
   - Can add/remove prerequisite edges via dropdown or simple UI (prereqs are stored but not visualized as a graph — they're just metadata used for matching and future features)
   - Reorder concepts (controls their row order in the heatmap)
6. Hits "Publish" — generates `join_code`, course becomes student-joinable

**Extraction prompt:**
```
You are analyzing a course syllabus. Extract the main course concepts
and their prerequisite relationships.

Return JSON:
{
  "concepts": [
    { "label": "...", "description": "1-2 sentence summary" }
  ],
  "prerequisites": [
    { "from": "<concept label>", "to": "<concept label>" }
  ]
}

Rules:
- 8-20 concepts total. Not too granular — these are course-level topics.
- Prerequisites only for genuine "must-know-X-before-Y" relationships.

Syllabus:
{syllabus_text}
```

### 4.2 Upload a lecture

Three entry points:

- **Audio upload** — professor uploads mp3/m4a/wav → ElevenLabs Scribe API transcribes → text stored
- **Live transcript** — professor hits "Start Live Lecture" → streams mic to ElevenLabs streaming endpoint → transcript populates in real time
- **Text upload** — professor pastes lecture notes directly (fastest path for MVP demos)

Once transcript exists, **subconcept extraction** runs:
```
Given this lecture transcript and the course's list of concepts,
extract the subconcepts covered in this lecture. Each subconcept
must be mapped to exactly one parent concept from the provided list.

Parent concepts: [{id, label, description} for each]
Transcript: {text}

Return JSON:
[
  {
    "parent_concept_id": "...",
    "label": "specific subconcept covered",
    "description": "1-2 sentences"
  }
]
```

Run a validation pass (§6.2) and write to `subconcepts`.

### 4.3 Generate quiz

Professor clicks "Generate Quiz" on a lecture. Pipeline:

1. Pull all `subconcepts` for this lecture
2. For each subconcept, generate 2–3 MCQs:

```
Generate {N} multiple-choice questions testing understanding of this
specific subconcept.

Subconcept: {label}
Description: {description}
Parent concept: {parent_label}
Lecture context: {relevant transcript excerpt, max 500 tokens}

For each question, return:
- question_text
- 4 options
- correct_answer_index (0-3)
- difficulty (1=recall, 2=apply, 3=analyze)

Return JSON array.
```

3. **Quality validator pass**:
```
For each question, verify:
- Tests the tagged subconcept (not a sibling)
- Has exactly one correct answer
- Distractors are plausible but clearly wrong
Remove or flag any that fail.
```

4. Write questions to `quiz_questions` with `status = 'draft'`

### 4.4 Professor reviews & tweaks

Quiz editor UI shows the full draft quiz grouped by subconcept:

- Edit question text inline
- Edit/reorder options
- Flip the correct answer
- Delete a question
- Regenerate a single question ("give me a different one")
- Reorder questions
- Set a due date

Any edit flips `edited_by_professor = true` so we can track which questions are LLM-generated vs. human-refined (useful for quality analysis later).

### 4.5 Publish

Professor clicks "Publish":
- `quizzes.status = 'published'`
- `published_at = now()`
- Students enrolled in the course see the quiz appear in their dashboard
- (Optional) Email/notification

---

## 5. Student Workflow

### 5.1 Enroll

1. Student signs up (role = student)
2. Enters a `join_code` from their professor
3. Added to `enrollments`
4. Initial `user_subconcept_mastery` rows created for every existing subconcept in that course, default score 0.5
5. When new subconcepts are added later (as professor uploads more lectures), a DB trigger backfills a 0.5 row for every enrolled student

### 5.2 Take a quiz

1. Student sees list of published quizzes on their course page
2. Opens a quiz → `quiz_attempts` row created, `started_at = now()`
3. Answers questions one at a time (saves progress per question)
4. Submits → `submitted_at`, score computed

### 5.3 Mastery update on submission

For each response:
- **Correct**, difficulty 1 → `+0.08`
- **Correct**, difficulty 2 → `+0.12`
- **Correct**, difficulty 3 → `+0.18`
- **Incorrect**, any difficulty → `-0.15`
- Clamp to `[0.0, 1.0]`
- Log to `mastery_events`

**Aggregation for parent concept** (computed on read):
```python
concept_mastery(user, concept) = mean(
  user.mastery[sc] for sc in subconcepts where parent_concept_id == concept.id
)
```

### 5.4 Student heatmap view

After submission, student sees:
- Their personalized heatmap (concept rows × lecture columns, colored by subconcept mastery)
- **Before/after delta** — cells that changed from this quiz briefly glow or animate, with a tooltip showing the mastery jump
- Click any cell → side panel with that subconcept's description, recent quiz performance, and related concepts

---

## 6. Validation Layer

Needed at two points: syllabus extraction and subconcept extraction.

### 6.1 Syllabus validation

After extracting concepts from a syllabus:
```
You extracted this concept graph for a course called "{code} - {name}".
Does it look right? Rate confidence 0-1. Flag any concepts that seem
off-topic or out of scope. Flag missing obvious topics.

Graph: {concepts + prerequisites}
```

If confidence < 0.7 → show warnings in the editor UI, but let the professor proceed (they're the authority).

### 6.2 Subconcept validation

After extracting subconcepts from a lecture:
```
For each subconcept, verify:
- It's actually discussed in the transcript (not hallucinated)
- It's correctly mapped to its parent concept (not a sibling)
- It's more specific than the parent (not a duplicate)

Return: { keep: [ids], drop: [ids], remap: [{id, new_parent_id}] }
```

Apply the returned changes before writing to DB.

### 6.3 Quiz validation

Already covered in §4.3 step 3. Runs on every generation.

---

## 7. Tech Stack

Four things. That's it.

| Layer | Choice | Why |
|---|---|---|
| Frontend + Backend | Next.js 14 (App Router) + TypeScript | One app, one deploy. API routes handle all backend logic. |
| Auth + DB + Realtime | Supabase | Auth, Postgres, and Realtime all in one. JS client handles queries directly — no ORM needed. |
| Transcription | ElevenLabs Scribe (batch + streaming) | Per spec |
| LLM | Anthropic SDK (Claude Sonnet) | Reliable structured JSON output |

Styling: Tailwind + shadcn/ui. Heatmap: plain Tailwind CSS grid — no viz library needed. PDF parsing: `unpdf`. Everything else is a file in the Next.js app.

### 7.1 Why Next.js full-stack

- Already using Next.js for frontend — no context-switch, no CORS, no separate deploy
- API routes live next to the frontend code that calls them (`app/api/quizzes/route.ts`)
- Supabase JS client is fully typed; no separate ORM layer to learn
- Vercel Pro gives 60s serverless timeout, enough for every LLM extraction in this app
- Live transcription runs browser → ElevenLabs directly; Next.js just stores the final transcript chunks

### 7.2 Project structure

```
/stitch
  /app
    /(auth)               login / signup pages
    /professor            professor views
    /student              student views
    /api                  all backend logic
      /courses
        /[id]/syllabus/route.ts
        /[id]/lectures/route.ts
      /quizzes
        /[id]/route.ts
        /[id]/publish/route.ts
      /quiz-attempts
        /[id]/submit/route.ts
  /lib
    /supabase.ts          Supabase client
    /anthropic.ts         Claude client + extraction prompts
    /elevenlabs.ts        transcription helpers
    /mastery.ts           mastery update logic
  /components             shared UI
  /types                  TS types for concepts, quizzes, etc.
```

One app, one repo, one `npm run dev`.

### 7.3 Example: API route pattern

```ts
// app/api/courses/[id]/concepts/route.ts
import { supabase } from "@/lib/supabase";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();

  const { data, error } = await supabase
    .from("concepts")
    .insert({ course_id: params.id, ...body })
    .select()
    .single();

  if (error) return Response.json({ error }, { status: 400 });
  return Response.json(data);
}
```

That's the whole pattern. Every backend endpoint looks like this.

---

## 8. Build Phases

Phases are ordered to get end-to-end working fast, then deepen each layer.

### Phase 0 — Auth + data model (day 1)
- Create Supabase project
- Run schema migration in Supabase SQL editor (all tables from §3)
- Scaffold Next.js app with TypeScript + Tailwind
- Install: `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`
- Wire up Supabase Auth with middleware
- Role-based routing (`/professor/*`, `/student/*`)

### Phase 1 — Syllabus → concepts (day 2)
- Professor can create a course
- Syllabus upload (start with pasted text, add PDF later)
- LLM extraction pipeline
- Validation pass
- Concept editor UI (rename, delete, add, edge management)
- Publish course + generate `join_code`

### Phase 2 — Student enrollment + heatmap view (day 3)
- Student signup
- Join-code flow
- Initial mastery rows created
- Read-only heatmap view for students (cells filled as lectures are uploaded, all at 0.5 mastery initially)

### Phase 3 — Lecture → subconcepts (day 4–5)
- Lecture upload (start with text-paste; add audio upload; add live last)
- Transcription integration
- Subconcept extraction pipeline
- Validation pass
- New lecture appears as a new column in the heatmap; extracted subconcepts populate cells in that column

### Phase 4 — Quiz generation + professor tweak (day 6–7)
- Quiz generation pipeline
- Quiz editor UI (edit, regenerate single question, delete, reorder)
- Save as draft
- Publish → students see it

### Phase 5 — Student quiz-taking + mastery updates (day 8)
- Quiz player UI
- Submission pipeline
- Mastery update logic
- Before/after graph diff on completion
- Event logging

### Phase 6 — Live lecture transcription (day 9, optional for v1)
- ElevenLabs streaming integration
- Transcript populates live in professor's view
- On "End Lecture," triggers subconcept extraction automatically

### Phase 7 — Stitches & group formation
- Pairwise stitch score computation endpoint
- Student view: ranked list of classmates by stitch score + overlay UI (side-by-side and true-overlay modes)
- Personal stitch score surfaced on student dashboard
- Professor view: class-wide stitch network
- Group formation algorithm (greedy for < 30 students, local search for larger classes)
- Drag-to-swap interface with live score updates
- Export roster as CSV

---

## 9. Key API Endpoints

```
# Auth
POST /auth/signup
POST /auth/login

# Professor
POST /courses                          create course
POST /courses/:id/syllabus             upload + extract concepts
GET  /courses/:id/concepts             list concepts
PATCH /concepts/:id                    edit concept
POST /concepts                         manual add
DELETE /concepts/:id
POST /prerequisites                    add edge
DELETE /prerequisites/:from/:to
POST /courses/:id/publish              generates join_code

POST /courses/:id/lectures             upload lecture (audio/text/live-start)
WS   /lectures/:id/stream              live transcript
POST /lectures/:id/extract-subconcepts trigger extraction

POST /lectures/:id/generate-quiz       generate draft
GET  /quizzes/:id                      full quiz for editing
PATCH /quiz-questions/:id              edit a question
POST /quiz-questions/:id/regenerate    regenerate single question
DELETE /quiz-questions/:id
POST /quizzes/:id/publish

# Student
POST /enrollments                      { join_code }
GET  /my/courses
GET  /my/courses/:id/heatmap           personalized heatmap data
GET  /my/courses/:id/quizzes           list published quizzes
POST /quizzes/:id/attempts             start attempt
POST /quiz-attempts/:id/responses      submit one answer
POST /quiz-attempts/:id/submit         finalize + update mastery
GET  /my/courses/:id/heatmap/diff      last quiz diff
GET  /my/courses/:id/stitches          ranked list of classmates by stitch score
GET  /my/courses/:id/stitches/:user_id overlay data (stitch cells + score)

# Professor matching
GET  /courses/:id/class-heatmap        aggregated class heatmap
POST /courses/:id/form-groups          { group_size } → suggested partition
PATCH /study-groups/:id/members        swap students between groups
```

---

## 10. Open Questions

1. **PDF parsing for syllabi/lectures** — start with pasted text in Phase 1/3 to avoid PDF extraction complexity. Add PDF support as a Phase 1.5.
2. **Regeneration cost** — professor hitting "regenerate" on 20 questions in a row burns tokens. Rate limit to N/min per professor.
3. **Lecture-to-subconcept granularity** — should subconcepts from Lecture 5 on the same parent concept as Lecture 4 be merged if near-duplicates? v0: no, keep them lecture-scoped. v1: add a dedupe pass.
4. **Quiz retakes** — can a student retake a quiz? v0: no (one attempt, cleanest mastery signal). v1: yes with diminishing weight.
5. **Unenrolled students seeing old quizzes** — cascade-hide vs. soft-archive. v0: hide on unenroll.
6. **Professor co-teaching** — multiple professors on one course? v0: single owner.

---

## 11. Success Metrics

- **Extraction quality** — professors accept >80% of LLM-extracted concepts without edits
- **Quiz quality** — professors accept >60% of LLM-generated questions without edits
- **Mastery divergence** — after 3 quizzes, pairwise mastery distance between students in the same course > 0.2 (if near zero, the update signal is broken)
- **Quiz completion rate** — >70% of students who start a quiz finish it
- **Time-to-publish** — professor can go from "lecture uploaded" to "quiz published" in under 10 minutes including tweaks
- **Stitch density** — after 3 quizzes, the median student has ≥3 classmates with stitch score above threshold (means matching has real signal to work with)
- **Group formation quality** — auto-formed groups score ≥80% of the optimal partition's total stitch score