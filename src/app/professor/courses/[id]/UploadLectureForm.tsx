"use client";

import { useActionState, useRef } from "react";
import {
  uploadLecture,
  type UploadLectureState,
} from "./lecture-actions";

type ConceptOption = {
  id: string;
  label: string;
};

export function UploadLectureForm({
  courseId,
  concepts,
}: {
  courseId: string;
  concepts: ConceptOption[];
}) {
  const [state, formAction, pending] = useActionState<
    UploadLectureState,
    FormData
  >(uploadLecture, undefined);

  const formRef = useRef<HTMLFormElement | null>(null);

  // After a successful upload, blank the form so the prof can drop another
  // lecture in without re-clicking the file picker reset.
  if (state?.ok === true && formRef.current && !pending) {
    queueMicrotask(() => formRef.current?.reset());
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-2xl border border-dashed border-border bg-zinc-50/60 p-4"
    >
      <input type="hidden" name="courseId" value={courseId} />

      {/* Single horizontal row: icon + copy on the left, dropdown + file +
          submit on the right. The dashed border + muted background flag
          this as a secondary/utility action below the main analytics. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted"
          >
            {/* Inline upload glyph — keeps us off any icon dependency. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 16V4" />
              <path d="M6 10l6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">
              Upload a lecture
            </p>
            <p className="text-xs text-muted">
              PDF, PPTX, DOCX, or .txt. Parsed subconcepts attach under the
              concept you pick.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <select
            name="conceptId"
            required
            disabled={pending || concepts.length === 0}
            defaultValue=""
            aria-label="Parent concept"
            className="h-10 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 disabled:opacity-50"
          >
            <option value="" disabled>
              {concepts.length === 0
                ? "No concepts — upload syllabus first"
                : "Pick a concept…"}
            </option>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <input
            name="file"
            type="file"
            accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            required
            disabled={pending}
            className="block w-full max-w-xs text-sm text-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-background file:px-4 file:text-sm file:font-medium file:text-foreground hover:file:bg-zinc-50 disabled:opacity-50"
          />

          {/* Hidden title field — the lecture-actions handler accepts it but
              we don't surface it on the compact secondary card. The file
              name is used as the default. */}
          <input type="hidden" name="title" value="" />

          <button
            type="submit"
            disabled={pending || concepts.length === 0}
            className="h-10 shrink-0 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Parsing…" : "Add lecture"}
          </button>
        </div>
      </div>

      {state?.ok === false && (
        <p className="mt-3 text-sm text-rose-600">{state.error}</p>
      )}
      {state?.ok === true && (
        <p className="mt-3 text-sm text-emerald-600">
          Added “{state.lectureTitle}” with {state.subconceptsCreated}{" "}
          {state.subconceptsCreated === 1 ? "subconcept" : "subconcepts"}.
        </p>
      )}
    </form>
  );
}
