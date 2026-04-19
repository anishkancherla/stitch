# Quiz Integration Plan

End-to-end plan for surfacing quiz generation in the professor UI, supporting MCQ + FRQ + inline editing, and (future-phase) student quiz-taking with mastery updates including LLM-graded FRQs.

This plan is the working contract. If a decision in here disagrees with `stitch_spec.md`, this doc wins for the quiz subsystem.

---

## 0. Decisions locked in (from clarifying Q&A)

| Question | Choice |
|---|---|
| Where prof clicks "Generate Quiz" | Separate **Quizzes** section on the course page, one row per concept with a Generate button |
| MCQ ↔ FRQ toggle | Per-quiz, switchable post-generation; switching = regenerate every question (with confirm) |
| Persistence | Multiple quizzes per concept, versioned drafts |
| Edit UX | Inline editable fields with an explicit "Save changes" button |
| Edit operations (v1) | Edit text, edit MCQ choices, edit MCQ answer, edit FRQ model answer, **add** new question, **reorder** questions. (No single-question delete or LLM-regenerate yet.) |
| Subconcept scope | All subconcepts under the concept |
| LLM provider | Configurable (`QUIZ_LLM_PROVIDER` env var, default `gemini`) |
| Student flow (now) | Show correct answers + LLM feedback after submission |
| Student flow defaults inherited from `stitch_spec.md` | One question per page, single attempt v0 |
| FRQ → mastery | Scaled MCQ: `delta = mcq_delta_for_difficulty * llm_rating` (correct branch); on incorrect, scale the −0.15 penalty by `(1 − rating)` |
| Schema | New migration `0006_quiz_mcq_frq.sql` (no jsonb-payload shortcut) |

---

## 1. Phasing

We ship in three phases so the prof flow is usable before the student flow lands.

### Phase A — Schema + provider plumbing
1. New migration `0006_quiz_mcq_frq.sql` (see §3)
2. Provider `LLMProvider` gets a new `gradeFreeResponse(...)` abstract method + base prompt
3. Provider factory (`src/lib/llm/index.ts` or similar) reads `QUIZ_LLM_PROVIDER`
4. Server actions module `src/app/professor/courses/[id]/quiz-actions.ts`

### Phase B — Professor quiz UI
1. New "Quizzes" section on `src/app/professor/courses/[id]/page.tsx`
2. New page `src/app/professor/courses/[id]/quizzes/[quizId]/page.tsx` (full editor)
3. Editor is one client component with inline fields + "Save changes" button + "Switch to FRQ/MCQ" + "Publish"

### Phase C — Student quiz-taker + mastery
1. Student dashboard / course page lists published quizzes for that concept
2. `src/app/student/courses/[id]/quizzes/[quizId]/page.tsx` — one-question-per-page taker
3. Submission action computes mastery deltas (MCQ deterministic, FRQ via `gradeFreeResponse`)
4. Result screen: per-question correctness + (FRQ) LLM feedback + ribbon refresh

We can demo at the end of Phase B (no students need to take it for the prof flow to be impressive).

---

## 2. Data model changes

### 2.1 Migration `supabase/migrations/0006_quiz_mcq_frq.sql`

```sql
-- New enum: question type
do $$ begin
  create type question_type as enum ('mcq', 'frq');
exception when duplicate_object then null; end $$;

-- Quizzes: anchor to a concept (currently only anchored to lecture/course)
alter table public.quizzes
  add column if not exists concept_id uuid references public.concepts(id) on delete cascade,
  add column if not exists question_format question_type not null default 'mcq',
  add column if not exists version integer not null default 1;

create index if not exists quizzes_concept_id_idx on public.quizzes(concept_id);

-- Quiz questions: support FRQ + free-text answers
alter table public.quiz_questions
  add column if not exists question_type question_type not null default 'mcq',
  add column if not exists correct_answer_text text;

-- Loosen MCQ-only NOT NULLs (FRQs have neither)
alter table public.quiz_questions
  alter column options_json drop not null,
  alter column correct_answer_index drop not null;

-- Integrity: require the right shape for each type
alter table public.quiz_questions
  drop constraint if exists quiz_questions_shape_chk;
alter table public.quiz_questions
  add constraint quiz_questions_shape_chk check (
    (question_type = 'mcq'
       and options_json is not null
       and correct_answer_index is not null
       and correct_answer_text is null)
    or
    (question_type = 'frq'
       and options_json is null
       and correct_answer_index is null
       and correct_answer_text is not null)
  );

-- Quiz responses: free-text + LLM grade
alter table public.quiz_responses
  add column if not exists response_text text,
  add column if not exists llm_score double precision check (llm_score between 0 and 1),
  add column if not exists llm_feedback text;
```

### 2.2 RLS

The existing `quizzes_prof_all`, `quiz_questions_prof_all`, `quiz_attempts_self`, `quiz_responses_self` policies already cover the new columns (column-level RLS is not in play here). No new policies needed.

We will however need to allow students to **read their own** `llm_score` / `llm_feedback` after grading — `quiz_responses_self` already does that. No change.

### 2.3 `quiz_status` semantics

Reuse the existing enum:
- `draft` — being edited by professor
- `published` — visible to students
- `closed` — past due_at, no new attempts

"Multiple versioned drafts per concept" maps to: many `quizzes` rows with the same `concept_id`, each with its own `version` (auto-incremented in the action) and `status`. A concept can have **at most one** `status='published'` quiz at a time; publishing a new one closes the previous published one (transactional in the action).

---

## 3. Provider layer

### 3.1 New abstract method on `LLMProvider`

```ts
export interface FRQGradeInput {
  question: string;
  modelAnswer: string;
  studentAnswer: string;
}
export interface FRQGradeResult {
  rating: number;     // 0..1
  feedback: string;   // 1-3 short sentences for the student
}
abstract gradeFreeResponse(input: FRQGradeInput): Promise<FRQGradeResult>;
```

Base class provides `buildGradePrompt(input)` returning a strict-JSON prompt:

```
Return JSON with no markdown wrappers:
{ "rating": 0.0, "feedback": "..." }

rating: 0.0 = unrelated/wrong, 0.5 = partially correct, 1.0 = matches the model answer in spirit and detail.
feedback: 1-3 sentences. Address the student in second person. Point out what was missing or wrong; don't restate the model answer verbatim.
```

Implement `gradeFreeResponse` in both `GeminiProvider` and `AnthropicProvider`. Reuse `extractJsonString` for parsing.

### 3.2 Configurable factory

New file `src/lib/llm/index.ts`:

```ts
export type ProviderName = 'gemini' | 'anthropic';

export function getQuizProvider(): LLMProvider {
  const name = (process.env['QUIZ_LLM_PROVIDER'] ?? 'gemini') as ProviderName;
  return name === 'anthropic' ? new AnthropicProvider() : new GeminiProvider();
}
```

All quiz server actions go through this. `lecture-actions` and `syllabus-actions` continue to use `GeminiProvider` directly (they're tied to file uploads where Gemini's Files API is convenient); we can migrate them later.

---

## 4. Server actions

All in `src/app/professor/courses/[id]/quiz-actions.ts`. Each action returns a `Result<T>` discriminated union, same style as `lecture-actions.ts`.

### 4.1 `generateQuiz({ courseId, conceptId, format })`

- Owns course? `concept.course_id === courseId`?
- Pull subconcepts under that concept (any lecture).
- Determine `version`: `max(version) + 1` for `(course_id, concept_id)`.
- Call `getQuizProvider().generateQuiz({ concept, subconcepts }, format === 'mcq')`.
- Insert `quizzes` row (status=`draft`, format, version, title=`"Quiz: <concept> v<n>"`).
- Insert `quiz_questions` rows with the right shape per `question_type`.
  - For MCQ, `correct_answer_index` is derived by matching the LLM's `answer` string against `choices` (case-insensitive trim). If no match, fall back to index 0 and mark `edited_by_professor=false` so the prof can fix it.
  - `subconcept_id`: the LLM doesn't tag questions, so we leave this NULL for v1. (Future: ask the LLM to tag, then map back. Mastery still works at concept level — see §6.)
- `revalidatePath`, return `{ ok: true, quizId }`.

### 4.2 `regenerateQuizFormat({ quizId, newFormat })`

Used when prof flips MCQ↔FRQ on an existing draft. Action requires confirmation in the UI (prof loses any inline edits). Implementation:
- Verify ownership and that quiz is `draft`.
- Read concept + subconcepts via the quiz's `concept_id`.
- Generate fresh questions in `newFormat`.
- Inside a single transaction (use Supabase RPC or just a sequence — RLS already gates ownership), `delete` old `quiz_questions` for the quiz and insert new ones; update `quizzes.question_format`.

### 4.3 `saveQuiz({ quizId, questions })`

Called by the editor "Save changes" button. `questions` is the full ordered array from the client. Action:
- Verify ownership + `status='draft'`.
- Re-validate every question's shape against `quiz_questions_shape_chk`.
- For new question rows (no id), `insert`; for existing, `update`; for missing-from-payload, `delete`. (We don't expose delete as its own button in v1, but the action supports it for safety / future.)
- Set `edited_by_professor = true` on any row whose text/choices/answer differ from what's in DB.
- Renumber `order_index` according to array order.

This is "save the entire quiz" semantics — simpler client logic and avoids a per-field PATCH endpoint.

### 4.4 `publishQuiz({ quizId, dueAt? })`

- Verify ownership + draft.
- Inside a transaction:
  - `update quizzes set status='closed' where concept_id=$1 and status='published'`
  - `update quizzes set status='published', published_at=now(), due_at=$2 where id=$3`
- Revalidate professor + student paths.

### 4.5 `deleteQuiz({ quizId })`

Hard delete (cascade removes questions/attempts). Disallowed if `status='published'` and any attempts exist; otherwise allowed.

---

## 5. Professor UI

### 5.1 Course page — new "Quizzes" section

`src/app/professor/courses/[id]/page.tsx` — add a section below the ribbon:

```
Quizzes
─────────────────────────────────────────────
Concept                Latest quiz       Action
Algorithms             v3 · published    [Manage] [Generate new]
Data Structures        v1 · draft        [Manage] [Generate new]
Recursion              —                  [Generate]
```

- Render one row per concept (reuse the `concepts` query already on the page).
- For each concept, look up its newest quiz (single SQL: `select id, version, status from quizzes where course_id=$1 order by concept_id, version desc`).
- "Generate new" opens a tiny `GenerateQuizDialog` (client component) with the **MCQ ↔ FRQ toggle** + Generate button. This is a `useFormState` call to `generateQuiz`. On success → `router.push` to the editor.
- "Manage" → navigates to the editor for that quiz.

### 5.2 Quiz editor page

New route: `src/app/professor/courses/[id]/quizzes/[quizId]/page.tsx`.

Server component:
- Fetches `quizzes`, `quiz_questions` (ordered), and the parent concept + subconcept labels (for context display).
- Renders header (concept name, version, status, due date if set) and embeds the client editor.

Client component `QuizEditor.tsx`:
- Local state mirrors the question array (no autosave; "Save changes" is the only commit path).
- "Mode" segmented control (MCQ / FRQ) — switching calls `regenerateQuizFormat` after a `confirm()` modal.
- Per-question card:
  - **Question text** — `<textarea>` autoresizing
  - **MCQ**: 4 `<input>` choices; radio button to mark which is correct.
  - **FRQ**: single `<textarea>` for the model answer.
  - Drag-handle for reorder (use `@dnd-kit/sortable` — already a small dep, can confirm in Phase B).
- "Add question" button at the bottom: appends an empty MCQ or FRQ depending on quiz format.
- Bottom action bar: "Save changes" (disabled if no diff), "Publish quiz" (disabled if there are unsaved changes — prof must save first), "Delete quiz" (with confirm).
- Show a small badge on any question whose `edited_by_professor=true` so the prof can see what they've touched.

Validation rules enforced client-side (mirror server check):
- MCQ: 4 non-empty choices, exactly one selected as correct.
- FRQ: non-empty `correct_answer_text`.
- All: non-empty `question_text`.

---

## 6. Student flow (Phase C)

### 6.1 Listing published quizzes

On `src/app/student/courses/[id]/page.tsx`, add a "Quizzes" section (mirror prof section visually):
- One row per concept that has a published quiz.
- Show "Take quiz" if no submitted attempt for this user, else "Review" with the score.

### 6.2 Quiz taker

Route: `src/app/student/courses/[id]/quizzes/[quizId]/page.tsx`.

- On entry, server action `startAttempt({ quizId })` upserts a `quiz_attempts` row (one per user per quiz; 409 if already submitted).
- Client component renders one question at a time with Prev/Next/Submit. Per-question save action `saveResponse({ attemptId, questionId, selectedIndex?, responseText? })` writes to `quiz_responses` on Next.
- Final "Submit" calls `submitAttempt({ attemptId })`.

### 6.3 Submit + grading

`submitAttempt`:
1. Load all `quiz_responses` for this attempt + their `quiz_questions`.
2. For each MCQ response: `is_correct = selected_index === correct_answer_index`.
3. For each FRQ response: call `getQuizProvider().gradeFreeResponse({ question, modelAnswer, studentAnswer })`. Store `llm_score`, `llm_feedback`. (We grade in parallel via `Promise.all`; cap concurrency at 5.)
4. Compute `score` for the attempt (overall percentage):
   - MCQ: `is_correct ? 1 : 0`
   - FRQ: `llm_score`
   - Average across questions.
5. Compute mastery deltas per question and roll up to subconcepts.

### 6.4 Mastery delta math

Per-question delta (then applied to the question's `subconcept_id` when present, else split equally across all subconcepts under the parent concept — that's our v1 fallback since we don't tag questions yet):

| Type | Branch | Delta |
|---|---|---|
| MCQ correct | `+0.08 / +0.12 / +0.18` (by difficulty 1/2/3) | unchanged from spec |
| MCQ incorrect | `-0.15` | unchanged |
| FRQ rating ≥ 0.5 | `mcq_correct_delta_for_difficulty * rating` | scaled MCQ |
| FRQ rating < 0.5 | `-0.15 * (1 - rating)` | scaled MCQ (rating 0 → full -0.15; rating 0.49 → -0.077) |

Clamp final mastery to `[0, 1]`. Log every change to `mastery_events` with `source='quiz_response'`, `source_id=quiz_response.id`.

### 6.5 Result page

After submit, redirect to `/student/courses/[id]/quizzes/[quizId]/result` showing:
- Overall score and per-question correctness.
- For MCQ wrong: highlight the right answer.
- For FRQ: show student answer, model answer, LLM rating bar, LLM feedback.
- Link back to the heatmap so the student sees the freshly-updated cells (the realtime ribbon refresher already handles auto-refresh on mastery writes).

---

## 7. Files to add / change

```
supabase/migrations/0006_quiz_mcq_frq.sql                   NEW
src/lib/llm/LLMProvider.ts                                  +gradeFreeResponse, +FRQ types, +buildGradePrompt
src/lib/llm/GeminiProvider.ts                               +gradeFreeResponse impl
src/lib/llm/AnthropicProvider.ts                            +gradeFreeResponse impl
src/lib/llm/index.ts                                        NEW factory
src/app/professor/courses/[id]/page.tsx                     +Quizzes section render
src/app/professor/courses/[id]/quiz-actions.ts              NEW (generate / regen / save / publish / delete)
src/app/professor/courses/[id]/QuizListSection.tsx          NEW (server component, per-concept rows)
src/app/professor/courses/[id]/GenerateQuizDialog.tsx       NEW client component
src/app/professor/courses/[id]/quizzes/[quizId]/page.tsx    NEW (server)
src/app/professor/courses/[id]/quizzes/[quizId]/QuizEditor.tsx  NEW (client, the big one)
src/app/student/courses/[id]/page.tsx                       +Quizzes list section
src/app/student/courses/[id]/quizzes/[quizId]/page.tsx      NEW taker
src/app/student/courses/[id]/quizzes/[quizId]/QuizTaker.tsx NEW client
src/app/student/courses/[id]/quizzes/[quizId]/result/page.tsx  NEW result
src/app/student/courses/[id]/quiz-actions.ts                NEW (start / saveResponse / submit)
src/lib/mastery.ts                                          NEW central delta math (so prof + student paths agree)
scripts/testGenerateQuiz.ts                                 keep as-is for ad-hoc testing
scripts/testGradeFRQ.ts                                     NEW small smoke script for gradeFreeResponse
```

---

## 8. Edge cases & gotchas

1. **MCQ `answer` not in `choices`** — the model occasionally returns an answer string that doesn't exactly match any choice. We fall back to `correct_answer_index = 0` and surface a `[needs review]` badge in the editor instead of failing the whole generation.
2. **Empty subconcept list** — disallow Generate (button disabled with tooltip "Upload a lecture under this concept first").
3. **Switching MCQ↔FRQ on a quiz the prof has already heavily edited** — `regenerateQuizFormat` blows away their work. The confirm dialog must show question count + "this cannot be undone".
4. **Publishing while another version is published** — handled atomically in `publishQuiz` (close the old, publish the new). The student page should always show only the currently-published version.
5. **Student attempt against a quiz that gets `closed`** — if `submitted_at` is null and `due_at` is past, the submit action accepts but flags the attempt as late (no penalty for v1; just a UI badge).
6. **FRQ grading failure** — if the LLM call throws, we set `llm_score = null`, store the error in `llm_feedback`, and treat that question's mastery delta as 0 (no change). Prof can re-grade later (future feature).
7. **Concurrent edits by two prof tabs** — `saveQuiz` is last-write-wins on the question rows. Acceptable for v1; revisit with optimistic concurrency (`updated_at` check) if it bites.
8. **Realtime** — no need to enable realtime on `quizzes` / `quiz_questions` for v1. The ribbon refresher already covers mastery writes after a student submits.

---

## 9. Future additions (explicitly out of scope for this plan)

- LLM "regenerate this single question" button.
- Per-question delete in the editor (the action supports it; just not exposed).
- Question difficulty editing in the UI (defaults to 1 for now; the LLM doesn't yet rate difficulty).
- Student retakes with diminishing weight.
- FRQ appeal / re-grade request flow.
- Tagging each generated question with its `subconcept_id` so mastery deltas land on the precise cell instead of being split. Requires extending the quiz-gen prompt to return a per-question subconcept tag and matching it back.
- Bulk publish across multiple concepts.
- Versions diff view (compare draft v3 to published v2).
- Quiz analytics for the professor (per-question accuracy across the class).

---

## 10. Acceptance checklist

Phase A — schema + provider:
- [ ] Migration runs cleanly on a fresh Supabase project
- [ ] `gradeFreeResponse` returns parseable `{ rating, feedback }` for both providers
- [ ] `getQuizProvider()` honors `QUIZ_LLM_PROVIDER`

Phase B — professor:
- [ ] Generate creates a draft and routes to the editor
- [ ] Editor renders MCQ + FRQ correctly; inline edits persist after Save
- [ ] Switching format regenerates with confirm
- [ ] Publish closes any prior published version atomically
- [ ] All actions enforce ownership + RLS

Phase C — student:
- [ ] Student sees only published quizzes for their enrolled courses
- [ ] One question per page; progress saves
- [ ] Submit grades MCQs deterministically and FRQs via LLM
- [ ] Mastery deltas apply with the §6.4 math, logged in `mastery_events`
- [ ] Result page shows correct answers + FRQ feedback
- [ ] Heatmap reflects new mastery within ~1s via realtime refresher
