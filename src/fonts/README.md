# Fonts

Drop your font files (`.woff2`, `.woff`, `.ttf`, `.otf`) into this folder.

The app uses two font roles, both wired up in `src/app/layout.tsx`:

| Role             | CSS var          | Tailwind class    | Used for                                           |
| ---------------- | ---------------- | ----------------- | -------------------------------------------------- |
| **Display**      | `--font-display` | `font-display`    | The "stitch" wordmark, page headings.              |
| **Sans (body)**  | `--font-sans`    | `font-sans`       | Everything else — paragraphs, buttons, inputs.     |

## How to swap in your own fonts

1. Drop the file(s) here, e.g. `src/fonts/MyDisplay.woff2` and `src/fonts/MyBody.woff2`.
2. Open `src/app/layout.tsx`.
3. Find the two `localFont({ ... })` blocks at the top — they're currently
   pointing at the placeholder filenames. Change the `src` paths to match your
   filenames.
4. Save. The whole app re-skins on the next request.

## Format notes

- `.woff2` is strongly preferred — best compression, universal browser support.
- If you have multiple weights (Regular, Medium, Bold), pass them as an array
  to `localFont`. The example in `layout.tsx` shows the shape.
- Variable fonts work great too — point `src` at the single `.woff2` file and
  drop the `weight` field.
