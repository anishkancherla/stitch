// Pure types + tiny helpers for Stitch Spaces. No DB, no React.
//
// A `SessionPlan` is the LLM-authored, immutable session script stored on
// `stitch_spaces.plan_json`. The room page indexes into `plan.steps[]` via
// `stitch_spaces.current_step`. Steps are atomic units of "do X then move
// on" — see mdfiles/stitchspaces.md §11 for the three types.
//
// One subconcept always emits a teach/primer step *followed by* a quiz
// step. The planner produces "stitches" (a logical pair) and `expandPlan`
// flattens them into the step array stored on the row.

export const WEAK_THRESHOLD = 0.4;

// Mastery bump applied to user_subconcept_mastery when a target student
// passes the proof quiz for a card. Per user request: linear additive,
// clamped to 1.0, so each pass moves the cell visibly without
// instantly maxing it out.
export const MASTERY_BUMP_ON_PASS = 0.3;

// Per-quiz pass threshold (fraction correct).
export const QUIZ_PASS_FRACTION = 0.6;

// ---------------------------------------------------------------------------
// Step shapes (post-expansion — what's actually stored in plan_json.steps[])
// ---------------------------------------------------------------------------

export type StepType = "teach" | "llm_teach" | "quiz";

export interface BaseStep {
  type: StepType;
  /** Subconcept this step targets. Cards are keyed by subconcept × user. */
  subconceptId: string;
  conceptLabel: string;
  subconceptLabel: string;
}

export interface TeachStep extends BaseStep {
  type: "teach";
  /** The strong student doing the explaining. Only this user clicks Done. */
  teacherUserId: string;
  /** Who is being taught. Their card flips after the next quiz. */
  learnerUserId: string;
  /** Markdown-ish prompt the teacher reads to themselves. */
  instruction: string;
  /** Talking points the teacher can use, lifted from the prof's lecture
   *  material for this subconcept. Hidden from the learner during the
   *  step so the learner can't peek. Empty when the planner had no
   *  materials to ground against. */
  teacherSnippets?: string[];
}

export interface LlmTeachStep extends BaseStep {
  type: "llm_teach";
  /** Both members read the primer and acknowledge with Done. */
  primer: string;
  /** Same provenance as TeachStep.teacherSnippets but visible to BOTH
   *  members — there's no teacher to "give it away" in an llm_teach. */
  snippets?: string[];
}

export interface QuizQuestion {
  prompt: string;
  choices: [string, string, string, string];
  /** Index into choices[]. Server uses this to grade. */
  correctIndex: number;
}

export interface QuizStep extends BaseStep {
  type: "quiz";
  /** Whose card is on the line. Each target submits independently; their
   *  card flips green iff their fraction-correct ≥ QUIZ_PASS_FRACTION. */
  targetUserIds: string[];
  questions: QuizQuestion[];
}

export type SessionStep = TeachStep | LlmTeachStep | QuizStep;

export interface SessionPlan {
  version: 1;
  members: { userId: string; name: string }[];
  steps: SessionStep[];
}

// ---------------------------------------------------------------------------
// What the planner LLM returns. We keep the wire shape flat (one entry per
// weak subconcept) and let the server expand into the SessionStep array so
// the LLM can't get the teach→quiz pairing wrong.
// ---------------------------------------------------------------------------

export type PlannerStitchMode = "peer_teach" | "llm_teach";

export interface PlannerStitch {
  subconceptId: string;
  mode: PlannerStitchMode;
  /** Required when mode === 'peer_teach'. */
  teacherUserId?: string;
  /** 1 entry for peer_teach (the weaker student); 2 entries for llm_teach. */
  learnerUserIds: string[];
  /** Free-text the teacher (or LLM) follows. Plain text or light markdown. */
  teachContent: string;
  questions: QuizQuestion[];
  // teacherSnippets used to live here; we now pipe key_points straight from
  // subconcept_materials in expandPlan() so the snippets users see are
  // literally the prof's bullets — no LLM paraphrasing layer in between.
}

export interface PlannerOutput {
  stitches: PlannerStitch[];
}

// ---------------------------------------------------------------------------
// Card identifiers — cards are per-(subconcept, target_user). A "Both: weak"
// subconcept emits two cards.
// ---------------------------------------------------------------------------

export interface CardId {
  subconceptId: string;
  targetUserId: string;
}

export interface CardRow extends CardId {
  status: "red" | "attempted" | "green";
  conceptLabel: string;
  subconceptLabel: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten the planner's per-subconcept stitches into the linear step list
 *  the room page consumes. Each stitch becomes [teach|llm_teach, quiz].
 *
 *  `materialsBySubId` is the verbatim prof material indexed by subconcept.
 *  `key_points` from the lecture upload are piped DIRECTLY into the
 *  teach/llm_teach step's snippets array — no LLM step touches them, so
 *  what the user sees in the room is literally what the prof's slides
 *  said (modulo Gemini's slide-to-bullet extraction at upload time). */
export function expandPlan(
  stitches: PlannerStitch[],
  meta: Map<string, { conceptLabel: string; subconceptLabel: string }>,
  materialsBySubId?: Map<string, { keyPoints: string[] }>
): SessionStep[] {
  const out: SessionStep[] = [];
  for (const s of stitches) {
    const m = meta.get(s.subconceptId);
    if (!m) continue;
    const mat = materialsBySubId?.get(s.subconceptId);
    // Snippet panel renders ≤4 bullets cleanly; trimming here keeps the
    // visual tight. The full key_points list is still available in DB
    // for future "see all" UI.
    const snippets =
      mat && mat.keyPoints.length > 0 ? mat.keyPoints.slice(0, 4) : undefined;

    if (s.mode === "peer_teach") {
      if (!s.teacherUserId || s.learnerUserIds.length !== 1) continue;
      out.push({
        type: "teach",
        subconceptId: s.subconceptId,
        conceptLabel: m.conceptLabel,
        subconceptLabel: m.subconceptLabel,
        teacherUserId: s.teacherUserId,
        learnerUserId: s.learnerUserIds[0],
        instruction: s.teachContent,
        teacherSnippets: snippets,
      });
      out.push({
        type: "quiz",
        subconceptId: s.subconceptId,
        conceptLabel: m.conceptLabel,
        subconceptLabel: m.subconceptLabel,
        targetUserIds: s.learnerUserIds,
        questions: s.questions,
      });
    } else {
      out.push({
        type: "llm_teach",
        subconceptId: s.subconceptId,
        conceptLabel: m.conceptLabel,
        subconceptLabel: m.subconceptLabel,
        primer: s.teachContent,
        snippets,
      });
      out.push({
        type: "quiz",
        subconceptId: s.subconceptId,
        conceptLabel: m.conceptLabel,
        subconceptLabel: m.subconceptLabel,
        targetUserIds: s.learnerUserIds,
        questions: s.questions,
      });
    }
  }
  return out;
}

/** Which user_ids must submit a response before the room can advance past
 *  this step. Driven entirely by the step shape so the server doesn't have
 *  to special-case at advance time. */
export function requiredRespondents(step: SessionStep, members: string[]): string[] {
  switch (step.type) {
    case "teach":
      return [step.teacherUserId];
    case "llm_teach":
      return [...members];
    case "quiz":
      return [...step.targetUserIds];
  }
}

/** Score an MCQ submission. */
export function gradeQuiz(
  step: QuizStep,
  answers: number[]
): { correct: number; total: number; passed: boolean } {
  const total = step.questions.length;
  let correct = 0;
  for (let i = 0; i < total; i++) {
    if (answers[i] === step.questions[i].correctIndex) correct += 1;
  }
  const passed = total > 0 && correct / total >= QUIZ_PASS_FRACTION;
  return { correct, total, passed };
}
