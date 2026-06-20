// Keyset pagination cursor: opaque base64url of "value|id" where `value` is the
// numeric sort anchor (e.g. createdAt in ms, or hotScore) and `id` is the stable
// tie-break. Extracted from routes/posts.ts so other routes (communities,
// profile lists) can reuse the SAME encode/decode without duplicating it. The
// feed (GET /posts) behavior is unchanged — it imports these.

export interface DecodedCursor {
  value: number;
  id: string;
}

export function encodeCursor(value: number, id: string): string {
  return Buffer.from(`${value}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep <= 0) return null;
    const value = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(value) || id === "") return null;
    return { value, id };
  } catch {
    return null;
  }
}
