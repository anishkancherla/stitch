"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CardRow,
  SessionPlan,
  SessionStep,
  requiredRespondents,
} from "@/lib/spaces";
import { WeakAreasBoard } from "./WeakAreasBoard";
import { StepView } from "./StepView";
import { endStitchSpace, submitStepResponse } from "./actions";

interface SpaceRoomProps {
  spaceId: string;
  courseId: string;
  courseLabel: string;
  plan: SessionPlan;
  initialCurrentStep: number;
  initialStatus: "waiting" | "active" | "ended";
  initialCards: CardRow[];
  viewerUserId: string;
  /** user_id -> display name. Includes both members. */
  memberNames: Record<string, string>;
}

/**
 * Live two-student room. Holds the canonical "what step are we on" + the
 * card statuses in component state, but a Supabase Realtime channel keeps
 * those in sync with whatever just hit Postgres so the partner's actions
 * land in this UI within ~100 ms.
 *
 * We don't optimistically advance — the server action is the source of
 * truth, and the realtime UPDATE on stitch_spaces.current_step is what
 * moves both clients forward. That keeps both browsers in lockstep at
 * the cost of one server round-trip per step.
 */
export function SpaceRoom({
  spaceId,
  courseLabel,
  plan,
  initialCurrentStep,
  initialStatus,
  initialCards,
  viewerUserId,
  memberNames,
}: SpaceRoomProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(initialCurrentStep);
  const [status, setStatus] = useState(initialStatus);
  const [cards, setCards] = useState<CardRow[]>(initialCards);
  const [responders, setResponders] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // Pinned step keeps the rendered quiz step on screen after the viewer
  // submits, so they can read the per-question feedback before being kicked
  // forward by the server's auto-advance. null = follow server (default).
  // The user clicks an explicit "Continue" button to unpin and jump to
  // whatever current_step has become while they were reading.
  const [pinnedStep, setPinnedStep] = useState<number | null>(null);

  // -- Realtime sync ---------------------------------------------------------
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`space-${spaceId}`);

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "stitch_spaces",
        filter: `id=eq.${spaceId}`,
      },
      (payload) => {
        const row = payload.new as {
          current_step: number;
          status: "waiting" | "active" | "ended";
        };
        setCurrentStep(row.current_step);
        setStatus(row.status);
        // Step changed → wipe the per-step responder set.
        setResponders(new Set());
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "stitch_space_cards",
        filter: `space_id=eq.${spaceId}`,
      },
      (payload) => {
        const row = payload.new as {
          subconcept_id: string;
          target_user_id: string;
          status: CardRow["status"];
        };
        setCards((prev) =>
          prev.map((c) =>
            c.subconceptId === row.subconcept_id &&
            c.targetUserId === row.target_user_id
              ? { ...c, status: row.status }
              : c
          )
        );
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "stitch_space_responses",
        filter: `space_id=eq.${spaceId}`,
      },
      (payload) => {
        const row = payload.new as { step_idx: number; user_id: string };
        // Only count if it's for the step we're showing right now.
        // (Stale rows from prior steps would otherwise corrupt the
        // "waiting on partner" hint.)
        setCurrentStep((cur) => {
          if (row.step_idx === cur) {
            setResponders((prev) => {
              const next = new Set(prev);
              next.add(row.user_id);
              return next;
            });
          }
          return cur;
        });
      }
    );

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId]);

  // What we actually render. Diverges from currentStep only when a quiz
  // submission has pinned us to its feedback view; otherwise tracks the
  // server's source of truth.
  const displayedStep = pinnedStep ?? currentStep;
  const step: SessionStep | undefined = plan.steps[displayedStep];
  const memberIds = useMemo(
    () => plan.members.map((m) => m.userId),
    [plan.members]
  );

  const required = useMemo(
    () => (step ? requiredRespondents(step, memberIds) : []),
    [step, memberIds]
  );
  const partnerName = useMemo(() => {
    const partnerId = memberIds.find((u) => u !== viewerUserId);
    return partnerId ? memberNames[partnerId] ?? "Partner" : "Partner";
  }, [memberIds, viewerUserId, memberNames]);

  const viewerSubmitted = responders.has(viewerUserId);
  const viewerIsRequired = required.includes(viewerUserId);
  // Don't show the end screen while the viewer is pinned reading feedback
  // from the final quiz step. Server flips status to "ended" the instant
  // the last quiz response lands, but the viewer hasn't read it yet.
  const isEnded =
    pinnedStep === null &&
    (status === "ended" || currentStep >= plan.steps.length);

  function handleStepSubmit(
    payload: { kind: "done" } | { kind: "quiz"; answers: number[] }
  ) {
    // Pin BEFORE the server call so the inevitable realtime auto-advance
    // can't yank us off this step before the user sees per-question
    // feedback. We pin to displayedStep (not currentStep) so a chain of
    // submissions on consecutive quizzes pins the right one.
    if (payload.kind === "quiz") {
      setPinnedStep(displayedStep);
    }
    startTransition(async () => {
      const res = await submitStepResponse(spaceId, displayedStep, payload);
      if (!res.ok) {
        // Common case in practice: stale tab whose Supabase cookie got
        // invalidated by a sign-in in another window. Bounce to /login
        // and come back instead of leaving the user staring at a broken
        // step.
        if (res.error === "not signed in") {
          window.location.href = `/login?next=${encodeURIComponent(
            window.location.pathname
          )}`;
          return;
        }
        alert(`Couldn't submit: ${res.error}`);
        return;
      }
      // Optimistically mark self as a responder so the UI flips to
      // "waiting on partner" without needing the realtime echo.
      setResponders((prev) => {
        const next = new Set(prev);
        next.add(viewerUserId);
        return next;
      });
      router.refresh();
    });
  }

  function handleEnd() {
    if (!confirm("End this session for both of you?")) return;
    startTransition(async () => {
      await endStitchSpace(spaceId);
      router.refresh();
    });
  }

  // Called from the quiz step's "Continue" button after the viewer has
  // read their feedback. Releases the pin so the room jumps to whatever
  // current_step is (which is usually displayedStep+1, but could be
  // further along if other transitions have already happened).
  function handleContinue() {
    setPinnedStep(null);
    // Force a refresh so the realtime-driven board state for the new step
    // (cards, snippets, etc) is fully hydrated when we render it.
    router.refresh();
  }

  const stepProgress = isEnded
    ? plan.steps.length
    : Math.min(displayedStep + 1, plan.steps.length);
  const progressPct =
    plan.steps.length === 0
      ? 0
      : Math.round((stepProgress / plan.steps.length) * 100);

  return (
    <div className="space-y-8">
      {/* Header — bigger hero treatment with Inter for the member names so
          the room feels like a deliberate space, not a scaffold around the
          step card. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Stitch Space · {courseLabel}
          </p>
          <h1 className="mt-2 truncate font-inter text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {plan.members.map((m) => memberNames[m.userId] ?? m.name).join("  +  ")}
          </h1>
          <p className="mt-3 text-sm text-muted">
            {isEnded
              ? "Session ended"
              : pinnedStep === displayedStep && currentStep > displayedStep
                ? `Step ${stepProgress} of ${plan.steps.length} · reviewing your answers`
                : `Step ${stepProgress} of ${plan.steps.length}`}
            <span className="mx-2 text-muted/50">·</span>
            <span className="font-mono text-foreground/70">
              you are {memberNames[viewerUserId] ?? "?"}
            </span>
          </p>
        </div>
        {!isEnded && (
          <button
            type="button"
            onClick={handleEnd}
            className="shrink-0 rounded-xl border border-border bg-background px-4 py-1.5 text-xs font-medium text-muted hover:text-foreground"
          >
            End session
          </button>
        )}
      </header>

      {/* Progress bar — compact horizontal bar that fills as steps clear.
          Helps the pair see how much of the session is left without having
          to count chips on the board. */}
      {!isEnded && plan.steps.length > 0 && (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full bg-foreground transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <WeakAreasBoard
        cards={cards}
        memberNames={memberNames}
        viewerUserId={viewerUserId}
        currentSubconceptId={step?.subconceptId}
      />

      {isEnded ? (
        <SessionSummary
          plan={plan}
          cards={cards}
          memberNames={memberNames}
          viewerUserId={viewerUserId}
        />
      ) : step ? (
        <StepView
          key={displayedStep}
          spaceId={spaceId}
          step={step}
          stepIdx={displayedStep}
          viewerUserId={viewerUserId}
          memberNames={memberNames}
          partnerName={partnerName}
          viewerSubmitted={viewerSubmitted || pinnedStep === displayedStep}
          viewerIsRequired={viewerIsRequired}
          submitting={pending}
          onSubmit={handleStepSubmit}
          onContinue={handleContinue}
          serverHasAdvanced={
            pinnedStep === displayedStep && currentStep > displayedStep
          }
        />
      ) : (
        <p className="text-sm text-muted">No more steps.</p>
      )}
    </div>
  );
}

function SessionSummary({
  plan,
  cards,
  memberNames,
  viewerUserId,
}: {
  plan: SessionPlan;
  cards: CardRow[];
  memberNames: Record<string, string>;
  viewerUserId: string;
}) {
  const yoursGreen = cards.filter(
    (c) => c.targetUserId === viewerUserId && c.status === "green"
  );
  const yoursRed = cards.filter(
    (c) => c.targetUserId === viewerUserId && c.status !== "green"
  );

  return (
    <section className="rounded-3xl border border-border bg-zinc-50/60 p-8">
      <h2 className="font-inter text-3xl font-semibold tracking-tight text-foreground">
        Nice session, {memberNames[viewerUserId] ?? "there"}.
      </h2>
      <p className="mt-2 text-base text-muted">
        Here&apos;s what landed for you:
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
            Locked in ({yoursGreen.length})
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {yoursGreen.length === 0 ? (
              <li className="text-muted">Nothing turned green this session.</li>
            ) : (
              yoursGreen.map((c) => (
                <li key={`${c.subconceptId}-${c.targetUserId}`}>
                  · {c.subconceptLabel}
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-rose-700">
            Still shaky ({yoursRed.length})
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {yoursRed.length === 0 ? (
              <li className="text-muted">All clear.</li>
            ) : (
              yoursRed.map((c) => (
                <li key={`${c.subconceptId}-${c.targetUserId}`}>
                  · {c.subconceptLabel}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted">
        {plan.steps.length} steps total — your ribbon has been updated.
      </p>
    </section>
  );
}
