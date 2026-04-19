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
      className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white"
    >
      <input type="hidden" name="courseId" value={courseId} />

      <p className="text-sm font-medium text-white">
        Initialize this course&apos;s ribbon
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept="application/pdf"
          required
          disabled={pending}
          className="block w-full max-w-md text-sm text-white/80 file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border file:border-white/15 file:bg-white/5 file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-white/10 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-xl bg-white px-5 text-sm font-medium text-neutral-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Parsing…" : "Generate ribbon"}
        </button>
      </div>

      {state?.ok === false && (
        <p className="mt-3 text-sm text-rose-400">{state.error}</p>
      )}
      {state?.ok === true && (
        <p className="mt-3 text-sm text-emerald-400">
          Created {state.conceptsCreated}{" "}
          {state.conceptsCreated === 1 ? "concept" : "concepts"}. Ribbon below
          is now live.
        </p>
      )}
    </form>
  );
}
