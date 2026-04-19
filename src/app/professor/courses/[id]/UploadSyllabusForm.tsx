"use client";

import { useActionState, useRef } from "react";
import {
  uploadSyllabus,
  type UploadSyllabusState,
} from "./syllabus-actions";

export function UploadSyllabusForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState<
    UploadSyllabusState,
    FormData
  >(uploadSyllabus, undefined);

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-dashed border-border bg-zinc-50 p-6"
    >
      <input type="hidden" name="courseId" value={courseId} />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          Initialize this course's ribbon
        </p>
        <p className="text-sm text-muted">
          Upload a syllabus PDF. We'll extract one concept per week with
          Gemini, build the concept groups, and seed every enrolled student at
          0.5 mastery.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept="application/pdf"
          required
          disabled={pending}
          className="block w-full max-w-md text-sm text-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-background file:px-4 file:text-sm file:font-medium file:text-foreground hover:file:bg-zinc-50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Parsing…" : "Generate ribbon"}
        </button>
      </div>

      {state?.ok === false && (
        <p className="mt-3 text-sm text-rose-600">{state.error}</p>
      )}
      {state?.ok === true && (
        <p className="mt-3 text-sm text-emerald-600">
          Created {state.conceptsCreated}{" "}
          {state.conceptsCreated === 1 ? "concept" : "concepts"}. Ribbon below
          is now live.
        </p>
      )}
    </form>
  );
}
