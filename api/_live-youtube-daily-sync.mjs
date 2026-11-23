import { timingSafeEqual } from "node:crypto";
import {
  privilegedHeaders,
  synchronizeClubVideos,
} from "./_live-youtube-broadcast.mjs";
import { LiveAuthError, required } from "./_live-google-shared.mjs";

export function authorizedCron(request, env) {
  const expected = required(env, "CRON_SECRET");
  if (expected.length < 32)
    throw new LiveAuthError(503, "Planification non configurée.");
  const supplied = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  const a = Buffer.from(supplied || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new LiveAuthError(401, "Accès non autorisé.");
}

export async function reconcileDailyVideos(env, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const headers = privilegedHeaders(env);
  // Discover clubs server-side; never accept a club ID supplied by the caller.
  const params = new URLSearchParams({
    select: "club_id",
    status: "in.(scheduled,live,replay)",
    limit: "1000",
  });
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_videos?${params}`,
    { headers, cache: "no-store" },
  );
  if (!response.ok)
    throw new LiveAuthError(502, "Inventaire des directs indisponible.");
  const records = await response.json();
  if (!Array.isArray(records) || records.length >= 1000)
    throw new LiveAuthError(503, "Trop de directs à synchroniser.");
  const clubs = [...new Set(records.map((video) => video.club_id))];
  if (clubs.length > 20 || clubs.some((id) => !/^[0-9a-f-]{36}$/i.test(id)))
    throw new LiveAuthError(503, "Liste des clubs invalide.");
  if (!clubs.length) return { clubs: 0, updated: 0 };

  const channelResponse = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_youtube_channel?id=eq.true&select=channel_id`,
    { headers, cache: "no-store" },
  );
  if (!channelResponse.ok)
    throw new LiveAuthError(503, "Chaîne YouTube indisponible.");
  const channel = (await channelResponse.json())?.[0]?.channel_id;
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel || ""))
    throw new LiveAuthError(503, "Identifiant de chaîne YouTube invalide.");

  let updated = 0;
  for (const clubId of clubs) {
    updated += await synchronizeClubVideos(env, clubId, channel, fetchImpl);
  }
  return { clubs: clubs.length, updated };
}
