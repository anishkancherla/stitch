# Stitch

A classroom-scale peer learning platform with three sides: professors who upload course material, students who track their mastery and find study partners, and live LLM-directed sessions where two matched students actually fix each other's gaps.

## Features

- Mastery ribbon. Per-subconcept heatmap that updates live as quizzes are graded and Stitch Spaces complete.
- Auto-generated weekly quizzes. Grounded in the professor's actual lecture content via extracted summary and key points.
- Smart matching. Finds classmates whose strengths complement your gaps within the same course.
- Stitch Spaces. Two-student rooms where an LLM directs the entire study session step by step. No chat, no ambient AI listening, just a structured program with clear done conditions.
- Lecture grounding. Quiz questions and teaching prompts pull verbatim bullets from the professor's uploaded slides.
- Live sync. Supabase Realtime pushes step transitions and card flips to both browsers within ~100ms with no polling.
- Professor dashboard. Upload syllabus and lectures, see aggregate weak spots across the class, drill into individual students.
- Role-based auth. Students and professors with row-level security on every table.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, RSC, Server Actions) |
| Frontend | React 19, Tailwind CSS 4 |
| Database | Supabase Postgres |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime (Postgres logical replication over WebSocket) |
| LLM (planner + Q&A) | OpenAI GPT-4o-mini |
| LLM (lecture extraction) | Google Gemini 2.0 Flash |
| Document parsing | pdfjs-dist, jszip (for .pptx unpacking) |
| Storage | Supabase Storage |
| Deployment | Vercel |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│  Next.js App Router + React 19 + Tailwind        │
│                                                  │
│  /student ──► ribbon + matching + open spaces    │
│  /professor ──► course mgmt + class heatmap      │
│  /space/[id] ──► live two-student room           │
└────────┬────────────────────────┬────────────────┘
         │ Server Actions         │ WebSocket
         ▼                        ▼
┌─────────────────────┐  ┌──────────────────────┐
│   Next.js Server    │  │  Supabase Realtime   │
│   (Vercel)          │  │  (Postgres WAL ──►   │
│                     │  │   filtered push)     │
│   createStitchSpace │  └──────────┬───────────┘
│   submitStepResponse│             │
│   uploadLecture     │             ▼
│                     │  ┌──────────────────────┐
│   ──► OpenAI        │  │  Supabase Postgres   │
│   ──► Gemini        │◄─┤  + RLS on every table│
│   ──► Supabase      │  │  + logical replication│
└─────────────────────┘  └──────────────────────┘
```

The browser talks to Supabase directly for reads and realtime. The Next.js server is only in the loop for server actions and RSC renders. Nothing about the realtime path requires WebSocket support on the deployment host.

## Development

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- API keys for OpenAI and Gemini

### Setup

```bash
git clone https://github.com/<your-fork>/stitch.git
cd stitch
npm install
cp .env.example .env.local  # fill in your keys
npm run dev
```

Runs on `localhost:3000`.

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
```

### Database setup

Apply the migrations in `supabase/migrations/` in order via the Supabase CLI or dashboard. The migrations create the schema, RLS policies, and add the relevant tables to the `supabase_realtime` publication.

### Backfill scripts

```
npm run backfill:lectures    # extract subconcept materials from uploaded .pptx files
npm run backfill:materials   # regenerate the summary + key_points for existing materials
```

## Project structure

```
src/
  app/
    (auth)/                 login + signup
    student/                student dashboard + course pages + quizzes
    professor/              professor dashboard + course mgmt
    space/[id]/             live Stitch Space room
    profile/                user settings
  lib/
    supabase/               browser, server, and admin clients
    llm/                    provider abstraction + SpacesPlanner + WeeklyQuizGenerator
    spaces.ts               Stitch Spaces types + helpers
    ribbon.ts               mastery heatmap math
    matching.ts             pair-matching logic
supabase/
  migrations/               SQL schema, RLS, realtime publication
scripts/                    backfill + maintenance scripts
samples/lectures/           example .pptx files for the demo course
```

## Database schema (key tables)

| Table | Purpose |
|---|---|
| `users` | Profiles + role (student or professor) |
| `courses` | A class with a join code |
| `enrollments` | Student to course membership |
| `concepts`, `subconcepts` | Course curriculum hierarchy |
| `subconcept_materials` | Summary + key points extracted from lecture uploads |
| `user_subconcept_mastery` | Per-student mastery score in [0, 1] |
| `mastery_events` | Audit log of every mastery change |
| `weekly_quizzes` | Auto-generated quizzes |
| `stitch_spaces` | A live room with `plan_json` and `current_step` |
| `stitch_space_members` | Two rows per space |
| `stitch_space_cards` | One per (space, subconcept, target_user). Status: red, attempted, green |
| `stitch_space_responses` | Quiz answers and "Done" presses |

Every table has RLS. Realtime is enabled on the four `stitch_space_*` tables and the mastery tables.

## How a Stitch Space session runs

1. Requester clicks a weak cell on the ribbon and starts a Space with their match.
2. `createStitchSpace` server action finds weak subconcepts, scopes to the click, fetches lecture material, and asks `SpacesPlanner` to generate the full session in one OpenAI call.
3. The plan is stored as JSONB. One row per (subconcept, weak target) is inserted into `stitch_space_cards`.
4. Both students load `/space/[id]`. The room renders `plan.steps[current_step]`.
5. On submit, `submitStepResponse` writes to Postgres. If everyone required has submitted, it bumps `current_step`. If a quiz passed, it bumps mastery and flips the card to green.
6. Supabase Realtime pushes the row changes to both browsers. Both screens advance in lockstep.
7. When `current_step` runs off the end, status flips to `ended` and both screens show the summary.

See `mdfiles/stitchspaces.md` for the full product spec.
