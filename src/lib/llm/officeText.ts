import JSZip from "jszip";

/**
 * Tiny text extractor for the office formats Gemini won't accept directly
 * (PPTX, DOCX). We unzip in-memory and pull `<a:t>` / `<w:t>` runs out of the
 * relevant XML parts. No layout, no images — just enough text for the LLM to
 * extract concept-level subconcepts from.
 */

const T_TAG_RE = /<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g;
const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textFromXml(xml: string): string {
  const out: string[] = [];
  for (const m of xml.matchAll(T_TAG_RE)) {
    const piece = decodeEntities(m[1]).trim();
    if (piece) out.push(piece);
  }
  return out.join("\n");
}

export async function extractPptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((p) => {
      const m = p.match(SLIDE_PATH_RE);
      return m ? { path: p, n: parseInt(m[1], 10) } : null;
    })
    .filter((x): x is { path: string; n: number } => x !== null)
    .sort((a, b) => a.n - b.n);

  if (slides.length === 0) {
    throw new Error("No slides found in PPTX (zip didn't contain ppt/slides/*.xml).");
  }

  const sections: string[] = [];
  for (const s of slides) {
    const xml = await zip.files[s.path].async("string");
    const text = textFromXml(xml);
    if (text) sections.push(`--- Slide ${s.n} ---\n${text}`);
  }
  return sections.join("\n\n");
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.files["word/document.xml"];
  if (!file) {
    throw new Error("Missing word/document.xml — file may not be a DOCX.");
  }
  const xml = await file.async("string");
  return textFromXml(xml);
}

export function extractPlainText(buf: Buffer): string {
  return buf.toString("utf8");
}
