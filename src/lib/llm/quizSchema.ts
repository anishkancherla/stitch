// Shared quiz-question normalizer used by both planners (SpacesPlanner +
// WeeklyQuizGenerator) so they stay in sync on the on-the-wire schema.
//
// The wire shape uses snake_case (correct_index) because that's what the
// LLM tends to emit naturally; we translate to camelCase QuizQuestion at
// this boundary. Anything malformed is silently dropped — callers handle
// the empty-list case (re-prompt, fall back, etc).

import type { QuizQuestion } from "../spaces";

/**
 * Normalize a parsed `questions` array from an LLM response.
 *
 * Each entry must have:
 *   - prompt: non-empty string
 *   - choices: exactly 4 non-empty strings
 *   - correct_index OR correctIndex: integer in [0, 3]
 *
 * Optionally, each question may carry extra metadata fields (like
 * `subconcept_id`) used by the weekly-quiz pipeline to per-subconcept
 * grade. Pass `extraKeys` to preserve those on the returned objects.
 *
 * Return type is QuizQuestion & Record<extra keys, string> so weekly-quiz
 * callers can `q.subconceptId` without further casting.
 */
export function normalizeQuestions<E extends string = never>(
  raw: unknown,
  extraKeys: readonly E[] = [] as unknown as readonly E[],
): Array<QuizQuestion & { [K in E]?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<QuizQuestion & { [K in E]?: string }> = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const obj = q as Record<string, unknown>;

    const prompt = String(obj.prompt ?? "").trim();
    const choicesRaw = obj.choices;
    if (!prompt || !Array.isArray(choicesRaw) || choicesRaw.length !== 4) {
      continue;
    }
    const choices = choicesRaw.map((c) => String(c).trim());
    if (choices.some((c) => !c)) continue;

    // Tolerate either snake_case or camelCase from the model. Some
    // providers default-case the JSON keys differently, so we accept both.
    const ciRaw =
      obj.correct_index !== undefined ? obj.correct_index : obj.correctIndex;
    const correctIndex =
      typeof ciRaw === "number" && Number.isInteger(ciRaw) ? ciRaw : -1;
    if (correctIndex < 0 || correctIndex > 3) continue;

    const cleaned = {
      prompt,
      choices: [choices[0], choices[1], choices[2], choices[3]],
      correctIndex,
    } as QuizQuestion & { [K in E]?: string };

    // Carry through any extra string metadata (e.g. subconcept_id /
    // subconceptId) so weekly-quiz consumers can per-subconcept grade.
    for (const key of extraKeys) {
      const snake = camelToSnake(key);
      const v = obj[key as string] ?? obj[snake];
      if (v !== undefined && v !== null) {
        cleaned[key] = String(v).trim() as never;
      }
    }
    out.push(cleaned);
  }
  return out;
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
