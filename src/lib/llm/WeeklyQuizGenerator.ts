// Concept-wide quiz authoring. Sibling to SpacesPlanner but with a much
// simpler shape: input is one concept's worth of subconcepts (each with
// its prof material), output is a single flat list of MCQs tagged by
// subconcept so we can per-subconcept-grade attempts later.
//
// The prompt asks for an exact per-subconcept distribution. We post-
// process to make the contract robust: if the model under-delivers on a
// subconcept we keep what we got (don't re-prompt — keeps the demo fast),
// and `normalizeQuestions` from quizSchema.ts handles wire-shape cleanup.

import { QuizQuestion } from "../spaces";
import { normalizeQuestions } from "./quizSchema";
import { callOpenAI, DEFAULT_MODEL } from "./openaiClient";

export interface WeeklyQuizSubconceptInput {
  subconceptId: string;
  subconceptLabel: string;
  /** Prof's 1-2 sentence framing from subconcept_materials. Optional. */
  summary?: string;
  /** Prof's bullet points from subconcept_materials. Optional. */
  keyPoints?: string[];
  /** Number of questions the planner should author for this subconcept. */
  quota: number;
}

export interface WeeklyQuizGenInput {
  courseLabel: string;
  conceptLabel: string;
  subconcepts: WeeklyQuizSubconceptInput[];
}

/** A quiz question annotated with which subconcept it belongs to. */
export interface TaggedQuestion extends QuizQuestion {
  subconceptId: string;
}

export interface WeeklyQuizGenOutput {
  questions: TaggedQuestion[];
}

export class WeeklyQuizGenerator {
  private model: string;

  // Defaults to whatever openaiClient picks (currently gpt-4o-mini). Plenty
  // strong for MCQ authoring; we don't need the full gpt-4o tier here.
  constructor(model: string = DEFAULT_MODEL) {
    this.model = model;
  }

  async generate(input: WeeklyQuizGenInput): Promise<WeeklyQuizGenOutput> {
    if (input.subconcepts.length === 0) {
      throw new Error("WeeklyQuizGenerator: at least one subconcept required");
    }
    const prompt = this.buildPrompt(input);
    const text = await callOpenAI(prompt, { model: this.model, json: true });

    const cleaned = stripFences(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown JSON parse error";
      throw new Error(`Weekly quiz returned invalid JSON: ${msg}\nResponse: ${text}`);
    }

    return normalizeOutput(parsed, input);
  }

  private buildPrompt(input: WeeklyQuizGenInput): string {
    const totalQuota = input.subconcepts.reduce((acc, s) => acc + s.quota, 0);

    const subBlocks = input.subconcepts
      .map((s) => {
        const summary = s.summary ? `  prof_summary: ${s.summary}` : "";
        const kp =
          s.keyPoints && s.keyPoints.length > 0
            ? `\n  prof_key_points:\n${s.keyPoints.map((k) => `    - ${k}`).join("\n")}`
            : "";
        return `- subconcept_id: ${s.subconceptId}
  subconcept: ${s.subconceptLabel}
  questions_to_author: ${s.quota}${summary ? `\n${summary}` : ""}${kp}`;
      })
      .join("\n\n");

    return `You are authoring a weekly quiz for a college course.

Course: ${input.courseLabel}
Concept (this week's umbrella topic): ${input.conceptLabel}

Subconcepts to cover (you MUST author exactly the listed number of questions for each — total = ${totalQuota}). When prof_summary and prof_key_points are present, treat them as ground truth and base the questions and distractors on that framing rather than generic textbook knowledge.

${subBlocks}

Question rules:
- Multiple choice with EXACTLY 4 choices each.
- "correct_index" is an integer 0-3 indicating which choice is correct.
- Distractors must be plausible (test real misconceptions), not joke options.
- Mix difficulty: include some recall-level and some apply-level questions per subconcept.
- Each question MUST carry "subconcept_id" matching one of the IDs above.
- Distribute the questions across subconcepts EXACTLY as listed (do not over- or under-allocate).

Return JSON matching this exact schema, no markdown wrappers, no commentary:

{
  "questions": [
    {
      "subconcept_id": "<one of the IDs above>",
      "prompt": "...",
      "choices": ["...", "...", "...", "..."],
      "correct_index": 0
    }
  ]
}

Output JSON only.`;
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeOutput(
  raw: unknown,
  input: WeeklyQuizGenInput,
): WeeklyQuizGenOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Weekly quiz response is not an object");
  }
  const questionsRaw = (raw as { questions?: unknown }).questions;

  // Reuse the shared normalizer; ask it to pass through subconceptId.
  const normalized = normalizeQuestions(questionsRaw, ["subconceptId"] as const);

  // Filter to ones that point at a real subconcept in the input. Without
  // a valid id we can't per-subconcept grade, so they're useless.
  const validIds = new Set(input.subconcepts.map((s) => s.subconceptId));
  const out: TaggedQuestion[] = [];
  for (const q of normalized) {
    const sid = (q.subconceptId ?? "").trim();
    if (!sid || !validIds.has(sid)) continue;
    out.push({
      prompt: q.prompt,
      choices: q.choices,
      correctIndex: q.correctIndex,
      subconceptId: sid,
    });
  }

  if (out.length === 0) {
    throw new Error("Weekly quiz returned no usable questions");
  }
  return { questions: out };
}

function stripFences(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}
