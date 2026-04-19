"use client";

import { useState } from "react";
import { QuizStep, SessionStep } from "@/lib/spaces";

interface StepViewProps {
  step: SessionStep;
  /** Reset internal state on step change. */
  stepIdx: number;
  viewerUserId: string;
  memberNames: Record<string, string>;
  partnerName: string;
  /** Whether the viewer has already submitted for this step. */
  viewerSubmitted: boolean;
  /** Whether the viewer's submission is one of the gating ones. */
  viewerIsRequired: boolean;
  submitting: boolean;
  onSubmit: (
    payload: { kind: "done" } | { kind: "quiz"; answers: number[] }
  ) => void;
}

/**
 * Renders the current step. Three branches by step.type:
 *   - teach     → instruction card, "Done" button (only the teacher acts)
 *   - llm_teach → primer card, "Done" button (both members act)
 *   - quiz      → MCQ form (only target users act). Server grades.
 */
export function StepView({
  step,
  stepIdx,
  viewerUserId,
  memberNames,
  partnerName,
  viewerSubmitted,
  viewerIsRequired,
  submitting,
  onSubmit,
}: StepViewProps) {
  switch (step.type) {
    case "teach":
      return (
        <TeachView
          step={step}
          viewerUserId={viewerUserId}
          memberNames={memberNames}
          partnerName={partnerName}
          viewerSubmitted={viewerSubmitted}
          viewerIsRequired={viewerIsRequired}
          submitting={submitting}
          onSubmit={onSubmit}
        />
      );
    case "llm_teach":
      return (
        <LlmTeachView
          step={step}
          partnerName={partnerName}
          viewerSubmitted={viewerSubmitted}
          submitting={submitting}
          onSubmit={onSubmit}
        />
      );
    case "quiz":
      return (
        <QuizView
          step={step}
          stepIdx={stepIdx}
          viewerUserId={viewerUserId}
          partnerName={partnerName}
          viewerSubmitted={viewerSubmitted}
          viewerIsRequired={viewerIsRequired}
          submitting={submitting}
          onSubmit={onSubmit}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Teach
// ---------------------------------------------------------------------------

function TeachView({
  step,
  viewerUserId,
  memberNames,
  partnerName,
  viewerSubmitted,
  viewerIsRequired,
  submitting,
  onSubmit,
}: {
  step: Extract<SessionStep, { type: "teach" }>;
  viewerUserId: string;
  memberNames: Record<string, string>;
  partnerName: string;
  viewerSubmitted: boolean;
  viewerIsRequired: boolean;
  submitting: boolean;
  onSubmit: (
    payload: { kind: "done" } | { kind: "quiz"; answers: number[] }
  ) => void;
}) {
  const isTeacher = step.teacherUserId === viewerUserId;
  const teacherName = memberNames[step.teacherUserId] ?? "Teacher";
  const learnerName = memberNames[step.learnerUserId] ?? "Learner";

  return (
    <StepFrame
      kicker="Teach step"
      title={`${teacherName} teaches ${learnerName}: ${step.subconceptLabel}`}
      sub={step.conceptLabel}
    >
      <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
        {step.instruction}
      </p>

      {/* Snippets are teacher-eyes-only. Showing them to the learner would
          give away the answers and defeat the point of teaching back.
          These are piped straight from subconcept_materials.key_points —
          the prof's actual lecture bullets, no LLM rewriting in between. */}
      {isTeacher && step.teacherSnippets && step.teacherSnippets.length > 0 && (
        <SnippetPanel
          title="From your professor's slides"
          subtitle={`Lifted from your lecture material on ${step.subconceptLabel}. Your partner can't see this — use it as talking points.`}
          items={step.teacherSnippets}
        />
      )}

      {isTeacher ? (
        <ActionBar
          onPrimary={() => onSubmit({ kind: "done" })}
          primaryLabel={viewerSubmitted ? "Waiting on next step…" : "Done teaching"}
          primaryDisabled={viewerSubmitted || submitting || !viewerIsRequired}
          hint={
            viewerSubmitted
              ? `Press the next-step instruction together. ${partnerName} will see it too.`
              : "When you've finished explaining on the call, press Done."
          }
        />
      ) : (
        <p className="mt-6 text-sm text-muted">
          {partnerName} is teaching this. Listen along on the call — when
          they press Done you&apos;ll be quizzed next to lock it in.
        </p>
      )}
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// LLM-teach
// ---------------------------------------------------------------------------

function LlmTeachView({
  step,
  partnerName,
  viewerSubmitted,
  submitting,
  onSubmit,
}: {
  step: Extract<SessionStep, { type: "llm_teach" }>;
  partnerName: string;
  viewerSubmitted: boolean;
  submitting: boolean;
  onSubmit: (
    payload: { kind: "done" } | { kind: "quiz"; answers: number[] }
  ) => void;
}) {
  return (
    <StepFrame
      kicker="LLM-teach step"
      title={step.subconceptLabel}
      sub={`${step.conceptLabel} · primer for both of you`}
    >
      <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
        {step.primer}
      </p>

      {/* Both members are learners here, so it's fine for both to see the
          source material. Same provenance as TeachStep snippets — these
          are the prof's actual bullets, not LLM paraphrase. */}
      {step.snippets && step.snippets.length > 0 && (
        <SnippetPanel
          title="From your professor's slides"
          subtitle={`Lifted from your lecture material on ${step.subconceptLabel}.`}
          items={step.snippets}
        />
      )}

      <ActionBar
        onPrimary={() => onSubmit({ kind: "done" })}
        primaryLabel={viewerSubmitted ? "Waiting on partner…" : "Got it"}
        primaryDisabled={viewerSubmitted || submitting}
        hint={
          viewerSubmitted
            ? `${partnerName} hasn't pressed yet. Hang tight — quiz unlocks once both of you confirm.`
            : "Read together on the call. Press Got it when you're both ready to be quizzed."
        }
      />
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

function QuizView({
  step,
  stepIdx,
  viewerUserId,
  partnerName,
  viewerSubmitted,
  viewerIsRequired,
  submitting,
  onSubmit,
}: {
  step: QuizStep;
  stepIdx: number;
  viewerUserId: string;
  partnerName: string;
  viewerSubmitted: boolean;
  viewerIsRequired: boolean;
  submitting: boolean;
  onSubmit: (
    payload: { kind: "done" } | { kind: "quiz"; answers: number[] }
  ) => void;
}) {
  // -1 = unanswered. The parent passes key={stepIdx} so this component
  // remounts on step change — no effect needed to reset between steps.
  void stepIdx;
  const [answers, setAnswers] = useState<number[]>(() =>
    new Array(step.questions.length).fill(-1)
  );

  const isTarget = step.targetUserIds.includes(viewerUserId);
  const allAnswered = answers.every((a) => a >= 0);

  function submit() {
    if (!allAnswered) return;
    onSubmit({ kind: "quiz", answers });
  }

  return (
    <StepFrame
      kicker="Quiz step"
      title={step.subconceptLabel}
      sub={`${step.conceptLabel} · pass to flip the card green`}
    >
      {!isTarget ? (
        <p className="text-sm text-muted">
          {partnerName} is taking this one solo — no help. You&apos;ll see
          their result land on the board when they submit.
        </p>
      ) : (
        <>
          <ol className="space-y-5">
            {step.questions.map((q, qi) => (
              <li key={qi}>
                <p className="text-sm font-medium text-foreground">
                  {qi + 1}. {q.prompt}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {q.choices.map((choice, ci) => {
                    const id = `q${qi}-c${ci}`;
                    const checked = answers[qi] === ci;
                    return (
                      <li key={ci}>
                        <label
                          htmlFor={id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            checked
                              ? "border-foreground bg-foreground/5"
                              : "border-border bg-background hover:bg-zinc-50"
                          } ${viewerSubmitted ? "cursor-not-allowed opacity-70" : ""}`}
                        >
                          <input
                            id={id}
                            type="radio"
                            name={`q${qi}`}
                            className="accent-foreground"
                            disabled={viewerSubmitted}
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

          <ActionBar
            onPrimary={submit}
            primaryLabel={
              viewerSubmitted ? "Submitted" : submitting ? "Grading…" : "Submit answers"
            }
            primaryDisabled={
              viewerSubmitted || submitting || !allAnswered || !viewerIsRequired
            }
            hint={
              viewerSubmitted
                ? "Your card flipped on the board above based on your score. Waiting on the rest."
                : allAnswered
                  ? "No going back once you submit."
                  : "Pick one option per question."
            }
          />
        </>
      )}
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function StepFrame({
  kicker,
  title,
  sub,
  children,
}: {
  kicker: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-background p-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {kicker}
      </p>
      <h2 className="mt-1 font-display text-2xl tracking-tight text-foreground">
        {title}
      </h2>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SnippetPanel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: string[];
}) {
  return (
    <aside className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
        {title}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-amber-700/80">{subtitle}</p>
      )}
      <ul className="mt-3 space-y-2">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm leading-relaxed text-amber-950"
          >
            <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-700" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ActionBar({
  onPrimary,
  primaryLabel,
  primaryDisabled,
  hint,
}: {
  onPrimary: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs text-muted">{hint}</p>
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimary}
        className="rounded-xl bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {primaryLabel}
      </button>
    </div>
  );
}
