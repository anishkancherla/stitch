import type { Metadata } from "next";
import localFont from "next/font/local";
import { Hanken_Grotesk } from "next/font/google";
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
      className={`${hankenGrotesk.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
