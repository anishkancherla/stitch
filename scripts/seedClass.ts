// scripts/seedClass.ts
//
// Bulk-seed a course with synthetic students for testing the professor view,
// realtime aggregation, and the new ribbon at scale.
//
// What it does:
//   1. Creates N auth users (idempotent — re-uses existing ones by email).
//   2. Enrolls each in --course. The DB trigger backfills 0.5 mastery rows.
//   3. Distributes per-subconcept mastery using a per-student "ability" +
//      per-concept noise so the heatmap and aggregate ribbon look realistic
//      (some weak students, some strong, hard concepts skew low, etc.).
//
// Usage:
//   # Default: 50 students into CS 161 with password "stitch1234"
//   npx tsx scripts/seedClass.ts
//
//   # Specific course + count + prefix
//   npx tsx scripts/seedClass.ts --course <uuid> --n 200 --prefix loadtest
//
//   # Tear down everything we created
//   npx tsx scripts/seedClass.ts --cleanup --prefix loadtest
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local. Service-role bypasses
// RLS — never ship this script's logic into the runtime app.

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

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

interface Args {
  course: string;
  n: number;
  prefix: string;
  password: string;
  cleanup: boolean;
}

function parseArgs(): Args {
  const a: Args = {
    course: "8f205a5f-c775-4148-a28d-c5996429ed95", // CS 161 from cs161_demo.sql
    n: 50,
    prefix: "loadstudent",
    password: "stitch1234",
    cleanup: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--course") (a.course = v), i++;
    else if (k === "--n") (a.n = Number(v)), i++;
    else if (k === "--prefix") (a.prefix = v), i++;
    else if (k === "--password") (a.password = v), i++;
    else if (k === "--cleanup") a.cleanup = true;
  }
  return a;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function emailFor(prefix: string, i: number): string {
  return `${prefix}${String(i).padStart(4, "0")}@stitch.test`;
}

// pageable list of all auth users — admin.listUsers paginates 50 at a time.
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

// Box-Muller -> standard normal, clamped to [0,1] after a logistic squish so
// the distribution stays bell-shaped without tails escaping the range.
function gauss01(mean: number, sd: number): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.max(1e-9, Math.random());
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const x = mean + sd * z;
  return Math.max(0, Math.min(1, x));
}

// ---------------------------------------------------------------------------
// cleanup mode
// ---------------------------------------------------------------------------

async function cleanup(prefix: string) {
  console.log(`[cleanup] removing auth users matching "${prefix}…@stitch.test"`);
  const all = await listAllAuthUsers();
  const targets = all.filter(
    (u) => u.email && u.email.startsWith(prefix) && u.email.endsWith("@stitch.test")
  );
  console.log(`[cleanup] found ${targets.length} matching users`);
  let n = 0;
  for (const u of targets) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.warn(`[cleanup] delete ${u.email} failed: ${error.message}`);
    else n++;
    if (n % 25 === 0) console.log(`[cleanup] deleted ${n}/${targets.length}`);
  }
  // ON DELETE CASCADE in the schema removes enrollments + mastery rows.
  console.log(`[cleanup] done — deleted ${n} users`);
}

// ---------------------------------------------------------------------------
// seed mode
// ---------------------------------------------------------------------------

async function seed(args: Args) {
  console.log(`[seed] course=${args.course} n=${args.n} prefix=${args.prefix}`);

  // 0. Sanity: course exists?
  const { data: course, error: cerr } = await admin
    .from("courses")
    .select("id, code, name")
    .eq("id", args.course)
    .single();
  if (cerr || !course) {
    console.error(`[seed] course ${args.course} not found: ${cerr?.message}`);
    process.exit(1);
  }
  console.log(`[seed] course: ${course.code} — ${course.name}`);

  // 1. Pull subconcepts (with concept_id) so we can shape per-concept mastery.
  const { data: subs, error: serr } = await admin
    .from("subconcepts")
    .select("id, concept_id, label, concepts!inner(course_id)")
    .eq("concepts.course_id", args.course);
  if (serr) {
    console.error(`[seed] failed to load subconcepts: ${serr.message}`);
    process.exit(1);
  }
  if (!subs || subs.length === 0) {
    console.error(`[seed] no subconcepts in this course yet — upload a syllabus + lecture first`);
    process.exit(1);
  }
  console.log(`[seed] subconcepts in course: ${subs.length}`);

  // Per-concept "difficulty" — some concepts the class collectively struggles
  // with. Same for every student, derived deterministically from concept_id
  // so re-runs are stable.
  const conceptDifficulty = new Map<string, number>();
  for (const s of subs) {
    if (!conceptDifficulty.has(s.concept_id)) {
      // hash the uuid bytes -> [0..1] difficulty
      const h = [...s.concept_id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
      conceptDifficulty.set(s.concept_id, (h % 1000) / 1000);
    }
  }

  // 2. Pre-load existing auth users so we don't try to recreate.
  const existing = await listAllAuthUsers();
  const byEmail = new Map(existing.filter((u) => u.email).map((u) => [u.email!, u.id]));

  const userIds: string[] = [];

  // 3. Create or reuse users, then enroll. Sequentially with a small batch —
  //    auth.admin doesn't love being hammered.
  for (let i = 1; i <= args.n; i++) {
    const email = emailFor(args.prefix, i);
    let userId = byEmail.get(email);

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: args.password,
        email_confirm: true,
        user_metadata: { name: `Test Student ${i}`, role: "student" },
      });
      if (error || !data.user) {
        console.warn(`[seed] createUser ${email} failed: ${error?.message}`);
        continue;
      }
      userId = data.user.id;
    }

    // Enroll. Trigger backfills mastery to 0.5 for every subconcept.
    const { error: eerr } = await admin
      .from("enrollments")
      .upsert({ user_id: userId, course_id: args.course }, { onConflict: "user_id,course_id" });
    if (eerr) {
      console.warn(`[seed] enroll ${email} failed: ${eerr.message}`);
      continue;
    }

    userIds.push(userId);
    if (i % 25 === 0) console.log(`[seed] users provisioned: ${i}/${args.n}`);
  }
  console.log(`[seed] usable students: ${userIds.length}`);

  // 4. Mastery distribution. Per student: ability ~ N(0.6, 0.15). Per cell:
  //    score = clamp(ability - difficulty*0.4 + N(0, 0.12)) so weak concepts
  //    drag everyone down a bit and noise gives the heatmap texture.
  const rows: Array<{
    user_id: string;
    subconcept_id: string;
    score: number;
    last_updated: string;
  }> = [];
  const now = new Date().toISOString();
  for (const uid of userIds) {
    const ability = gauss01(0.6, 0.15);
    for (const s of subs) {
      const diff = conceptDifficulty.get(s.concept_id) ?? 0.5;
      const score = gauss01(ability - (diff - 0.5) * 0.5, 0.12);
      rows.push({ user_id: uid, subconcept_id: s.id, score, last_updated: now });
    }
  }

  // 5. Bulk upsert mastery in chunks. Service-role bypasses RLS.
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
    if (i % (CHUNK * 5) === 0) console.log(`[seed] mastery rows written: ${written}/${rows.length}`);
  }

  console.log(
    `[seed] done. ${userIds.length} students enrolled, ${written} mastery rows updated.`
  );
  console.log(`[seed] login as any of:`);
  console.log(`         ${emailFor(args.prefix, 1)}  /  ${args.password}`);
  console.log(`         ${emailFor(args.prefix, args.n)}  /  ${args.password}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  if (args.cleanup) await cleanup(args.prefix);
  else await seed(args);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
