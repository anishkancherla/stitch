"use client";

// Collapsible "Stitch AI" chat panel docked to the right of the step view.
// State is local only — closing the panel discards the conversation. Each
// step has its own `key` so the parent remounts us on step change, which
// also clears history (intentional: AI is grounded in the current step's
// subconcept material).
//
// Server-side: each "Send" calls askStitchAI with the local message
// buffer + the new prompt. The server pulls the step's subconcept_materials
// fresh so we don't have to ship them to the browser.

import { useEffect, useRef, useState, useTransition } from "react";
import { askStitchAI, ChatMessage } from "@/app/space/[id]/chat-actions";

interface StitchAIChatProps {
  spaceId: string;
  stepIdx: number;
  subconceptLabel: string;
}

const SUGGESTED_PROMPTS: string[] = [
  "Explain this in simpler terms",
  "Give me a quick example",
  "Why does this matter?",
  "What's a common mistake here?",
];

export function StitchAIChat({
  spaceId,
  stepIdx,
  subconceptLabel,
}: StitchAIChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the message log when a new turn lands so the latest
  // reply is visible without the user having to scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  function send(prompt: string) {
    const text = prompt.trim();
    if (!text || pending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    startTransition(async () => {
      const res = await askStitchAI(spaceId, stepIdx, messages, text);
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.reply },
        ]);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-opacity hover:opacity-90"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Ask Stitch AI
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-30 flex h-[520px] w-[380px] flex-col rounded-2xl border border-border bg-background shadow-2xl">
      {/* Header */}
      <header className="flex items-center justify-between rounded-t-2xl border-b border-border bg-zinc-50 px-4 py-3">
        <div>
          <p className="font-inter text-sm font-semibold text-foreground">
            Stitch AI
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Grounded in {subconceptLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted transition-colors hover:bg-zinc-200 hover:text-foreground"
          aria-label="Close chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M4.28 3.22a.75.75 0 00-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 101.06 1.06L10 11.06l5.72 5.72a.75.75 0 101.06-1.06L11.06 10l5.72-5.72a.75.75 0 10-1.06-1.06L10 8.94 4.28 3.22z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
      >
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted">
              Ask anything about <span className="font-medium text-foreground">{subconceptLabel}</span>.
              I&apos;m grounded in your professor&apos;s lecture material — I won&apos;t
              give away quiz answers.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  disabled={pending}
                  className="rounded-full border border-border bg-zinc-50 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}

        {pending && (
          <ChatBubble role="assistant" content="…" pending />
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      {/* Composer */}
      <form
        className="border-t border-border bg-background px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Stitch AI…"
            rows={1}
            className="min-h-[36px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatBubble({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-foreground text-background"
            : "border border-border bg-zinc-50 text-foreground"
        } ${pending ? "animate-pulse" : ""}`}
      >
        {content}
      </div>
    </div>
  );
}
