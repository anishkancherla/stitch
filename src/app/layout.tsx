import type { Metadata } from "next";
import localFont from "next/font/local";
import { Hanken_Grotesk, Inter } from "next/font/google";
import "./globals.css";

/* ----------------------------------------------------------------------------
 * Fonts
 *   Display (wordmark / headings):  Lora           (serif, local)
 *   Body / UI (everything else):    Hanken Grotesk (sans, Google)
 *
 * Lora is loaded from `src/fonts/`. To swap fonts, replace the source and
 * update `--font-display-serif` / `--font-sans-ui` consumers in globals.css.
 * -------------------------------------------------------------------------- */

const lora = localFont({
  variable: "--font-display-serif",
  src: "../fonts/Lora.ttf",
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-sans-ui",
  subsets: ["latin"],
  display: "swap",
});

// Inter — used as an accent face on a few hero headings (e.g. the
// professor home greeting) where we want a tighter, more geometric look
// than the Hanken body font without committing to the serif display face.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
      className={`${hankenGrotesk.variable} ${lora.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
