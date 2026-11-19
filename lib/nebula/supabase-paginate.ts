/**
 * Paginated select helper.
 *
 * PostgREST (the API layer Supabase exposes) caps result sets at a default
 * `max-rows` of 1000. Plain `.select(...)` queries silently truncate at
 * that limit, which is a footgun for our reads — the catalog has 12k+
 * books and we want them all.
 *
 * `paginatedSelect(buildQuery, pageSize)` repeatedly invokes a query
 * builder with `.range(offset, offset + pageSize - 1)` until a short page
 * comes back, then concatenates the results.
 *
 * Usage:
 *   const allBooks = await paginatedSelect((from, to) =>
 *     supabase.from("nb_books").select("id, title").range(from, to)
 *   );
 */

export type PageBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function paginatedSelect<T>(
  build: PageBuilder<T>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  // Hard cap to prevent runaway loops if the DB returns full pages forever
  // (shouldn't happen, but safety belt).
  const MAX_PAGES = 200; // 200 × 1000 = 200k rows, well above any catalog size we expect
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(offset, offset + pageSize - 1);
    if (error) throw new Error(`paginatedSelect: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.push(row);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}
