import { createHash } from "node:crypto";
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


/** A stable, club-scoped reference for non-competition calendar slots.
 * UUID is deterministic, but never trusted without the exact slot RPC check.
 */
export function ordinaryCalendarLiveSourceId(clubId, resourceId, startsAt, endsAt) {
  const digest = createHash("sha256")
    .update(JSON.stringify([clubId, resourceId, new Date(startsAt).toISOString(), new Date(endsAt).toISOString()]))
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Verify any genuine calendar slot, including ordinary reservations and free slots.
 * Tournament/championship match IDs remain authoritative where available.
 */
export async function resolveVerifiedLiveSlot(env, request, clubId, selection, kind, fetchImpl = fetch) {
  if (kind === "tournoi" || kind === "championnat") {
    const match = await resolveVerifiedCalendarMatch(env, request, clubId, selection, fetchImpl);
    if (match.sourceType !== kind) throw new LiveAuthError(409, "Type de rencontre incohérent.");
    return match;
  }
  if (kind !== "other") throw new LiveAuthError(400, "Type de diffusion invalide.");
  const { resourceId, startsAt, endsAt } = selection ?? {};
  if (!UUID.test(resourceId ?? "") || !Number.isFinite(Date.parse(startsAt)) ||
      !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new LiveAuthError(400, "Créneau invalide.");
  }
  const base = required(env, "VITE_SUPABASE_URL");
  const resource = await fetchImpl(
    `${base}/rest/v1/reservable_resources?${new URLSearchParams({
      id: `eq.${resourceId}`, club_id: `eq.${clubId}`, select: "id", limit: "1",
    })}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!resource.ok) throw new LiveAuthError(503, "Vérification du terrain indisponible.");
  if ((await resource.json())?.[0]?.id !== resourceId)
    throw new LiveAuthError(403, "Ce terrain n'appartient pas au club actif.");
  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) throw new LiveAuthError(401, "Reconnectez-vous à Pilotoki.");
  const date = new Date(startsAt);
  const rangeStart = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
  const rangeEnd = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  const slotsResponse = await fetchImpl(`${base}/rest/v1/rpc/list_available_slots_v4`, {
    method: "POST",
    headers: {
      apikey: required(env, "VITE_SUPABASE_ANON_KEY"),
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ target_resource_id: resourceId, range_start: rangeStart, range_end: rangeEnd }),
    cache: "no-store",
  });
  if (!slotsResponse.ok) throw new LiveAuthError(503, "Vérification du créneau indisponible.");
  const slots = await slotsResponse.json();
  const exact = Array.isArray(slots) && slots.find((slot) =>
    slot.resource_id === resourceId &&
    Date.parse(slot.starts_at) === Date.parse(startsAt) &&
    Date.parse(slot.ends_at) === Date.parse(endsAt) &&
    ["available", "occupied"].includes(slot.status) &&
    !["match", "championship_match"].includes(slot.occupation_type)
  );
  if (!exact) throw new LiveAuthError(409, "Ce créneau n'est plus disponible pour une diffusion libre.");
  return { sourceId: ordinaryCalendarLiveSourceId(clubId, resourceId, startsAt, endsAt), sourceType: "other" };
}
