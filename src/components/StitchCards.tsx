"use client";

import { useEffect, useState } from "react";

/* ----------------------------------------------------------------------------
 * StitchCards
 *
 * Two cards drift in from opposite sides. Each shows a row of dots — filled
 * green = strong concept, hollow red = a gap. The patterns are designed so
 * one card's gaps align with the other's strengths. They slide together,
 * overlap, and the merged row reads as all-green: "your gaps + my gaps =
 * whole". After a beat, they dissolve and a new pattern takes their place.
 *
 * Animated with plain Tailwind transitions and a small phase state machine —
 * no animation library needed.
 * -------------------------------------------------------------------------- */

type Phase = "enter" | "merge" | "hold" | "exit" | "idle";

// Each pair must XOR to all-1s — the two cards complete each other.
const PAIRS: Array<[number[], number[]]> = [
  [
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
  ],
  [
    [1, 1, 0, 0, 1],
    [0, 0, 1, 1, 0],
  ],
  [
    [0, 1, 1, 0, 1],
    [1, 0, 0, 1, 0],
  ],
  [
    [1, 0, 0, 1, 1],
    [0, 1, 1, 0, 0],
  ],
];

const TIMINGS: Record<Phase, number> = {
  enter: 900,
  merge: 800,
  hold: 1500,
  exit: 700,
  idle: 2600, // breathing room between cycles so it doesn't feel frantic
};

export function StitchCards() {
  const [pairIndex, setPairIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("enter");

  useEffect(() => {
    const next: Record<Phase, Phase> = {
      enter: "merge",
      merge: "hold",
      hold: "exit",
      exit: "idle",
      idle: "enter",
    };
    const t = setTimeout(() => {
      // Roll the pattern over while the stage is empty so the next cycle
      // starts fresh.
      if (phase === "idle") {
        setPairIndex((i) => (i + 1) % PAIRS.length);
      }
      setPhase(next[phase]);
    }, TIMINGS[phase]);
    return () => clearTimeout(t);
  }, [phase]);

  const [left, right] = PAIRS[pairIndex];

  // Translation offsets per phase. Cards start far off-screen, settle to a
  // visible gap (cards are 176px wide so centers must be ≥176px apart to
  // avoid overlapping before the merge), then slide together at merge.
  const enterOffset = 260;
  const settleOffset = 110;
  const mergeOffset = 0;

  let leftX = -enterOffset;
  let rightX = enterOffset;
  let opacity = 0;
  let merged = false;

  if (phase === "enter") {
    leftX = -settleOffset;
    rightX = settleOffset;
    opacity = 1;
  } else if (phase === "merge") {
    leftX = -mergeOffset;
    rightX = mergeOffset;
    opacity = 1;
    merged = true;
  } else if (phase === "hold") {
    leftX = 0;
    rightX = 0;
    opacity = 1;
    merged = true;
  } else if (phase === "exit") {
    leftX = 0;
    rightX = 0;
    opacity = 0;
    merged = true;
  }

  return (
    <div className="relative mt-12 flex h-32 w-full items-center justify-center">
      <Card
        dots={left}
        merged={merged}
        translateX={leftX}
        opacity={opacity}
        z={merged ? 1 : 2}
      />
      <Card
        dots={right}
        merged={merged}
        translateX={rightX}
        opacity={opacity}
        z={merged ? 2 : 1}
      />
    </div>
  );
}

function Card({
  dots,
  merged,
  translateX,
  opacity,
  z,
}: {
  dots: number[];
  merged: boolean;
  translateX: number;
  opacity: number;
  z: number;
}) {
  return (
    <div
      className="absolute left-1/2 top-1/2 flex h-24 w-44 items-center justify-center rounded-2xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-700 ease-out"
      style={{
        // Anchor the card's center to the container's center, then offset.
        transform: `translate(calc(-50% + ${translateX}px), -50%)`,
        opacity,
        zIndex: z,
      }}
    >
      <div className="flex items-center gap-2.5">
        {dots.map((d, i) => {
          // When merged, every dot reads as filled green — the "complete row".
          const filled = merged ? true : d === 1;
          return (
            <span
              key={i}
              className="h-3.5 w-3.5 transition-colors duration-500"
              style={{
                // GitHub-style contribution squares: light gray when empty,
                // vivid green when filled.
                backgroundColor: filled ? "#26a641" : "#ebedf0",
                borderRadius: 3,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
