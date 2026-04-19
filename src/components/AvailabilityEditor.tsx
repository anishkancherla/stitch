"use client";

import { useMemo, useState, useTransition } from "react";
import {
  setMyAvailability,
  type AvailabilityBlock,
} from "@/app/profile/availability-actions";

export interface AvailabilityEditorProps {
  initialBlocks: AvailabilityBlock[];
}

// 7-day grid × 14 hourly slots from 08:00 to 22:00. Click-and-drag selects a
// rectangular region; clicking a selected cell toggles it off. We compress
// adjacent same-day cells back into contiguous blocks on save so the DB
// doesn't store 14 rows when the student means "9-11am Monday".
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_START = 8;
const HOUR_END = 22; // exclusive — last selectable cell is 21:00–22:00
const SLOT_HOURS = HOUR_END - HOUR_START; // 14

type CellKey = `${number}-${number}`; // `${day}-${hour}`

function toCellSet(blocks: AvailabilityBlock[]): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const b of blocks) {
    const sh = parseInt(b.startTime.slice(0, 2), 10);
    const eh = parseInt(b.endTime.slice(0, 2), 10);
    for (let h = sh; h < eh; h++) {
      if (h >= HOUR_START && h < HOUR_END) {
        out.add(`${b.dayOfWeek}-${h}` as CellKey);
      }
    }
  }
  return out;
}

function toBlocks(cells: Set<CellKey>): AvailabilityBlock[] {
  const out: AvailabilityBlock[] = [];
  for (let d = 0; d < 7; d++) {
    let runStart: number | null = null;
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const filled = h < HOUR_END && cells.has(`${d}-${h}` as CellKey);
      if (filled && runStart === null) runStart = h;
      else if (!filled && runStart !== null) {
        out.push({
          dayOfWeek: d,
          startTime: `${String(runStart).padStart(2, "0")}:00`,
          endTime: `${String(h).padStart(2, "0")}:00`,
        });
        runStart = null;
      }
    }
  }
  return out;
}

export function AvailabilityEditor({ initialBlocks }: AvailabilityEditorProps) {
  const [cells, setCells] = useState<Set<CellKey>>(() => toCellSet(initialBlocks));
  const [drag, setDrag] = useState<{ mode: "add" | "remove" } | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<null | "saved" | string>(null);

  const blocks = useMemo(() => toBlocks(cells), [cells]);

  function paint(key: CellKey, mode: "add" | "remove") {
    setCells((prev) => {
      const next = new Set(prev);
      if (mode === "add") next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function onPointerDown(key: CellKey, e: React.PointerEvent) {
    e.preventDefault();
    const mode: "add" | "remove" = cells.has(key) ? "remove" : "add";
    setDrag({ mode });
    paint(key, mode);
  }
  function onPointerEnter(key: CellKey) {
    if (!drag) return;
    paint(key, drag.mode);
  }

  function onSave() {
    setSaved(null);
    startTransition(async () => {
      const res = await setMyAvailability(blocks);
      if (res.ok) setSaved("saved");
      else setSaved(res.error);
    });
  }

  function onClear() {
    setCells(new Set());
  }

  return (
    <div
      className="select-none"
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted">
          Drag to mark when you&apos;re free. Used to find study partners with
          overlapping schedules.
        </p>
        <div className="flex items-center gap-3">
          {saved === "saved" && (
            <span className="text-xs text-emerald-600">Saved</span>
          )}
          {saved && saved !== "saved" && (
            <span className="text-xs text-rose-500">Failed: {saved}</span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-zinc-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div
          className="grid gap-px rounded-lg bg-border"
          style={{
            gridTemplateColumns: `60px repeat(7, minmax(40px, 1fr))`,
            gridTemplateRows: `24px repeat(${SLOT_HOURS}, 22px)`,
          }}
        >
          <div className="bg-background" />
          {DAYS.map((d) => (
            <div
              key={d}
              className="flex items-center justify-center bg-background text-[10px] font-medium uppercase tracking-wider text-muted"
            >
              {d}
            </div>
          ))}

          {Array.from({ length: SLOT_HOURS }, (_, i) => {
            const h = HOUR_START + i;
            return (
              <Row
                key={h}
                hour={h}
                cells={cells}
                onPointerDown={onPointerDown}
                onPointerEnter={onPointerEnter}
              />
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        {blocks.length === 0
          ? "No availability set yet."
          : `${blocks.length} block${blocks.length === 1 ? "" : "s"} across ${
              new Set(blocks.map((b) => b.dayOfWeek)).size
            } day${new Set(blocks.map((b) => b.dayOfWeek)).size === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}

function Row({
  hour,
  cells,
  onPointerDown,
  onPointerEnter,
}: {
  hour: number;
  cells: Set<CellKey>;
  onPointerDown: (key: CellKey, e: React.PointerEvent) => void;
  onPointerEnter: (key: CellKey) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-end bg-background pr-2 font-mono text-[10px] text-muted">
        {String(hour).padStart(2, "0")}:00
      </div>
      {Array.from({ length: 7 }, (_, d) => {
        const key = `${d}-${hour}` as CellKey;
        const filled = cells.has(key);
        return (
          <button
            key={d}
            type="button"
            onPointerDown={(e) => onPointerDown(key, e)}
            onPointerEnter={() => onPointerEnter(key)}
            aria-label={`${DAYS[d]} ${hour}:00`}
            aria-pressed={filled}
            className={[
              "h-full w-full transition-colors",
              filled
                ? "bg-emerald-300 hover:bg-emerald-400"
                : "bg-background hover:bg-zinc-100",
            ].join(" ")}
          />
        );
      })}
    </>
  );
}
