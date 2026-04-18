# Samples

A scratch area for documents we'll feed into the extraction pipelines later.

## Folder layout

```
samples/
  syllabi/      drop course syllabi here (PDF preferred, .txt also fine)
  lectures/     drop lecture transcripts or audio here
```

## How these get used

Today: nothing — these files just live here.

Later, when we wire up the extraction pipeline:

- **`samples/syllabi/*.pdf`** → text-extract via `unpdf` → Gemini extracts
  concepts + prerequisites → seeds the heatmap rows.
- **`samples/lectures/*.{mp3,m4a,wav}`** → ElevenLabs Scribe transcribes →
  Gemini extracts subconcepts → seeds the heatmap cells under each row.
- **`samples/lectures/*.{txt,md}`** → skip transcription, feed directly to Gemini.

A small CLI script in `scripts/seed-from-samples.ts` will probably pull from
this folder and ingest into the DB for any course you point it at, so you can
iterate on prompts without touching the UI.

## Notes

- Filename convention: `<course-code>__<short-name>.pdf`
  e.g. `cs161__intro.pdf`, `cs161__lecture-04-dp.pdf`. The code lets the
  loader script figure out which course to attach things to.
- Keep these out of the public Vercel bundle — `.next/` excludes the repo
  root by default, but if you ever move them under `public/`, they ship to
  the browser. Don't.
- If you don't want PDFs committed to git, drop a line in this folder's
  `.gitignore` like `*.pdf`. Right now PDFs **are** committed.
