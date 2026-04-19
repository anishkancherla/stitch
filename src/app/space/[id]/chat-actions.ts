"use server";

// In-room AI for Stitch Spaces. Three callable surfaces, all backed by
// Gemini + the prof's lecture material:
//
//   askStitchAI    — collapsible side-panel chat tutor. Ephemeral.
//   getQuizHint    — per-question Socratic nudge that doesn't reveal the
//                    correct choice.
//   getQuizFeedback — once the learner submits a quiz, returns one
//                    "right because… / wrong because…" line per question.
//                    Server re-grades against `correctIndex` so we don't
//                    trust the client's claim.
//
// All three guard the caller against the room (must be a member) and
// re-load the step from the DB (don't trust client-supplied step shapes).
// Nothing here writes to the DB — chat is intentionally not persisted.

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SessionPlan, QuizStep, QuizQuestion } from "@/lib/spaces";

// ---------------------------------------------------------------------------
// Types returned by these actions
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type AskResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

export type HintResult =
  | { ok: true; hint: string }
  | { ok: false; error: string };

export interface QuizFeedbackItem {
  correct: boolean;
  explanation: string;
}
export type FeedbackResult =
  | {
      ok: true;
      feedback: QuizFeedbackItem[];
      score: { correct: number; total: number };
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// One Gemini client per request is fine — instantiation is cheap and
// keeps each action self-contained.
function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

// Use flash-lite to stay under the free-tier daily quota — `gemini-2.5-flash`
// caps at 20 requests/day on the free tier, and chat/hint/feedback combined
// can blow through that in a single demo session. Flash-lite is plenty for
// these short, well-grounded prompts.
const MODEL = "gemini-2.5-flash-lite";

interface RoomContext {
  step: SessionPlan["steps"][number];
  /** Materials for the step's subconcept. Empty when none extracted. */
  materials: { summary: string; keyPoints: string[] };
}

// Membership guard + step + materials in one helper so each action below
// stays small. Returns null on any failure (caller propagates "not a
// member" / "step not found" without leaking which one failed).
async function loadRoomContext(
  spaceId: string,
  stepIdx: number,
): Promise<RoomContext | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not signed in" };

  const admin = createAdminClient();

  const { data: spaceRow, error: spaceErr } = await admin
    .from("stitch_spaces")
    .select("id, plan_json")
    .eq("id", spaceId)
    .single();
  if (spaceErr || !spaceRow) return { error: "space not found" };

  const { data: memberRow } = await admin
    .from("stitch_space_members")
    .select("user_id")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!memberRow) return { error: "not a member" };

  const plan = spaceRow.plan_json as SessionPlan;
  const step = plan.steps[stepIdx];
  if (!step) return { error: "invalid step" };

  const { data: matRow } = await admin
    .from("subconcept_materials")
    .select("summary, key_points")
    .eq("subconcept_id", step.subconceptId)
    .maybeSingle();

  const summary = String(matRow?.summary ?? "").trim();
  const kpRaw = Array.isArray(matRow?.key_points)
    ? (matRow!.key_points as unknown[])
    : [];
  const keyPoints = kpRaw
    .map((kp) => String(kp ?? "").trim())
    .filter((kp) => kp.length > 0);

  return { step, materials: { summary, keyPoints } };
}

// Build the "this is your context" block we paste into every prompt. Keeps
// the three call sites consistent on how prof material is framed.
function materialsBlock(
  step: SessionPlan["steps"][number],
  materials: { summary: string; keyPoints: string[] },
): string {
  const lines: string[] = [];
  lines.push(`Concept: ${step.conceptLabel}`);
  lines.push(`Subconcept: ${step.subconceptLabel}`);
  if (materials.summary) {
    lines.push(`\nProfessor's framing of this subconcept:\n${materials.summary}`);
  }
  if (materials.keyPoints.length > 0) {
    lines.push(`\nKey points lifted from the professor's slides:`);
    for (const kp of materials.keyPoints) {
      lines.push(`- ${kp}`);
    }
  }
  return lines.join("\n");
}

async function callGemini(prompt: string, asJson = false): Promise<string> {
  const response = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: asJson ? { responseMimeType: "application/json" } : undefined,
  });
  const text = response.text;
  if (!text) throw new Error("empty response from Gemini");
  return text;
}

// Strip ```json fences + slice to the outermost {...}. Same logic as
// LLMProvider.extractJsonString but local so this file doesn't reach into
// a class for a one-liner.
function extractJsonObject(text: string): string {
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

// ---------------------------------------------------------------------------
// askStitchAI — chat tutor for the current step.
// ---------------------------------------------------------------------------

const MAX_HISTORY = 12;
const MAX_MESSAGE_LEN = 2000;

export async function askStitchAI(
  spaceId: string,
  stepIdx: number,
  history: ChatMessage[],
  message: string,
): Promise<AskResult> {
  const ctx = await loadRoomContext(spaceId, stepIdx);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const userMsg = message.trim().slice(0, MAX_MESSAGE_LEN);
  if (!userMsg) return { ok: false, error: "empty message" };

  // Drop overlong history defensively — each chat tab keeps its own
  // message buffer, but a buggy client could send anything.
  const recent = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-MAX_HISTORY);

  const historyBlock =
    recent.length === 0
      ? "(start of conversation)"
      : recent
          .map(
            (m) =>
              `${m.role === "user" ? "Student" : "Stitch AI"}: ${m.content.trim()}`,
          )
          .join("\n");

  const prompt = `You are Stitch AI, a friendly tutor embedded in a peer study session. Your job is to help the student understand the SUBCONCEPT below using the PROFESSOR'S framing of it.

${materialsBlock(ctx.step, ctx.materials)}

Tutoring rules:
- Stay grounded in the professor's framing above. If the student asks about something outside this subconcept, gently redirect.
- Prefer short, direct answers (2-4 sentences). Use a small example if it helps.
- Don't lecture. Match the student's question.
- Never reveal correct answers to a quiz the student is about to take. If they ask "what's the answer to question 2?", redirect them to think it through.
- If the professor's framing doesn't cover what they're asking, say so briefly and answer with general best practices.
- Plain prose. No headings, no markdown lists unless the student asked for a list.

Conversation so far:
${historyBlock}

Student: ${userMsg}

Stitch AI:`;

  try {
    const text = await callGemini(prompt);
    return { ok: true, reply: text.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI call failed";
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getQuizHint — single question, single Socratic nudge.
// ---------------------------------------------------------------------------

export async function getQuizHint(
  spaceId: string,
  stepIdx: number,
  questionIdx: number,
): Promise<HintResult> {
  const ctx = await loadRoomContext(spaceId, stepIdx);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (ctx.step.type !== "quiz") {
    return { ok: false, error: "step is not a quiz" };
  }
  const q = ctx.step.questions[questionIdx];
  if (!q) return { ok: false, error: "question not found" };

  const prompt = `You are giving a HINT to a student about to answer a multiple-choice question. Your hint must NOT reveal which choice is correct, must NOT eliminate any choice, and must NOT restate the question.

${materialsBlock(ctx.step, ctx.materials)}

Question prompt: ${q.prompt}
Choices (in order):
${q.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Write a single-sentence Socratic nudge. Point them to the underlying idea or the relevant key point above without naming a choice. Keep it under 25 words. Plain prose, no quotes, no preface like "Hint:".`;

  try {
    const text = await callGemini(prompt);
    const cleaned = text.trim().replace(/^["'`]|["'`]$/g, "").trim();
    return { ok: true, hint: cleaned };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI call failed";
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getQuizFeedback — post-submit, one explanation per question.
// ---------------------------------------------------------------------------

export async function getQuizFeedback(
  spaceId: string,
  stepIdx: number,
  answers: number[],
): Promise<FeedbackResult> {
  const ctx = await loadRoomContext(spaceId, stepIdx);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (ctx.step.type !== "quiz") {
    return { ok: false, error: "step is not a quiz" };
  }
  const quiz = ctx.step as QuizStep;

  // Server-side re-grading. Don't trust the client's idea of "correct".
  // `answers` is parallel to questions[]; missing/oob entries count wrong.
  const grades: boolean[] = quiz.questions.map((q, i) => {
    const a = answers[i];
    return typeof a === "number" && a === q.correctIndex;
  });
  const correctCount = grades.filter(Boolean).length;

  // One Gemini call for the whole set — cheaper than per-question and the
  // model can keep cross-question context (e.g. avoid repeating itself).
  const questionsBlock = quiz.questions
    .map((q: QuizQuestion, i: number) => {
      const a = answers[i];
      const studentChoiceIdx = typeof a === "number" ? a : -1;
      const studentChoice =
        studentChoiceIdx >= 0 && studentChoiceIdx < q.choices.length
          ? q.choices[studentChoiceIdx]
          : "(no answer)";
      const correctChoice = q.choices[q.correctIndex];
      const isCorrect = grades[i];
      return `Question ${i + 1}: ${q.prompt}
Choices:
${q.choices.map((c, j) => `  ${j + 1}. ${c}`).join("\n")}
Correct choice: "${correctChoice}"
Student picked: "${studentChoice}" (${isCorrect ? "CORRECT" : "WRONG"})`;
    })
    .join("\n\n");

  const prompt = `You are giving per-question feedback on a quiz the student just submitted. For each question, write ONE concise explanation (1-2 sentences) tied to the professor's framing below.

${materialsBlock(ctx.step, ctx.materials)}

${questionsBlock}

Output JSON only — no markdown wrappers, no commentary. Schema:
{
  "feedback": [
    { "explanation": "..." },
    ...
  ]
}

Rules for each explanation:
- If the student was CORRECT: briefly affirm WHY their pick is right, referencing the prof's framing where useful.
- If the student was WRONG: briefly explain WHY the correct choice is right and why their pick was off. Don't shame them.
- Plain prose. No headings, no preface like "Correct!" — just the explanation.
- 1-2 sentences max. Tight.
- The "feedback" array MUST have exactly ${quiz.questions.length} entries in question order.`;

  try {
    const text = await callGemini(prompt, true);
    const parsed = JSON.parse(extractJsonObject(text)) as {
      feedback?: Array<{ explanation?: unknown }>;
    };
    const arr = Array.isArray(parsed.feedback) ? parsed.feedback : [];

    const feedback: QuizFeedbackItem[] = quiz.questions.map((_q, i) => {
      const exp = String(arr[i]?.explanation ?? "").trim();
      return {
        correct: grades[i],
        explanation:
          exp ||
          (grades[i]
            ? "Correct. Your answer matches the professor's framing."
            : "That wasn't quite right — review the key points above and try again next time."),
      };
    });

    return {
      ok: true,
      feedback,
      score: { correct: correctCount, total: quiz.questions.length },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI call failed";
    return { ok: false, error: msg };
  }
}
