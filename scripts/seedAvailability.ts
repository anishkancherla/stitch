// scripts/seedAvailability.ts
//
// Mock weekly availability for every demo student so the contextual matcher
// has a real overlap signal to work with. Without this, every match row
// reads "No shared availability set" and the score's overlap term sits at
// zero, so ranking degenerates to pure mastery delta.
//
// Design:
//   - 8 schedule profiles (early bird, daytime, late afternoon, evening,
//     late night, weekend warrior, lunch crew, mixed). Each is a small
//     set of weekly free blocks.
//   - The 50 loadstudent users get one of the 8 profiles by index round-
//     robin, so within an archetype there's still scheduling variety.
//   - The demo student@test.com gets a hand-tuned schedule that overlaps
//     with several profiles (afternoon + evening + weekend morning) so
//     the live demo shows varied overlap hours instead of all-zeros.
//
// Re-running is safe: we delete each user's existing manual blocks before
// re-inserting. 'gcal' rows (none yet) are left alone.
//
// Usage:
//   npx tsx scripts/seedAvailability.ts

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as path from "path";

config({ path: path.resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const TEST_STUDENT_EMAIL = "student@test.com";
const PREFIX = "loadstudent";
const N = 50;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Block = { dayOfWeek: number; start: string; end: string };

// 0 = Sunday, 6 = Saturday. Times are 24h "HH:MM".
const PROFILES: { name: string; blocks: Block[] }[] = [
  {
    name: "Early bird",
    blocks: [
      { dayOfWeek: 1, start: "08:00", end: "10:30" },
      { dayOfWeek: 2, start: "07:30", end: "09:30" },
      { dayOfWeek: 3, start: "08:00", end: "10:30" },
      { dayOfWeek: 4, start: "07:30", end: "09:30" },
      { dayOfWeek: 5, start: "08:00", end: "10:30" },
      { dayOfWeek: 6, start: "09:00", end: "11:00" },
    ],
  },
  {
    name: "Daytime",
    blocks: [
      { dayOfWeek: 1, start: "13:00", end: "16:00" },
      { dayOfWeek: 2, start: "13:00", end: "16:00" },
      { dayOfWeek: 3, start: "13:00", end: "16:00" },
      { dayOfWeek: 4, start: "13:00", end: "16:00" },
      { dayOfWeek: 5, start: "13:00", end: "15:00" },
    ],
  },
  {
    name: "Late afternoon",
    blocks: [
      { dayOfWeek: 1, start: "16:00", end: "18:00" },
      { dayOfWeek: 2, start: "16:00", end: "18:00" },
      { dayOfWeek: 4, start: "16:00", end: "18:00" },
      { dayOfWeek: 0, start: "15:00", end: "17:00" },
    ],
  },
  {
    name: "Evening",
    blocks: [
      { dayOfWeek: 2, start: "19:00", end: "22:00" },
      { dayOfWeek: 4, start: "19:00", end: "22:00" },
      { dayOfWeek: 5, start: "20:00", end: "23:00" },
    ],
  },
  {
    name: "Late night",
    blocks: [
      { dayOfWeek: 1, start: "21:00", end: "23:00" },
      { dayOfWeek: 3, start: "21:00", end: "23:00" },
      // Sat 22:00–23:30 — keep clear of midnight so the half-open interval
      // doesn't bump into the next day.
      { dayOfWeek: 6, start: "22:00", end: "23:30" },
    ],
  },
  {
    name: "Weekend warrior",
    blocks: [
      { dayOfWeek: 6, start: "10:00", end: "15:00" },
      { dayOfWeek: 0, start: "12:00", end: "17:00" },
    ],
  },
  {
    name: "Lunch crew",
    blocks: [
      { dayOfWeek: 1, start: "12:00", end: "13:30" },
      { dayOfWeek: 2, start: "12:00", end: "13:30" },
      { dayOfWeek: 3, start: "12:00", end: "13:30" },
      { dayOfWeek: 4, start: "12:00", end: "13:30" },
      { dayOfWeek: 5, start: "12:00", end: "13:30" },
    ],
  },
  {
    name: "Mixed",
    blocks: [
      { dayOfWeek: 1, start: "09:00", end: "11:00" },
      { dayOfWeek: 3, start: "15:00", end: "17:00" },
      { dayOfWeek: 5, start: "19:00", end: "21:00" },
      { dayOfWeek: 6, start: "14:00", end: "16:00" },
    ],
  },
];

// Demo student schedule. Hand-tuned so it overlaps with the Daytime, Late
// afternoon, Evening, and Weekend warrior profiles — the demo will see
// 3-4 candidates with non-zero overlap on most concepts.
const TEST_STUDENT_PROFILE: Block[] = [
  { dayOfWeek: 1, start: "14:00", end: "17:00" },
  { dayOfWeek: 3, start: "14:00", end: "17:00" },
  { dayOfWeek: 5, start: "14:00", end: "17:00" },
  { dayOfWeek: 2, start: "19:30", end: "21:30" },
  { dayOfWeek: 4, start: "19:30", end: "21:30" },
  { dayOfWeek: 6, start: "10:00", end: "13:00" },
];

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

async function main() {
  const all = await listAllAuthUsers();
  const byEmail = new Map(all.filter((u) => u.email).map((u) => [u.email!, u.id]));

  const targets: Array<{
    id: string;
    email: string;
    profileName: string;
    blocks: Block[];
  }> = [];

  for (let i = 1; i <= N; i++) {
    const email = emailFor(i);
    const id = byEmail.get(email);
    if (!id) {
      console.warn(`[seed-avail] missing auth user ${email} — run seedClass first`);
      continue;
    }
    const profile = PROFILES[(i - 1) % PROFILES.length];
    targets.push({ id, email, profileName: profile.name, blocks: profile.blocks });
  }

  const testId = byEmail.get(TEST_STUDENT_EMAIL);
  if (testId) {
    targets.push({
      id: testId,
      email: TEST_STUDENT_EMAIL,
      profileName: "Demo overlap-rich",
      blocks: TEST_STUDENT_PROFILE,
    });
  } else {
    console.warn(`[seed-avail] ${TEST_STUDENT_EMAIL} not found — demo student gets nothing`);
  }

  console.log(`[seed-avail] writing availability for ${targets.length} users...`);

  // Distribution sanity log so we can see the round-robin worked.
  const dist = new Map<string, number>();
  for (const t of targets) {
    dist.set(t.profileName, (dist.get(t.profileName) ?? 0) + 1);
  }
  for (const [name, count] of dist) {
    console.log(`  ${name.padEnd(18)} ${count}`);
  }

  let written = 0;
  for (const t of targets) {
    // Wipe existing manual blocks first so re-runs produce a clean slate.
    // We deliberately don't touch source='gcal' rows — those will come from
    // the future Google Calendar sync worker.
    const { error: delErr } = await admin
      .from("user_availability")
      .delete()
      .eq("user_id", t.id)
      .eq("source", "manual");
    if (delErr) {
      console.warn(`[seed-avail] delete ${t.email}: ${delErr.message}`);
      continue;
    }

    const rows = t.blocks.map((b) => ({
      user_id: t.id,
      day_of_week: b.dayOfWeek,
      start_time: `${b.start}:00`,
      end_time: `${b.end}:00`,
      source: "manual" as const,
    }));
    const { error: insErr } = await admin
      .from("user_availability")
      .insert(rows);
    if (insErr) {
      console.warn(`[seed-avail] insert ${t.email}: ${insErr.message}`);
      continue;
    }
    written++;
  }

  console.log(`[seed-avail] wrote schedules for ${written}/${targets.length} users`);
  console.log(`[seed-avail] done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
