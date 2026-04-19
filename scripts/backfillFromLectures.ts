// scripts/backfillFromLectures.ts
//
// Faster + better-grounded variant of `backfillMaterials.ts`. Instead of
// asking Gemini to invent lecture material from a label, we:
//
//   1. Walk every PPTX/PDF in `samples/lectures/`,
//   2. Run the existing `parseLecture()` Gemini pipeline on each (which
//      extracts 3-5 subconcepts + per-subconcept summary + key_points
//      straight from the slide text),
//   3. Match each extracted (label, summary, key_points) triple against an
//      existing `subconcepts` row by case-insensitive label, and
//   4. Upsert into `subconcept_materials`.
//
// Anything left empty after the lecture pass falls back to the AI-invention
// path (`backfillSubconceptMaterials`) so no subconcept stays unfilled.
//
// Both stages respect Gemini free tier (5 RPM): serial calls with a 13s
// minimum gap, plus retry-with-backoff on 429.
//
// Usage:
//   npm run backfill:lectures            # default: samples/lectures
//   npx tsx scripts/backfillFromLectures.ts --dir <abs/relative path>

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as fs from "fs";
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

// 5 RPM free tier → ≥12s/call; pad to 13s to keep server-side jitter from
// nudging us over.
const MIN_INTERVAL_MS = 13_000;
const MAX_RETRIES = 5;

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";

function parseArgs() {
  let dir = path.resolve(__dirname, "../samples/lectures");
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") {
      dir = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { dir };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("RESOURCE_EXHAUSTED") || msg.includes('"code":429');
}

function retryDelayFromError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([0-9.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 1000;
  return null;
}

// Wrap any provider call so a single 429 doesn't kill the whole run. Used
// for both lecture parsing and label-fallback inventing.
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || attempt === MAX_RETRIES - 1) throw e;
      const wait =
        retryDelayFromError(e) ?? Math.min(60_000, 5_000 * 2 ** attempt);
      console.log(
        `[backfill]   ${label}: rate-limited, sleeping ${(wait / 1000).toFixed(1)}s (try ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`${label}: failed after ${MAX_RETRIES} retries`);
}

// Single in-process throttle so Gemini stays under 5 RPM regardless of
// which call site fires next (lecture parse vs. label invent).
let lastGeminiAt = 0;
async function gateGemini(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastGeminiAt + MIN_INTERVAL_MS - now);
  if (wait > 0) {
    await sleep(wait);
  }
  lastGeminiAt = Date.now();
}

interface SubRow {
  id: string;
  label: string;
  conceptLabel: string;
  courseLabel: string;
}

async function loadAllSubconcepts(): Promise<SubRow[]> {
  const { data: concepts, error: cErr } = await admin
    .from("concepts")
    .select("id, label, course_id");
  if (cErr) throw new Error(`load concepts failed: ${cErr.message}`);

  const courseIds = Array.from(
    new Set((concepts ?? []).map((c) => c.course_id as string)),
  );
  const { data: courses, error: coErr } = await admin
    .from("courses")
    .select("id, code, name")
    .in("id", courseIds);
  if (coErr) throw new Error(`load courses failed: ${coErr.message}`);

  const courseLabelById = new Map(
    (courses ?? []).map((c) => [
      c.id as string,
      `${c.code} ${c.name}`.trim(),
    ]),
  );
  const conceptById = new Map(
    (concepts ?? []).map((c) => [
      c.id as string,
      {
        label: c.label as string,
        course: courseLabelById.get(c.course_id as string) ?? "",
      },
    ]),
  );

  const conceptIds = Array.from(conceptById.keys());
  const { data: subs, error: sErr } = await admin
    .from("subconcepts")
    .select("id, label, concept_id")
    .in("concept_id", conceptIds);
  if (sErr) throw new Error(`load subconcepts failed: ${sErr.message}`);

  return (subs ?? []).map((s) => {
    const c = conceptById.get(s.concept_id as string)!;
    return {
      id: s.id as string,
      label: s.label as string,
      conceptLabel: c.label,
      courseLabel: c.course,
    };
  });
}

async function loadAlreadyFilled(): Promise<Set<string>> {
  const filled = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("subconcept_materials")
      .select("subconcept_id, summary, key_points")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load materials failed: ${error.message}`);
    const batch = data ?? [];
    for (const r of batch) {
      const s = String(r.summary ?? "").trim();
      const kp = Array.isArray(r.key_points) ? (r.key_points as unknown[]) : [];
      if (s.length > 0 || kp.length > 0) {
        filled.add(r.subconcept_id as string);
      }
    }
    if (batch.length < PAGE) break;
  }
  return filled;
}

function normalize(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cheap word-set Jaccard so "Big-O Notation" matches
// "Big-O, Big-Theta, and Big-Omega Notation" without hauling in a full
// fuzzy lib. Good enough for ~30 candidate labels per course.
function similarity(a: string, b: string): number {
  const aw = new Set(normalize(a).split(" ").filter(Boolean));
  const bw = new Set(normalize(b).split(" ").filter(Boolean));
  if (aw.size === 0 || bw.size === 0) return 0;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  return inter / Math.max(aw.size, bw.size);
}

function bestMatch(
  parsedLabel: string,
  candidates: SubRow[],
): { sub: SubRow; score: number } | null {
  let best: { sub: SubRow; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(parsedLabel, c.label);
    if (!best || score > best.score) best = { sub: c, score };
  }
  return best;
}

function mimeForFile(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return PDF_MIME;
  if (ext === ".pptx") return PPTX_MIME;
  return null;
}

interface ParsedMaterial {
  label: string;
  summary: string;
  keyPoints: string[];
}

async function parseOneLecture(
  provider: GeminiProvider,
  filePath: string,
): Promise<ParsedMaterial[]> {
  const buf = fs.readFileSync(filePath);
  const mime = mimeForFile(filePath);
  if (!mime) {
    console.warn(`[backfill] skipping unsupported file ${filePath}`);
    return [];
  }
  const blob = new Blob([new Uint8Array(buf)], { type: mime });
  await gateGemini();
  const result = await withRetry(
    `parseLecture(${path.basename(filePath)})`,
    () => provider.parseLecture(blob, mime),
  );
  const out: ParsedMaterial[] = [];
  const subs = result.subconcepts ?? [];
  const mats = result.materials ?? [];
  for (let i = 0; i < subs.length; i++) {
    const label = String(subs[i] ?? "").trim();
    if (!label) continue;
    const m = mats[i];
    const summary = String(m?.summary ?? "").trim();
    const keyPoints = Array.isArray(m?.keyPoints)
      ? m!.keyPoints.map((kp) => String(kp ?? "").trim()).filter(Boolean)
      : [];
    if (!summary && keyPoints.length === 0) continue;
    out.push({ label, summary, keyPoints });
  }
  return out;
}

async function upsertMaterial(
  subconceptId: string,
  summary: string,
  keyPoints: string[],
): Promise<void> {
  const { error } = await admin.from("subconcept_materials").upsert(
    {
      subconcept_id: subconceptId,
      summary,
      key_points: keyPoints,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "subconcept_id" },
  );
  if (error) throw new Error(`upsert ${subconceptId} failed: ${error.message}`);
}

async function main() {
  const { dir } = parseArgs();
  const provider = new GeminiProvider();

  console.log(`[backfill] loading subconcepts and existing materials…`);
  const allSubs = await loadAllSubconcepts();
  const filled = await loadAlreadyFilled();
  console.log(
    `[backfill] subconcepts=${allSubs.length}, already filled=${filled.size}, need=${allSubs.length - filled.size}`,
  );

  // Stage 1 — parse provided lecture files and apply by best-label match.
  // Match scope is restricted to subconcepts that haven't been filled yet,
  // so a re-run after AI-invention won't blow away earlier writes.
  if (!fs.existsSync(dir)) {
    console.warn(`[backfill] dir ${dir} does not exist; skipping lecture pass`);
  } else {
    const files = fs
      .readdirSync(dir)
      .filter((f) => mimeForFile(f) !== null)
      .map((f) => path.join(dir, f))
      .sort();
    console.log(`[backfill] found ${files.length} lecture files in ${dir}`);

    const claimed = new Set<string>(); // sub ids we've already filled this run
    for (const file of files) {
      console.log(`[backfill] parsing ${path.basename(file)}…`);
      let materials: ParsedMaterial[] = [];
      try {
        materials = await parseOneLecture(provider, file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[backfill]   parse failed: ${msg}`);
        continue;
      }
      console.log(
        `[backfill]   extracted ${materials.length} subconcept material entries`,
      );

      // Match against any subconcept that is (a) not yet filled in DB and
      // (b) not yet claimed earlier in this run. Threshold 0.4 trims
      // accidental cross-week matches ("Notation" alone is too generic).
      const candidates = allSubs.filter(
        (s) => !filled.has(s.id) && !claimed.has(s.id),
      );
      for (const m of materials) {
        const match = bestMatch(m.label, candidates);
        if (!match || match.score < 0.4) {
          console.log(
            `[backfill]   no DB match for "${m.label}" (best score ${(
              match?.score ?? 0
            ).toFixed(2)})`,
          );
          continue;
        }
        try {
          await upsertMaterial(match.sub.id, m.summary, m.keyPoints);
          claimed.add(match.sub.id);
          console.log(
            `[backfill]   "${m.label}" → "${match.sub.label}" (score ${match.score.toFixed(2)}, ${m.keyPoints.length} pts)`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[backfill]   upsert failed: ${msg}`);
        }
      }
    }
  }

  // Stage 2 — for any subconcept still unfilled, AI-invent grounded by its
  // label + parent concept + course. Slow path but covers the long tail.
  const stillFilled = await loadAlreadyFilled();
  const stillEmpty = allSubs.filter((s) => !stillFilled.has(s.id));
  console.log(
    `[backfill] after lecture pass: ${stillFilled.size}/${allSubs.length} filled, ${stillEmpty.length} remaining`,
  );

  if (stillEmpty.length === 0) {
    console.log("[backfill] done — all subconcepts have materials.");
    return;
  }

  console.log(
    `[backfill] AI-inventing materials for ${stillEmpty.length} leftover subconcept(s) (~${(
      (stillEmpty.length * MIN_INTERVAL_MS) /
      1000
    ).toFixed(0)}s)…`,
  );

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < stillEmpty.length; i++) {
    const s = stillEmpty[i];
    try {
      await gateGemini();
      const r = await withRetry(`invent(${s.label})`, () =>
        provider.backfillSubconceptMaterials({
          courseLabel: s.courseLabel,
          conceptLabel: s.conceptLabel,
          subconceptLabel: s.label,
        }),
      );
      await upsertMaterial(s.id, r.summary, r.keyPoints);
      ok++;
      console.log(
        `[backfill]   [${i + 1}/${stillEmpty.length}] invented: ${s.conceptLabel} > ${s.label} (${r.keyPoints.length} pts)`,
      );
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill]   [${i + 1}/${stillEmpty.length}] FAILED ${s.label}: ${msg}`);
    }
  }
  console.log(`[backfill] invent stage done — ok=${ok} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
