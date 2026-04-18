import { randomBytes } from "node:crypto";

/**
 * 6-character uppercase alphanumeric join code, e.g. "X7B2KQ".
 *
 * Uses a 32-char alphabet with the easily-confused glyphs removed
 * (no 0, O, 1, I) so codes are safer to dictate verbally.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
