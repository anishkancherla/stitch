// ---------------------------------------------------------------------------
// fetchAllRows — pagination helper for Supabase reads that may exceed the
// hosted PostgREST row cap (default 1000 rows per response).
//
// Why this exists: queries that return N students × M subconcepts blow
// past 1000 rows easily (a 50-student class with 24 subconcepts is 1200).
// `.range(0, 99999)` doesn't bypass the cap on Supabase's hosted tier —
// the response is still truncated. The only reliable fix is to page
// through with explicit ranges and stop when we get a short page.
//
// Usage:
//   const { rows, error } = await fetchAllRows<MyRowType>((from, to) =>
//     admin.from("table").select("...").range(from, to)
//   );
//
// The builder you return must NOT itself call .range() — fetchAllRows
// owns that. Filters, joins, ordering, etc. are all yours.
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 1000;

type RangedQuery<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => RangedQuery<T>,
  pageSize: number = PAGE_SIZE
): Promise<{ rows: T[]; error: string | null }> {
  const all: T[] = [];
  // Hard ceiling so a runaway loop can't hang a request indefinitely. At
  // PAGE_SIZE=1000 this is 100k rows, which covers every realistic class
  // size by a wide margin and still bails fast if something's off.
  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) return { rows: all, error: error.message };
    const batch = data ?? [];
    all.push(...batch);
    // Short page = we've drained the result set. (PostgREST returns
    // fewer rows than requested when there's nothing left.)
    if (batch.length < pageSize) break;
  }
  return { rows: all, error: null };
}
