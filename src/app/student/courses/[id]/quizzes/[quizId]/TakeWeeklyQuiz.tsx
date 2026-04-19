"use client";

// Take-quiz UI for weekly quizzes. Local-only state; server grades via
// submitWeeklyQuiz. After submit, we render the score + per-subconcept
// breakdown returned by the action so the student knows which areas
// just got bumped.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  submitWeeklyQuiz,
  SubmitWeeklyQuizResult,
} from "./actions";

interface ClientQuestion {
  prompt: string;
  choices: string[];
}

interface TakeWeeklyQuizProps {
  quizId: string;
  courseId: string;
  questions: ClientQuestion[];
}

export function TakeWeeklyQuiz({
  quizId,
  courseId,
  questions,
}: TakeWeeklyQuizProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<number[]>(() =>
    new Array(questions.length).fill(-1),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SubmitWeeklyQuizResult | null>(null);

  const allAnswered = answers.every((a) => a >= 0);

  function submit() {
    if (!allAnswered || pending) return;
    startTransition(async () => {
      const res = await submitWeeklyQuiz(quizId, answers);
      setResult(res);
      if (res.ok) {
        // Mastery values may have changed; refresh the routes that
        // surface them on next nav. revalidatePath handles the cache,
        // but router.refresh() makes the next "Back" feel snappy.
        router.refresh();
      }
    });
  }

  // Submitted state
  if (result?.ok) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-zinc-50 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">
            Your score
          </p>
          <p className="mt-2 font-display text-4xl text-foreground">
            {Math.round(result.scorePct)}%
          </p>
        </div>

        {result.perSubconcept.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-foreground">
              Per-subconcept breakdown
            </h2>
            <ul className="mt-2 space-y-1.5">
              {result.perSubconcept.map((s) => (
                <li
                  key={s.subconceptId}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    s.passed
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-zinc-200 bg-zinc-50 text-zinc-700"
                  }`}
                >
                  <span className="font-mono text-xs">
                    {s.subconceptId.slice(0, 8)}…
                  </span>
                  <span>
                    {s.correct} / {s.total} correct
                    {s.passed && s.nextScore !== null && (
                      <> · mastery → {s.nextScore.toFixed(2)}</>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href={`/student/courses/${courseId}/quizzes`}
            className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
          >
            Back to quizzes
          </Link>
          <Link
            href={`/student/courses/${courseId}`}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            See updated ribbon
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-5">
        {questions.map((q, qi) => (
          <li key={qi}>
            <p className="text-sm font-medium text-foreground">
              {qi + 1}. {q.prompt}
            </p>
            <ul className="mt-2 space-y-1.5">
              {q.choices.map((choice, ci) => {
                const id = `wq${qi}-c${ci}`;
                const checked = answers[qi] === ci;
                return (
                  <li key={ci}>
                    <label
                      htmlFor={id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? "border-foreground bg-foreground/5"
                          : "border-border bg-background hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        id={id}
                        type="radio"
                        name={`wq${qi}`}
                        className="accent-foreground"
                        checked={checked}
                        onChange={() => {
                          setAnswers((prev) => {
                            const next = [...prev];
                            next[qi] = ci;
                            return next;
                          });
                        }}
                      />
                      <span>{choice}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {result && !result.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-background/90 px-4 py-3 backdrop-blur">
        <p className="text-xs text-muted">
          {allAnswered
            ? "All set. Submitting locks in your answers."
            : "Pick one option per question."}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!allAnswered || pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Grading…" : "Submit answers"}
        </button>
      </div>
    </div>
  );
}
