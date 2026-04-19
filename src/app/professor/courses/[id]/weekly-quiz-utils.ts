// Pure helpers for weekly quizzes. Lives separate from
// weekly-quiz-actions.ts because Next's "use server" files can only
// export async functions — a sync helper alongside the action triggers
// "Server Actions must be async functions" at compile time.

/** Per-subconcept quota. Total target ≈ 20, with sensible floor / ceiling
 *  so a 1-subconcept concept doesn't get 20 questions of one thing and a
 *  10-subconcept concept doesn't end up with 50+ questions. */
export function quotaPerSubconcept(n: number): number {
  if (n <= 0) return 0;
  return Math.max(3, Math.min(6, Math.round(20 / n)));
}
