"use client";

import { useTransition } from "react";
import { deleteCourse } from "../../actions";

export function DeleteButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Delete this course? Concepts, lectures, quizzes, and student mastery for this course will be deleted."
          )
        ) {
          return;
        }
        startTransition(async () => {
          await deleteCourse(courseId);
        });
      }}
      className="text-xs text-muted hover:text-rose-600 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete course"}
    </button>
  );
}
