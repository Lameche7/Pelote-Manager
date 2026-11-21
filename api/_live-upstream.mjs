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
