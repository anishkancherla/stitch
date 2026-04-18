import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* ----------------------------------------------------------------------------
 * Fonts
 *   Display (wordmark / headings):  Lora   (serif)
 *   Body / UI (everything else):    Geist  (sans)
 *
 * Both are loaded from `src/fonts/` as single variable files. To swap them
 * out, replace the `src` path and update `--font-display-serif` /
 * `--font-sans-ui` consumers in globals.css.
 * -------------------------------------------------------------------------- */

const lora = localFont({
  variable: "--font-display-serif",
  src: "../fonts/Lora.ttf",
  display: "swap",
});

const geist = localFont({
  variable: "--font-sans-ui",
  src: "../fonts/Geist.otf",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stitch",
  description:
    "Course knowledge graphs from your syllabus and lectures. Built for professors and students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
