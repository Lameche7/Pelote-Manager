const UPSTREAM_USER_URL = "https://studio.upstream.so/api/v1/user";

export async function upstreamConnectionStatus(env, fetchImpl = fetch) {
  const apiKey = env.UPSTREAM_API_TOKEN?.trim();
  if (!apiKey) return { configured: false, connected: false };
  let response;
  try {
    response = await fetchImpl(UPSTREAM_USER_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { configured: true, connected: false };
  }
  // Do not expose the upstream user's identity or the upstream error body.
  // The API may return sensitive metadata that must remain server-side.
  return { configured: true, connected: response.ok };
}

export async function upstreamStreamInventory(env, fetchImpl = fetch) {
  const apiKey = env.UPSTREAM_API_TOKEN?.trim();
  if (!apiKey) return { configured: false, streams: [] };
  let response;
  try {
    response = await fetchImpl(
      "https://studio.upstream.so/api/v1/streams?page=1&per_page=50",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    return { configured: true, unavailable: true, streams: [] };
  }
  if (!response.ok)
    return { configured: true, unavailable: true, streams: [] };
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { configured: true, unavailable: true, streams: [] };
  }
  if (!Array.isArray(payload?.data))
    return { configured: true, unavailable: true, streams: [] };
  // The provider may include destination IDs, RTMP keys or user metadata.
  // Return only the fields needed to identify the pilot's existing stream.
  const streams = payload.data
    .filter((entry) => /^[0-9a-f-]{36}$/i.test(entry?.id || ""))
    .slice(0, 50)
    .map((entry) => ({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name.slice(0, 100) : "Sans titre",
      status: typeof entry.status === "string" ? entry.status.slice(0, 30) : "unknown",
      type: typeof entry.type === "string" ? entry.type.slice(0, 30) : "unknown",
    }));
  return { configured: true, streams };
}
