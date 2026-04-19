// scripts/seedDemo.ts
//
// One-shot demo seeder for the new CS 161 (Algorithms). Replaces the naive
// per-student-ability model in seedClass.ts with an *archetype* model so the
// Stitch matcher actually has interesting things to match on.
//
// Why archetypes:
//   The naive model gave every student a single "ability" number, so a strong
//   student was strong on EVERYTHING and a weak student was weak on
//   EVERYTHING. Pairing them up shows one student teaching all 5 sessions —
//   not interesting, not realistic. Real classes have students with different
//   *specialties*: the theory kid who can derive Big-O but can't write a
//   linked list, the implementer who can build a BST but botches recurrence
//   relations, etc. Stitch's whole pitch is finding *complementary* pairs —
//   so the seed has to produce complementary distributions.
//
// What it does:
//   1. Renames the 50 existing loadstudent000N@stitch.test users to realistic
//      names (so the prof view doesn't read "Test Student 7" everywhere).
//   2. Enrolls all 50 + the demo student@test.com in the new CS 161.
//   3. Assigns each student an archetype with a *strong* subconcept set and
//      a *weak* subconcept set (rest are mid). Generates per-cell mastery
//      with light per-student jitter so within an archetype scores vary.
//   4. Bulk-upserts mastery, only touching subconcepts that exist (weeks 6-10
//      have no subconcepts → no mastery rows → ribbon stays grey there).
//
// Usage:
//   npx tsx scripts/seedDemo.ts
//
// Re-running is safe: enrollments upsert, names overwrite, mastery upserts.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as path from "path";

config({ path: path.resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const COURSE_ID = "9e74784b-11c3-45d9-8ad9-f40daf56870b"; // new CS 161
const TEST_STUDENT_EMAIL = "student@test.com";
const PREFIX = "loadstudent";
const N = 50;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 50 realistic-looking names. Mixed ethnicities so the prof roster doesn't
// look like one demographic. Order is fixed so re-runs are stable.
const NAMES = [
  "Aiden Patel", "Sofia Rodriguez", "Marcus Chen", "Olivia Nguyen", "Ethan Brooks",
  "Maya Thompson", "Liam O'Connor", "Aaliyah Johnson", "Diego Hernandez", "Priya Sharma",
  "Noah Bennett", "Zara Khan", "Lucas Park", "Isabella Martinez", "Caleb Williams",
  "Anika Reddy", "Jonah Reyes", "Emma Wilson", "Tariq Hassan", "Chloe Anderson",
  "Sebastian Cruz", "Layla Ahmed", "Mason Cooper", "Hannah Lee", "Elijah Foster",
  "Jasmine Patel", "Owen Murphy", "Mia Tanaka", "Theo Carter", "Naomi Singh",
  "Wyatt Diaz", "Riley Kim", "Adrian Romero", "Sienna Walsh", "Ezra Goldstein",
  "Camila Vega", "Beckett Jones", "Yara Ibrahim", "Henry Schmidt", "Aria Morales",
  "Felix Wong", "Nora Lindgren", "Jamal Edwards", "Eleanor Chu", "Asher Patel",
  "Vivian Ortiz", "Roman Nakamura", "Eva Hayes", "Quentin Barker", "Lila Bernstein",
];

// ---------------------------------------------------------------------------
// Archetypes
//
// `weak` and `strong` match by case-insensitive substring against the
// subconcept label. Anything not matched lands in "mid". Substrings chosen to
// be unique enough across the 24 subconcepts in weeks 1-5 of CS 161.
//
// Design intent: every subconcept is in some archetype's `strong` set AND
// some archetype's `weak` set, so the matcher always has both teachers and
// learners to draw from. Cross-archetype pairs (e.g. theory × implementer)
// have natural mutual benefit.
// ---------------------------------------------------------------------------

interface Archetype {
  id: string;
  description: string;
  weak: string[];
  strong: string[];
}

const ARCHETYPES: Archetype[] = [
  {
    id: "theory",
    description: "Strong on analysis & notation, weak on writing code",
    weak: [
      "singly linked",
      "doubly linked",
      "stack implementations",
      "merge sort",
      "bst operations",
    ],
    strong: [
      "big-o",
      "analyzing loops",
      "time vs. space",
      "recurrence",
      "performance: average",
    ],
  },
  {
    id: "implementer",
    description: "Codes everything cleanly, fuzzy on the math behind it",
    weak: [
      "big-o",
      "review of recursion",
      "recurrence",
      "time vs. space",
      "tree terminology", // skipped the conceptual lecture, jumped to coding
    ],
    strong: [
      "singly linked",
      "doubly linked",
      "circular linked",
      "stack implementations",
      "merge sort",
      "quicksort",
      "bst operations",
    ],
  },
  {
    id: "ds_master",
    description: "Owns linear & tree data structures, weak on D&C/recursion",
    weak: ["recurrence", "merge sort", "quicksort", "memoization"],
    strong: [
      "static arrays",
      "dynamic arrays",
      "singly linked",
      "stack adt",
      "stack applications",
      "queue adt",
      "tree terminology",
      "tree traversals",
      "binary search tree structure",
    ],
  },
  {
    id: "algo_wizard",
    description: "Sorting & recurrence whiz, weak on the small ADT details",
    weak: [
      "doubly linked",
      "circular linked",
      "queue adt",
      "deques",
      "bst operations",
      "stack applications", // never sat down to enumerate stack use-cases
      "binary search tree structure", // hand-wavy on tree shape vs perf
    ],
    strong: [
      "recurrence",
      "merge sort",
      "quicksort",
      "memoization",
      "practical sorting",
    ],
  },
  {
    id: "forgetful",
    description: "Forgot week 1 foundations, strong on more recent material",
    weak: [
      "big-o",
      "analyzing loops",
      "time vs. space",
      "review of recursion",
      "recurrence",
      "stack adt", // missed the day stacks were introduced
    ],
    strong: [
      "singly linked",
      "merge sort",
      "tree terminology",
      "binary search tree structure",
    ],
  },
];

// ---------------------------------------------------------------------------
// Score generators
// ---------------------------------------------------------------------------

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

// Box-Muller -> normal sample, used for jitter only.
function gauss(mean: number, sd: number): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.max(1e-9, Math.random());
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + sd * z;
}

function scoreFor(label: string, arc: Archetype): number {
  const l = label.toLowerCase();
  const isStrong = arc.strong.some((s) => l.includes(s));
  const isWeak = arc.weak.some((w) => l.includes(w));
  // If a label matches both (shouldn't, but be safe) → take "weak". Realistic:
  // a known-weak topic stays weak even if it overlaps a "strong" cluster.
  if (isWeak) return clamp(gauss(0.22, 0.08), 0.05, 0.4);
  if (isStrong) return clamp(gauss(0.86, 0.06), 0.7, 0.97);
  return clamp(gauss(0.6, 0.1), 0.35, 0.82); // mid
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function listAllAuthUsers(): Promise<Array<{ id: string; email?: string }>> {
  const out: Array<{ id: string; email?: string }> = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    out.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? undefined })));
    if (data.users.length < 200) break;
    page++;
  }
  return out;
}

function emailFor(i: number): string {
  return `${PREFIX}${String(i).padStart(4, "0")}@stitch.test`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Pull subconcepts for the course (only weeks 1-5 have any).
  const { data: subs, error: serr } = await admin
    .from("subconcepts")
    .select("id, label, concept_id, concepts!inner(course_id, label, position_y)")
    .eq("concepts.course_id", COURSE_ID);
  if (serr || !subs) {
    console.error(`[seed] failed to load subconcepts: ${serr?.message}`);
    process.exit(1);
  }
  if (subs.length === 0) {
    console.error("[seed] no subconcepts in course — upload syllabus + lectures first");
    process.exit(1);
  }
  console.log(`[seed] subconcepts in course: ${subs.length} (across weeks 1-5)`);

  // 2. Resolve all 50 loadstudent + the demo Test Student account.
  const all = await listAllAuthUsers();
  const byEmail = new Map(all.filter((u) => u.email).map((u) => [u.email!, u.id]));

  const targets: Array<{ id: string; email: string; name: string; arc: Archetype }> = [];
  for (let i = 1; i <= N; i++) {
    const email = emailFor(i);
    const id = byEmail.get(email);
    if (!id) {
      console.warn(`[seed] missing auth user ${email} — run scripts/seedClass.ts first`);
      continue;
    }
    const name = NAMES[i - 1] ?? `Student ${i}`;
    const arc = ARCHETYPES[(i - 1) % ARCHETYPES.length]; // round-robin → 10 per archetype
    targets.push({ id, email, name, arc });
  }
  console.log(`[seed] resolved ${targets.length}/${N} loadstudent users`);

  // Demo student account — give them the "forgetful" profile so they have a
  // clear weak-on-week-1 story for the Stitch demo. They become target #51.
  const testStudentId = byEmail.get(TEST_STUDENT_EMAIL);
  if (testStudentId) {
    targets.push({
      id: testStudentId,
      email: TEST_STUDENT_EMAIL,
      name: "Test Student",
      arc: ARCHETYPES.find((a) => a.id === "forgetful")!,
    });
    console.log(`[seed] also seeding demo account ${TEST_STUDENT_EMAIL} as 'forgetful'`);
  }

  // 3. Rename the loadstudent users in BOTH places: auth.users metadata
  //    (where the archetype tag lives for debugging) AND public.users.name
  //    (the source of truth for display in the prof view). The handle_new_user
  //    trigger only fires on INSERT, so we have to keep them in sync ourselves.
  //    Demo Test Student account: keep as-is.
  console.log(`[seed] renaming ${targets.length - (testStudentId ? 1 : 0)} loadstudent accounts...`);
  for (const t of targets) {
    if (t.email === TEST_STUDENT_EMAIL) continue;
    const { error: authErr } = await admin.auth.admin.updateUserById(t.id, {
      user_metadata: { name: t.name, role: "student", archetype: t.arc.id },
    });
    if (authErr) console.warn(`[seed] auth rename ${t.email} failed: ${authErr.message}`);
    const { error: pubErr } = await admin
      .from("users")
      .update({ name: t.name })
      .eq("id", t.id);
    if (pubErr) console.warn(`[seed] public.users rename ${t.email} failed: ${pubErr.message}`);
  }

  // 4. Enroll everyone. The DB trigger fans out 0.5 mastery on insert; we'll
  //    overwrite right after with the archetype-based scores.
  console.log(`[seed] enrolling ${targets.length} students in CS 161...`);
  for (const t of targets) {
    const { error } = await admin
      .from("enrollments")
      .upsert(
        { user_id: t.id, course_id: COURSE_ID },
        { onConflict: "user_id,course_id" }
      );
    if (error) console.warn(`[seed] enroll ${t.email} failed: ${error.message}`);
  }

  // 5. Generate mastery rows.
  const now = new Date().toISOString();
  type MasteryRow = {
    user_id: string;
    subconcept_id: string;
    score: number;
    last_updated: string;
  };
  const rows: MasteryRow[] = [];
  for (const t of targets) {
    for (const s of subs) {
      rows.push({
        user_id: t.id,
        subconcept_id: s.id,
        score: scoreFor(s.label, t.arc),
        last_updated: now,
      });
    }
  }
  console.log(`[seed] mastery rows to write: ${rows.length}`);

  // 6. Bulk upsert in chunks.
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await admin
      .from("user_subconcept_mastery")
      .upsert(slice, { onConflict: "user_id,subconcept_id" });
    if (error) {
      console.error(`[seed] mastery upsert failed at chunk ${i}: ${error.message}`);
      break;
    }
    written += slice.length;
  }
  console.log(`[seed] mastery rows written: ${written}/${rows.length}`);

  // 7. Sanity report — distribution per archetype, and a per-subconcept
  //    weak/mid/strong count to confirm pairing viability.
  console.log("\n=== distribution check ===");
  for (const arc of ARCHETYPES) {
    const n = targets.filter((t) => t.arc.id === arc.id).length;
    console.log(`  ${arc.id.padEnd(12)} ${n} students  — ${arc.description}`);
  }

  console.log("\n=== per-subconcept buckets (counts of weak/mid/strong) ===");
  for (const s of subs) {
    const scores = targets.map((t) => scoreFor(s.label, t.arc));
    const weak = scores.filter((x) => x < 0.4).length;
    const mid = scores.filter((x) => x >= 0.4 && x <= 0.7).length;
    const strong = scores.filter((x) => x > 0.7).length;
    const flag =
      weak === 0 || strong === 0 ? "  ⚠ no pair viability" : "";
    console.log(
      `  ${s.label.slice(0, 60).padEnd(60)}  W:${weak}  M:${mid}  S:${strong}${flag}`
    );
  }

  console.log("\n[seed] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
