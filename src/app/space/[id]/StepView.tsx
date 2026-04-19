"use client";

import { useState, useTransition } from "react";
import { QuizStep, SessionStep } from "@/lib/spaces";
import { StitchAIChat } from "@/components/StitchAIChat";
import {
  getQuizHint,
  getQuizFeedback,
  QuizFeedbackItem,
} from "./chat-actions";

interface StepViewProps {
  /** Required so AI server actions can identify the room. */
  spaceId: string;
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
  spaceId,
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
  // Stitch AI is rendered alongside every step type. Local state lives
  // inside the panel; we just give it the (spaceId, stepIdx) so it can
  // reach the right step on the server.
  const chat = (
    <StitchAIChat
      spaceId={spaceId}
      stepIdx={stepIdx}
      subconceptLabel={step.subconceptLabel}
    />
  );

  switch (step.type) {
    case "teach":
      return (
        <>
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
          {chat}
        </>
      );
    case "llm_teach":
      return (
        <>
          <LlmTeachView
            step={step}
            partnerName={partnerName}
            viewerSubmitted={viewerSubmitted}
            submitting={submitting}
            onSubmit={onSubmit}
          />
          {chat}
        </>
      );
    case "quiz":
      return (
        <>
          <QuizView
            spaceId={spaceId}
            step={step}
            stepIdx={stepIdx}
            viewerUserId={viewerUserId}
            partnerName={partnerName}
            viewerSubmitted={viewerSubmitted}
            viewerIsRequired={viewerIsRequired}
            submitting={submitting}
            onSubmit={onSubmit}
          />
          {chat}
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Chip-style kicker
//
// Inspired by the "Ask X / Generate Y" chip row in the inspo screenshot —
// a colored dot + label that reads at a glance as the *kind* of action
// happening. Each step type gets its own color so you can scan the room
// and immediately see "this is a teach step", "this is a quiz", etc.
// ---------------------------------------------------------------------------

type StepKind = "teach" | "llm_teach" | "quiz";

const STEP_CHIP: Record<
  StepKind,
  { label: string; dot: string; bg: string; text: string; border: string }
> = {
  teach: {
    label: "Teach step",
    dot: "bg-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  llm_teach: {
    label: "Primer step",
    dot: "bg-sky-500",
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
  },
  quiz: {
    label: "Quiz step",
    dot: "bg-amber-500",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
};

function StepChip({ kind }: { kind: StepKind }) {
  const c = STEP_CHIP[kind];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${c.bg} ${c.text} ${c.border}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
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
      kind="teach"
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
      kind="llm_teach"
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
  spaceId,
  step,
  stepIdx,
  viewerUserId,
  partnerName,
  viewerSubmitted,
  viewerIsRequired,
  submitting,
  onSubmit,
}: {
  spaceId: string;
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

  // Per-question hint state. `null` = not yet requested, otherwise the
  // last hint we received (one hint per question, button disables after).
  const [hints, setHints] = useState<(string | null)[]>(() =>
    new Array(step.questions.length).fill(null)
  );
  const [hintLoading, setHintLoading] = useState<number | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);

  // Per-question feedback after submit. Populated by getQuizFeedback —
  // server re-grades, then writes one explanation per question.
  const [feedback, setFeedback] = useState<QuizFeedbackItem[] | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackPending, startFeedback] = useTransition();

  const isTarget = step.targetUserIds.includes(viewerUserId);
  const allAnswered = answers.every((a) => a >= 0);

  async function fetchHint(qi: number) {
    if (hints[qi] !== null || hintLoading !== null) return;
    setHintLoading(qi);
    setHintError(null);
    const res = await getQuizHint(spaceId, stepIdx, qi);
    setHintLoading(null);
    if (res.ok) {
      setHints((prev) => {
        const next = [...prev];
        next[qi] = res.hint;
        return next;
      });
    } else {
      setHintError(res.error);
    }
  }

  function submit() {
    if (!allAnswered) return;
    // Fire feedback request alongside the regular submit. The server
    // action grades against `correctIndex` so if the client lies about
    // its answers, the feedback list reflects the lie — but the actual
    // mastery bump in submitStepResponse uses the same server-side
    // `correctIndex`, so cheating gets you nothing.
    onSubmit({ kind: "quiz", answers });
    setFeedbackError(null);
    setFeedback(null);
    startFeedback(async () => {
      const res = await getQuizFeedback(spaceId, stepIdx, answers);
      if (res.ok) {
        setFeedback(res.feedback);
      } else {
        setFeedbackError(res.error);
      }
    });
  }

  return (
    <StepFrame
      kind="quiz"
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
            {step.questions.map((q, qi) => {
              const fb = feedback?.[qi];
              return (
                <li key={qi}>
                  <p className="text-sm font-medium text-foreground">
                    {qi + 1}. {q.prompt}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {q.choices.map((choice, ci) => {
                      const id = `q${qi}-c${ci}`;
                      const checked = answers[qi] === ci;
                      // Once feedback is in, mark the user's chosen
                      // option as correct/wrong with subtle color.
                      const showResult = viewerSubmitted && fb !== undefined;
                      const isCorrectChoice =
                        showResult && ci === q.correctIndex;
                      const isWrongPick =
                        showResult && checked && !fb!.correct;
                      return (
                        <li key={ci}>
                          <label
                            htmlFor={id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                              isCorrectChoice
                                ? "border-emerald-400 bg-emerald-50"
                                : isWrongPick
                                  ? "border-red-400 bg-red-50"
                                  : checked
                                    ? "border-foreground bg-foreground/5"
                                    : "border-border bg-background hover:bg-zinc-50"
                            } ${viewerSubmitted ? "cursor-not-allowed opacity-90" : ""}`}
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

                  {/* Pre-submit: hint button + (once used) the hint text.
                      Disappears after submit because the explanation
                      below replaces it. */}
                  {!viewerSubmitted && (
                    <div className="mt-2">
                      {hints[qi] === null ? (
                        <button
                          type="button"
                          onClick={() => fetchHint(qi)}
                          disabled={hintLoading !== null}
                          className="text-xs font-medium text-muted underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {hintLoading === qi ? "Thinking…" : "Get a hint"}
                        </button>
                      ) : (
                        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                          <span className="font-medium">Hint: </span>
                          {hints[qi]}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Post-submit: explanation lifted from getQuizFeedback. */}
                  {viewerSubmitted && fb && (
                    <div
                      className={`mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
                        fb.correct
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-red-200 bg-red-50 text-red-900"
                      }`}
                    >
                      <span className="font-medium">
                        {fb.correct ? "Correct. " : "Not quite. "}
                      </span>
                      {fb.explanation}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {hintError && (
            <p className="mt-3 text-xs text-red-700">{hintError}</p>
          )}

          {viewerSubmitted && !feedback && (
            <p className="mt-4 text-xs italic text-muted">
              {feedbackPending
                ? "Stitch AI is writing per-question feedback…"
                : feedbackError
                  ? `Couldn't load explanations: ${feedbackError}`
                  : "Loading feedback…"}
            </p>
          )}

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
  kind,
  title,
  sub,
  children,
}: {
  kind: StepKind;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-background p-7">
      <StepChip kind={kind} />
      <h2 className="mt-4 font-inter text-3xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
      <div className="mt-6">{children}</div>
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
