"use client";

import { useState } from "react";
import Link from "next/link";
import { cellHex } from "@/lib/ribbon";

export type TopicMastery = {
  conceptId: string;
  conceptLabel: string;
  avg: number | null;
  subconcepts: Array<{ id: string; label: string; score: number | null }>;
};

export type StudentRowData = {
  id: string;
  name: string;
  email: string;
  avg: number | null;
  weak: number;
  topics: TopicMastery[];
};

function MasteryBadge({ value }: { value: number | null }) {
  if (value === null)
    return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="block h-2.5 w-2.5 rounded-[3px] shrink-0"
        style={{ backgroundColor: cellHex(value) }}
      />
      <span className="font-mono tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}

export function StudentAccordionRow({
  student,
  courseId,
}: {
  student: StudentRowData;
  courseId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-border last:border-b-0 transition-colors hover:bg-zinc-50/50">
        {/* Name */}
        <td className="px-5 py-3">
          <Link
            href={`/professor/courses/${courseId}/students/${student.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {student.name}
          </Link>
        </td>

        {/* Email */}
        <td className="px-5 py-3 text-muted">{student.email}</td>

        {/* Avg mastery */}
        <td className="px-5 py-3 text-right text-sm">
          {student.avg === null ? (
            <span className="text-muted">—</span>
          ) : (
            <span className="inline-flex items-center justify-end gap-2">
              <span
                className="block h-3 w-3 rounded-[3px]"
                style={{ backgroundColor: cellHex(student.avg) }}
              />
              <span className="font-mono text-foreground">
                {student.avg.toFixed(2)}
              </span>
            </span>
          )}
        </td>

        {/* Weak items */}
        <td className="px-5 py-3 text-right font-mono text-foreground">
          {student.weak}
        </td>

        {/* Expand toggle */}
        <td className="px-4 py-3 text-right">
          {student.topics.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Collapse topic breakdown" : "Expand topic breakdown"}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-zinc-100 hover:text-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-border last:border-b-0 bg-zinc-50/60">
          <td colSpan={5} className="px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {student.topics.map((topic) => (
                <div
                  key={topic.conceptId}
                  className="rounded-xl border border-border bg-background px-4 py-3"
                >
                  {/* Topic header */}
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted truncate">
                      {topic.conceptLabel}
                    </span>
                    <MasteryBadge value={topic.avg} />
                  </div>

                  {/* Subconcept list */}
                  {topic.subconcepts.length === 0 ? (
                    <p className="text-xs text-muted">No data yet</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {topic.subconcepts
                        .slice()
                        .sort((a, b) => a.label.localeCompare(b.label))
                        .map((sc) => (
                          <li
                            key={sc.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate text-foreground/80">
                              {sc.label}
                            </span>
                            <MasteryBadge value={sc.score} />
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
