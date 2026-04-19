// Shared OpenAI client + thin call helpers.
//
// We swapped off Gemini for the demo because the free-tier `gemini-2.5-flash`
// (and even `flash-lite`) caps at 20 requests/day, which the planner + chat +
// hint + feedback + weekly-quiz generator burn through inside a single demo
// run. OpenAI's pay-as-you-go has no such daily cap and `gpt-4o-mini` is
// cheap enough that a full demo costs ~$0.01.
//
// Keep this file dumb: one client, two call shapes (text / JSON). Each
// caller owns its own prompt + response parsing.

import OpenAI from "openai";

let cached: OpenAI | null = null;

function client(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local.");
  }
  cached = new OpenAI({ apiKey });
  return cached;
}

// Default model for every LLM-touching path in the app. Bumping this in one
// place is enough to swap to gpt-4o, gpt-4.1-mini, etc.
export const DEFAULT_MODEL = "gpt-4o-mini";

export interface CallOptions {
  model?: string;
  /** Force a JSON object response (uses OpenAI's json_object response format). */
  json?: boolean;
  /** Sampling temperature. Defaults to 0.7 for chat, callers override for JSON. */
  temperature?: number;
}

/**
 * Single-turn completion. Returns the model's text reply.
 * For JSON callers, set `json: true` and parse the returned string yourself.
 */
export async function callOpenAI(
  prompt: string,
  opts: CallOptions = {},
): Promise<string> {
  const c = client();
  const res = await c.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: opts.temperature ?? (opts.json ? 0.4 : 0.7),
    response_format: opts.json ? { type: "json_object" } : undefined,
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty response from OpenAI");
  return text;
}
