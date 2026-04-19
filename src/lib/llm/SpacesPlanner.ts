import { GoogleGenAI } from "@google/genai";
import {
  PlannerOutput,
  PlannerStitch,
} from "../spaces";
import { normalizeQuestions } from "./quizSchema";

/**
 * Plan a Stitch Space session.
 *
 * Inputs are the union of weak subconcepts across both students plus per-
 * subconcept mastery so the LLM knows who teaches whom. Output is the
 * `PlannerOutput` shape from src/lib/spaces.ts — server expands it into
 * the linear step list before storing.
 *
 * Single Gemini call: the prompt asks for ordered stitches AND the quiz
 * questions for each. Round-trip per-stitch would be slower and offers
 * no real win for a 4-8 stitch session.
 */

export interface PlannerWeakItem {
  subconceptId: string;
  subconceptLabel: string;
  conceptLabel: string;
  /** Per-student mastery in [0,1]. Keys are the two member user_ids. */
  masteryByUser: Record<string, number>;
  /** Optional 1-2 sentence digest of the prof's framing of this
   *  subconcept (from subconcept_materials). Empty when no lecture
   *  material was extracted for this subconcept. */
  summary?: string;
  /** Optional 4-7 short bullets pulled from the prof's slides. The
   *  planner echoes these into the teach instruction and quiz
   *  distractors, AND surfaces a curated subset back as teacher_snippets
   *  on the resulting stitch. */
  keyPoints?: string[];
}

export interface PlannerInput {
  members: { userId: string; name: string }[];
  weakItems: PlannerWeakItem[];
  /** Threshold below which a student is "weak" on the subconcept. */
  weakThreshold: number;
}

export class SpacesPlanner {
  private ai: GoogleGenAI;
  private model: string;

  // Flash-lite for free-tier headroom — plain `gemini-2.5-flash` caps at
  // 20 requests/day on the free tier, which gets eaten quickly between
  // planner + chat + hint + feedback + weekly-quiz. Flash-lite handles
  // the planner prompt fine and has a much larger daily allowance.
  constructor(model = "gemini-2.5-flash-lite") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Add it to your .env file.");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const prompt = this.buildPrompt(input);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) throw new Error("No text returned from Gemini API");

    const cleaned = stripFences(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown JSON parse error";
      throw new Error(`Planner returned invalid JSON: ${msg}\nResponse: ${text}`);
    }

    return normalizePlannerOutput(parsed, input);
  }

  private buildPrompt(input: PlannerInput): string {
    const memberLines = input.members
      .map((m) => `- ${m.name}  (user_id: ${m.userId})`)
      .join("\n");

    const weakLines = input.weakItems
      .map((w) => {
        const masteryLines = input.members
          .map((m) => {
            const score = w.masteryByUser[m.userId] ?? 0.5;
            const label = score < input.weakThreshold ? "WEAK" : "OK";
            return `    ${m.name}: ${score.toFixed(2)} (${label})`;
          })
          .join("\n");
        const summaryLine = w.summary
          ? `\n  prof_summary: ${w.summary}`
          : "";
        const keyPointsBlock =
          w.keyPoints && w.keyPoints.length > 0
            ? `\n  prof_key_points:\n${w.keyPoints
                .map((kp) => `    - ${kp}`)
                .join("\n")}`
            : "";
        return `- subconcept_id: ${w.subconceptId}
  parent concept: ${w.conceptLabel}
  subconcept: ${w.subconceptLabel}
  mastery:
${masteryLines}${summaryLine}${keyPointsBlock}`;
      })
      .join("\n\n");

    return `You are designing a synchronous, two-student peer study session called a "Stitch Space".

Two students are on a voice call (Zoom/Discord) and follow your script step by step. You direct everything: who teaches what, in what order, and you author the quiz questions used to verify the weaker student actually learned the concept.

The students:
${memberLines}

Weak subconcepts (one or both students has mastery < ${input.weakThreshold}). When prof_summary and prof_key_points are present, they are extracted directly from the professor's lecture material — TREAT THEM AS GROUND TRUTH and base everything (teach_content, questions, teacher_snippets) on that framing rather than generic textbook knowledge.

${weakLines}

Your job: emit one "stitch" per weak subconcept above, in the pedagogical order YOU think is best (e.g. start with foundational concepts, alternate teachers so neither student is just teaching for 30 minutes, etc.).

For each stitch:
- If exactly ONE student is WEAK on this subconcept, mode = "peer_teach" — the OTHER (stronger) student teaches. Set teacher_user_id to the strong student and learner_user_ids = [the weak student].
- If BOTH students are WEAK, mode = "llm_teach" — you teach both via a primer. Omit teacher_user_id and set learner_user_ids = [both user_ids].

teach_content:
- For peer_teach: a focused 2–4 sentence instruction TO the teacher describing what they need to cover (e.g. "Walk Adam through how recursion uses base cases vs recursive cases. Use a concrete example like factorial. Then make sure he can describe what would happen with no base case."). Address the teacher by name. When prof_key_points exist, reference at least one of them by name in the instruction so the teacher knows the prof's specific framing.
- For llm_teach: a clear 4–8 sentence primer that teaches the subconcept directly to BOTH students. Plain prose, no headings. Use the prof's framing where available.

NOTE: A separate snippet panel will display prof_key_points to the teacher (or both students, in llm_teach) verbatim — you do NOT need to author or repeat them in teach_content. Just point at them, e.g. "Walk Olivia through the points in your snippet panel about base cases vs recursive cases."

questions: 3 multiple-choice questions to verify the learner(s) actually understand the subconcept. Each question:
- "prompt": a single concrete question
- "choices": exactly 4 plausible options (no "all of the above")
- "correct_index": integer 0–3 indicating which choice is correct
Distractors should be wrong-but-plausible — avoid joke options. When prof_key_points exist, pull at least one distractor from a real misconception related to one of those points.

Return JSON matching this exact schema, no markdown wrappers, no commentary:

{
  "stitches": [
    {
      "subconcept_id": "<copy from input>",
      "mode": "peer_teach" | "llm_teach",
      "teacher_user_id": "<user_id, or omit if llm_teach>",
      "learner_user_ids": ["<user_id>", ...],
      "teach_content": "...",
      "questions": [
        { "prompt": "...", "choices": ["...", "...", "...", "..."], "correct_index": 0 }
      ]
    }
  ]
}

Hard rules:
- Output ONE stitch per weak subconcept above. Do not invent new subconcepts.
- subconcept_id MUST be one of the IDs listed above.
- All user_ids referenced MUST be one of the two listed above.
- For peer_teach: teacher_user_id must be the student who is OK on the subconcept; learner_user_ids must contain only the WEAK student.
- Output JSON only.`;
  }
}

// ---------------------------------------------------------------------------
// Normalisation. The LLM is reliable but not infallible — clamp the output
// to the schema callers actually expect, drop malformed stitches rather
// than crash the whole session.
// ---------------------------------------------------------------------------

function normalizePlannerOutput(
  raw: unknown,
  input: PlannerInput
): PlannerOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Planner response is not an object");
  }
  const stitchesIn = (raw as { stitches?: unknown }).stitches;
  if (!Array.isArray(stitchesIn)) {
    throw new Error("Planner response missing `stitches` array");
  }

  const validSubIds = new Set(input.weakItems.map((w) => w.subconceptId));
  const validUserIds = new Set(input.members.map((m) => m.userId));

  const out: PlannerStitch[] = [];
  for (const s of stitchesIn) {
    if (!s || typeof s !== "object") continue;
    const obj = s as Record<string, unknown>;
    const subconceptId = String(obj.subconcept_id ?? "");
    if (!validSubIds.has(subconceptId)) continue;

    const mode = obj.mode === "llm_teach" ? "llm_teach" : "peer_teach";
    const learners = Array.isArray(obj.learner_user_ids)
      ? (obj.learner_user_ids as unknown[])
          .map(String)
          .filter((u) => validUserIds.has(u))
      : [];
    if (learners.length === 0) continue;

    const teacherUserId =
      mode === "peer_teach" ? String(obj.teacher_user_id ?? "") : undefined;
    if (
      mode === "peer_teach" &&
      (!teacherUserId ||
        !validUserIds.has(teacherUserId) ||
        learners.includes(teacherUserId) ||
        learners.length !== 1)
    ) {
      continue;
    }

    const teachContent = String(obj.teach_content ?? "").trim();
    if (!teachContent) continue;

    const questions = normalizeQuestions(obj.questions);
    if (questions.length === 0) continue;

    out.push({
      subconceptId,
      mode,
      teacherUserId,
      learnerUserIds: learners,
      teachContent,
      questions,
    });
  }

  if (out.length === 0) {
    throw new Error("Planner returned no usable stitches");
  }
  return { stitches: out };
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
