"use client";

import { useActionState } from "react";
import { createCourse, type CreateCourseState } from "./actions";

export function CreateCourseForm() {
  const [state, formAction, pending] = useActionState<
    CreateCourseState,
    FormData
  >(createCourse, undefined);

  return (
    <form
      action={formAction}
      className="mt-6 rounded-3xl border border-zinc-300 bg-zinc-200 p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="code"
          type="text"
          required
          maxLength={32}
          placeholder="CS 161"
          className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 sm:w-36"
        />
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="Design and Analysis of Algorithms"
          className="h-12 flex-1 rounded-xl border border-border bg-background px-4 text-base outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-xl bg-foreground px-6 text-base font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
      {state?.error && (
        <p className="mt-3 px-2 text-sm text-rose-600">{state.error}</p>
      )}
    </form>
  );
}
