"use client";

// Single-concept row in the professor's "Weekly quizzes" panel. Renders
// concept label + stats and a Generate / Regenerate button. The button
// invokes the server action and disables itself while pending.

import { useTransition, useState } from "react";
import { generateWeeklyQuiz } from "./weekly-quiz-actions";

interface WeeklyQuizRowProps {
  conceptId: string;
  conceptLabel: string;
  subconceptCount: number;
  /** Number of questions in the existing quiz, or null if none. */
  existingQuestionCount: number | null;
  attempts: { count: number; avgPct: number | null };
}

export function WeeklyQuizRow({
  conceptId,
  conceptLabel,
  subconceptCount,
  existingQuestionCount,
  attempts,
}: WeeklyQuizRowProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justGenerated, setJustGenerated] = useState<number | null>(null);

  function trigger() {
    setError(null);
    startTransition(async () => {
      const res = await generateWeeklyQuiz(conceptId);
      if (res.ok) {
        setJustGenerated(res.questionCount);
      } else {
        setError(res.error);
      }
    });
  }

  const hasExisting =
    existingQuestionCount !== null || justGenerated !== null;
  const questionCount = justGenerated ?? existingQuestionCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{conceptLabel}</p>
        <p className="mt-0.5 text-xs text-muted">
          {subconceptCount} {subconceptCount === 1 ? "subconcept" : "subconcepts"}
          {hasExisting && questionCount !== null && (
            <> · {questionCount} questions</>
          )}
          {attempts.count > 0 && (
            <>
              {" "}· {attempts.count} attempt{attempts.count === 1 ? "" : "s"}
              {attempts.avgPct !== null && (
                <> · avg {Math.round(attempts.avgPct)}%</>
              )}
            </>
          )}
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-700">Error: {error}</p>
        )}
      </div>
      <button
        type="button"
        onClick={trigger}
        disabled={pending || subconceptCount === 0}
        className="rounded-lg border border-border bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending
          ? "Generating…"
          : hasExisting
            ? "Regenerate"
            : "Generate weekly quiz"}
      </button>
    </div>
  );
}
