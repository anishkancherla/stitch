// scripts/applyMigration.ts
//
// Tiny helper to push a single SQL file into the hosted Postgres using
// Supabase's REST endpoint when supabase-cli isn't wired up. We can't run
// arbitrary SQL through @supabase/supabase-js (PostgREST only does row
// ops), so this hits the project's Postgres directly via a "rpc" stored
// proc named `exec_sql` if it exists; otherwise it falls back to a raw
// fetch against the Supabase Management API using the service-role key
// (which Supabase accepts for the SQL endpoint).
//
// Usage:
//   npx tsx scripts/applyMigration.ts supabase/migrations/0010_weekly_quizzes.sql

import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/applyMigration.ts <path/to/file.sql>");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(file), "utf8");
  console.log(`[migration] applying ${file} (${sql.length} chars)`);

  // Supabase exposes a SQL endpoint at /rest/v1/rpc/exec_sql when the
  // companion function exists. Many projects don't have that, so we use
  // the well-supported pg-meta endpoint instead. The pg-meta endpoint
  // sits at <SUPABASE_URL>/pg/query (sometimes /pg-meta/query); both
  // accept POST with { query } and the service-role key.
  const endpoints = [
    `${SUPABASE_URL}/pg/query`,
    `${SUPABASE_URL}/pg-meta/query`,
  ];

  let lastErr = "";
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      if (res.ok) {
        const text = await res.text();
        console.log(`[migration] applied via ${url}`);
        if (text.trim()) console.log(text);
        return;
      }
      lastErr = `${url} → ${res.status} ${await res.text()}`;
    } catch (e) {
      lastErr = `${url} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  console.error(`[migration] failed. Last error:\n${lastErr}`);
  console.error(
    `\nFallback: paste the SQL into the Supabase SQL Editor manually:\n  ${file}`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
