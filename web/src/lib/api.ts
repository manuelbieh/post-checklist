type Fetch = (url: string) => Promise<Response>;

const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(10_000) });

/** Asks the server whether a list exists, so a mistyped ID doesn't open an empty list. */
export async function fetchListInfo(id: string, fetchImpl: Fetch = defaultFetch): Promise<{ found: boolean; venues: number }> {
  const response = await fetchImpl(`/api/lists/${encodeURIComponent(id)}`);
  if (response.status === 404) return { found: false, venues: 0 };
  if (!response.ok) throw new Error(`Server responded with ${response.status}`);
  const body = (await response.json()) as { venues: number };
  return { found: true, venues: body.venues };
}
