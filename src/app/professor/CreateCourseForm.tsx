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
      className="mt-3 rounded-2xl border border-border bg-zinc-50 p-5"
    >
      <p className="text-sm font-medium text-foreground">New course</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          name="code"
          type="text"
          required
          maxLength={32}
          placeholder="CS 161"
          className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 sm:w-32"
        />
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="Design and Analysis of Algorithms"
          className="h-11 flex-1 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
      {state?.error && (
        <p className="mt-2 px-2 text-sm text-rose-600">{state.error}</p>
      )}
    </form>
  );
}
