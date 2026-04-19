// scripts/backfillMaterials.ts
//
// One-shot backfill: for every subconcept in the database that doesn't yet
// have a `subconcept_materials` row, ask Gemini to invent a plausible
// summary + 5 key_points based on (course code/name + concept label +
// subconcept label). Used to retroactively ground demo content for
// lectures that were uploaded before the materials pipeline existed (or
// where the original file is no longer available).
//
// Idempotent — re-running only hits subconcepts still missing materials.
//
// Usage:
//   npm run backfill:materials                # all courses, missing rows only
//   npx tsx scripts/backfillMaterials.ts --course <uuid>     # one course
//   npx tsx scripts/backfillMaterials.ts --force             # re-fill all rows
//
// Requires:
//   - SUPABASE_SERVICE_ROLE_KEY (service-role bypasses RLS for cross-course writes)
//   - NEXT_PUBLIC_SUPABASE_URL
//   - GEMINI_API_KEY

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as path from "path";
import { GeminiProvider } from "../src/lib/llm/GeminiProvider";

config({ path: path.resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Free-tier Gemini gives 5 requests / minute on gemini-2.5-flash. Stay
// under that with serial processing + a 13s minimum gap between calls.
// (Concurrency=1 + per-call sleep is simpler than a token bucket and the
// run still finishes in ~7-8 minutes for ~30 subconcepts.)
const CONCURRENCY = 1;
const MIN_INTERVAL_MS = 13_000;
const MAX_RETRIES = 5;

interface Args {
  courseId: string | null;
  force: boolean;
}

function parseArgs(): Args {
  const out: Args = { courseId: null, force: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--course") {
      out.courseId = v;
      i++;
    } else if (k === "--force") {
      out.force = true;
    }
  }
  return out;
}

interface SubRow {
  id: string;
  label: string;
  conceptLabel: string;
  courseCode: string;
  courseName: string;
}

async function loadSubconcepts(courseId: string | null): Promise<SubRow[]> {
  // Two-step join via concept → course because PostgREST nested embeds
  // sometimes return the parent as either an object or a single-element
  // array depending on the inferred relationship cardinality. Doing the
  // join client-side is simpler.
  const conceptQuery = admin.from("concepts").select("id, label, course_id");
  const concepts = courseId
    ? await conceptQuery.eq("course_id", courseId)
    : await conceptQuery;
  if (concepts.error) {
    throw new Error(`load concepts failed: ${concepts.error.message}`);
  }
  if (!concepts.data || concepts.data.length === 0) {
    return [];
  }

  const courseIds = Array.from(
    new Set(concepts.data.map((c) => c.course_id as string)),
  );
  const courses = await admin
    .from("courses")
    .select("id, code, name")
    .in("id", courseIds);
  if (courses.error) {
    throw new Error(`load courses failed: ${courses.error.message}`);
  }
  const courseById = new Map(
    (courses.data ?? []).map((c) => [
      c.id as string,
      { code: c.code as string, name: c.name as string },
    ]),
  );
  const conceptById = new Map(
    concepts.data.map((c) => [
      c.id as string,
      { label: c.label as string, courseId: c.course_id as string },
    ]),
  );

  const conceptIds = Array.from(conceptById.keys());
  // Pull subconcepts in chunks. There aren't many in the demo course (~25)
  // but the script is general so handle the unlikely big-course case.
  const subs: SubRow[] = [];
  const CHUNK = 500;
  for (let i = 0; i < conceptIds.length; i += CHUNK) {
    const slice = conceptIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("subconcepts")
      .select("id, label, concept_id")
      .in("concept_id", slice);
    if (error) throw new Error(`load subconcepts failed: ${error.message}`);
    for (const s of data ?? []) {
      const concept = conceptById.get(s.concept_id as string);
      if (!concept) continue;
      const course = courseById.get(concept.courseId);
      if (!course) continue;
      subs.push({
        id: s.id as string,
        label: s.label as string,
        conceptLabel: concept.label,
        courseCode: course.code,
        courseName: course.name,
      });
    }
  }
  return subs;
}

async function loadHaveMaterials(): Promise<Set<string>> {
  // We'll pull all rows and skip ones that already have non-empty content.
  // Empty placeholder rows (summary='' and key_points=[]) are treated as
  // "still need backfill" so a botched earlier pass can be recovered.
  const have = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("subconcept_materials")
      .select("subconcept_id, summary, key_points")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load materials failed: ${error.message}`);
    const batch = data ?? [];
    for (const r of batch) {
      const summary = String(r.summary ?? "").trim();
      const kp = Array.isArray(r.key_points) ? (r.key_points as unknown[]) : [];
      if (summary.length > 0 || kp.length > 0) {
        have.add(r.subconcept_id as string);
      }
    }
    if (batch.length < PAGE) break;
  }
  return have;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Pull a "retry in Ns" hint out of Gemini's RESOURCE_EXHAUSTED error body
// when present; fall back to exponential backoff otherwise.
function retryDelayFromError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/retry in ([0-9.]+)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 1000;
  }
  return null;
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("RESOURCE_EXHAUSTED") || msg.includes('"code":429');
}

async function backfillOne(
  provider: GeminiProvider,
  sub: SubRow,
): Promise<void> {
  const courseLabel = `${sub.courseCode} ${sub.courseName}`.trim();

  let result: { summary: string; keyPoints: string[] } | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      result = await provider.backfillSubconceptMaterials({
        courseLabel,
        conceptLabel: sub.conceptLabel,
        subconceptLabel: sub.label,
      });
      break;
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || attempt === MAX_RETRIES - 1) throw e;
      const wait =
        retryDelayFromError(e) ?? Math.min(60_000, 5_000 * 2 ** attempt);
      console.log(
        `[backfill]   rate-limited, sleeping ${(wait / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(wait);
    }
  }
  if (!result) throw lastErr ?? new Error("backfill failed");

  const { error } = await admin
    .from("subconcept_materials")
    .upsert(
      {
        subconcept_id: sub.id,
        summary: result.summary,
        key_points: result.keyPoints,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "subconcept_id" },
    );
  if (error) {
    throw new Error(`upsert ${sub.id} failed: ${error.message}`);
  }
  console.log(
    `[backfill] ${sub.conceptLabel} > ${sub.label}  (${result.keyPoints.length} pts)`,
  );
}

// Process `tasks` with at most `n` concurrent in-flight workers. Failures
// don't kill the run — we log + continue so a single flaky Gemini call
// doesn't tank a 25-subconcept backfill.
async function runWithConcurrency<T>(
  tasks: T[],
  n: number,
  worker: (item: T) => Promise<void>,
): Promise<{ ok: number; failed: number }> {
  let i = 0;
  let ok = 0;
  let failed = 0;
  let lastStart = 0;
  const inflight: Array<Promise<void>> = [];

  async function next(): Promise<void> {
    if (i >= tasks.length) return;
    const myIndex = i++;
    const item = tasks[myIndex];

    // Throttle so we don't burn through the 5 RPM free-tier budget. Only
    // matters when concurrency=1 in practice.
    const now = Date.now();
    const wait = Math.max(0, lastStart + MIN_INTERVAL_MS - now);
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();

    try {
      await worker(item);
      ok++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill] FAILED on item ${myIndex + 1}: ${msg}`);
    }
    return next();
  }

  for (let k = 0; k < Math.min(n, tasks.length); k++) {
    inflight.push(next());
  }
  await Promise.all(inflight);
  return { ok, failed };
}

async function main() {
  const args = parseArgs();
  const provider = new GeminiProvider();

  console.log(
    `[backfill] loading subconcepts${args.courseId ? ` for course ${args.courseId}` : " (all courses)"}…`,
  );
  const subs = await loadSubconcepts(args.courseId);
  console.log(`[backfill] found ${subs.length} subconcepts`);
  if (subs.length === 0) return;

  let todo: SubRow[];
  if (args.force) {
    todo = subs;
    console.log(`[backfill] --force: will (re)write all ${todo.length} rows`);
  } else {
    const have = await loadHaveMaterials();
    todo = subs.filter((s) => !have.has(s.id));
    console.log(
      `[backfill] ${have.size} already have materials, ${todo.length} need backfill`,
    );
  }
  if (todo.length === 0) {
    console.log("[backfill] nothing to do.");
    return;
  }

  const t0 = Date.now();
  const { ok, failed } = await runWithConcurrency(todo, CONCURRENCY, (s) =>
    backfillOne(provider, s),
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[backfill] done in ${dt}s — ok=${ok} failed=${failed} of ${todo.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
