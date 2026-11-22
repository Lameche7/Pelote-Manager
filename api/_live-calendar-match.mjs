import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The displayed slot and match ID must be resolved with the caller's session. */
export async function resolveVerifiedCalendarMatch(
  env,
  request,
  clubId,
  selection,
  fetchImpl = fetch,
) {
  const resourceId = selection?.resourceId;
  const startsAt = selection?.startsAt;
  const endsAt = selection?.endsAt;
  if (
    !UUID.test(resourceId ?? "") ||
    typeof startsAt !== "string" ||
    typeof endsAt !== "string" ||
    !Number.isFinite(Date.parse(startsAt)) ||
    !Number.isFinite(Date.parse(endsAt)) ||
    Date.parse(endsAt) <= Date.parse(startsAt)
  )
    throw new LiveAuthError(400, "Créneau de partie invalide.");
  const base = required(env, "VITE_SUPABASE_URL");
  const query = new URLSearchParams({
    id: `eq.${resourceId}`,
    club_id: `eq.${clubId}`,
    select: "id",
    limit: "1",
  });
  const resourceResponse = await fetchImpl(
    `${base}/rest/v1/reservable_resources?${query}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!resourceResponse.ok)
    throw new LiveAuthError(503, "Vérification du terrain indisponible.");
  if ((await resourceResponse.json())?.[0]?.id !== resourceId)
    throw new LiveAuthError(403, "Ce terrain n'appartient pas au club actif.");

  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) throw new LiveAuthError(401, "Session Pilotoki expirée.");
  const response = await fetchImpl(
    `${base}/rest/v1/rpc/resolve_calendar_competition`,
    {
      method: "POST",
      headers: {
        apikey: required(env, "VITE_SUPABASE_ANON_KEY"),
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        target_resource_id: resourceId,
        target_starts_at: startsAt,
        target_ends_at: endsAt,
      }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Vérification de la partie indisponible.");
  const match = await response.json();
  if (
    !UUID.test(match?.matchId ?? "") ||
    !["tournament", "championship"].includes(match?.kind)
  )
    throw new LiveAuthError(
      409,
      "La rencontre n'est plus programmée sur ce créneau.",
    );
  return {
    sourceId: match.matchId,
    sourceType: match.kind === "tournament" ? "tournoi" : "championnat",
  };
}
