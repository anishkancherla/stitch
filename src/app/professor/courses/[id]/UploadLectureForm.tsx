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
      className="rounded-2xl border border-border bg-zinc-50 p-5"
    >
      <input type="hidden" name="courseId" value={courseId} />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Upload a lecture</p>
        <p className="text-sm text-muted">
          PDF, PPTX, DOCX, or .txt. We'll attach the parsed subconcepts to
          the concept you pick below — they appear as new cells in the ribbon.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">
            Parent concept
          </span>
          <select
            name="conceptId"
            required
            disabled={pending || concepts.length === 0}
            defaultValue=""
            className="h-10 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 disabled:opacity-50"
          >
            <option value="" disabled>
              {concepts.length === 0
                ? "No concepts yet — upload a syllabus first"
                : "Pick a concept…"}
            </option>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">
            Lecture title <span className="normal-case text-muted">(optional)</span>
          </span>
          <input
            name="title"
            type="text"
            maxLength={200}
            placeholder="Defaults to file name"
            disabled={pending}
            className="h-10 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          name="file"
          type="file"
          accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          required
          disabled={pending}
          className="block w-full max-w-md text-sm text-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-background file:px-4 file:text-sm file:font-medium file:text-foreground hover:file:bg-zinc-50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || concepts.length === 0}
          className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Parsing…" : "Add lecture"}
        </button>
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
