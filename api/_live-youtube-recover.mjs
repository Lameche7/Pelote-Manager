// Recover a YouTube broadcast deleted outside Pilotoki while preserving its
// club, match association, and internal video UUID. Server-only OAuth/RTMPS.
import { LiveAuthError, required } from "./_live-google-shared.mjs";
import {
  googleAccessToken,
  privilegedHeaders,
  youtubeCreateBroadcast,
} from "./_live-youtube-broadcast.mjs";
import { getClubVideo } from "./_live-youtube-ingest.mjs";
import { resolveVerifiedLiveSlot } from "./_live-calendar-match.mjs";
import { livekitEgressStatus } from "./_live-livekit-egress.mjs";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3/liveBroadcasts";

/**
 * No repair while YouTube cannot be consulted, the video still exists,
 * the caller's match doesn't match, or a room Egress is active.
 * Only the server can create a replacement and swap the exact original row.
 */
export async function recoverMissingYoutubeBroadcast(
  env,
  request,
  clubId,
  channelId,
  fetchImpl = fetch,
  egressStatus = livekitEgressStatus,
  getAccessToken = googleAccessToken,
) {
  const videoId = request.body?.videoId;
  const video = await getClubVideo(env, clubId, videoId, fetchImpl);
  const calendarSlot = request.body?.calendarSlot;
  if (!calendarSlot)
    throw new LiveAuthError(
      400,
      "La rencontre doit être vérifiée depuis le calendrier.",
    );
  const match = await resolveVerifiedLiveSlot(
    env,
    request,
    clubId,
    calendarSlot,
    request.body?.sourceType,
    fetchImpl,
  );
  const base = required(env, "VITE_SUPABASE_URL");
  const rowsParams = new URLSearchParams({
    id: `eq.${video.id}`,
    club_id: `eq.${clubId}`,
    source_id: `eq.${match.sourceId}`,
    source_type: `eq.${match.sourceType}`,
    status: "eq.scheduled",
    select: "id",
    limit: "1",
  });
  const check = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_videos?${rowsParams}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!check.ok)
    throw new LiveAuthError(503, "Vérification de la partie indisponible.");
  if ((await check.json())?.length !== 1)
    throw new LiveAuthError(
      403,
      "Cette diffusion n'est pas liée à la partie sélectionnée.",
    );

  const token = await getAccessToken(env, channelId, fetchImpl);
  const youtubeResponse = await fetchImpl(
    `${YOUTUBE_API}?${new URLSearchParams({
      part: "status",
      id: video.youtube_video_id,
    })}`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!youtubeResponse.ok)
    throw new LiveAuthError(
      503,
      "Impossible de confirmer l'identité YouTube : aucun remplacement effectué.",
    );
  const youtube = await youtubeResponse.json();
  if (!Array.isArray(youtube?.items))
    throw new LiveAuthError(
      503,
      "Réponse YouTube invalide : aucun remplacement effectué.",
    );
  if (youtube.items.length > 0) {
    if (
      youtube.items.length !== 1 ||
      youtube.items[0]?.id !== video.youtube_video_id
    )
      throw new LiveAuthError(
        409,
        "Identité YouTube incohérente : aucun remplacement effectué.",
      );
    const lifecycle = youtube.items[0]?.status?.lifeCycleStatus;
    if (lifecycle === "complete" || lifecycle === "revoked")
      throw new LiveAuthError(
        409,
        "Ce direct YouTube est terminé. Préparez une nouvelle diffusion.",
      );
    return {
      recovered: false,
      videoId: video.id,
      youtubeUrl: `https://www.youtube.com/watch?v=${video.youtube_video_id}`,
    };
  }

  // An absent YouTube event requires explicit adult/children classification.
  if (typeof request.body?.madeForKids !== "boolean")
    return { requiresClassification: true, videoId: video.id };
  if (request.body?.consentConfirmed !== true)
    throw new LiveAuthError(
      400,
      "Confirmez les autorisations de captation et de diffusion.",
    );

  const status = await egressStatus(env, clubId, video.id, fetchImpl);
  if (status.active)
    throw new LiveAuthError(
      409,
      "Une sortie LiveKit fonctionne encore pour cette partie. Arrêtez-la avant de réparer le direct.",
    );

  // Credentials point to the deleted event: invalidate them before replacing
  // it, so the next mobile start can only bind a fresh YouTube RTMPS stream.
  const oldCredentials = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_ingest_credentials?video_id=eq.${video.id}`,
    {
      method: "DELETE",
      headers: privilegedHeaders(env),
      cache: "no-store",
    },
  );
  if (!oldCredentials.ok)
    throw new LiveAuthError(
      503,
      "Impossible d'invalider l'ancien flux YouTube. Aucun remplacement effectué.",
    );

  const replacementId = await youtubeCreateBroadcast(
    token,
    {
      title: video.title,
      sourceType: match.sourceType,
      sourceId: match.sourceId,
      scheduledStartTime: new Date(Date.now() + 180_000).toISOString(),
      madeForKids: request.body.madeForKids,
    },
    fetchImpl,
  );

  // Compare-and-swap prevents overwriting a concurrent launch or another
  // repair. Never change id, club_id, source_id, or match identity.
  const updateParams = new URLSearchParams({
    id: `eq.${video.id}`,
    club_id: `eq.${clubId}`,
    source_id: `eq.${match.sourceId}`,
    youtube_video_id: `eq.${video.youtube_video_id}`,
    status: "eq.scheduled",
    select: "id",
  });
  const updated = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_videos?${updateParams}`,
    {
      method: "PATCH",
      headers: {
        ...privilegedHeaders(env),
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        youtube_video_id: replacementId,
        started_at: null,
      }),
      cache: "no-store",
    },
  );
  if (!updated.ok || (await updated.json())?.length !== 1)
    throw new LiveAuthError(
      409,
      "YouTube a créé un remplacement, mais Pilotoki n'a pas confirmé sa liaison. Ne relancez pas : contactez l'administration.",
    );
  return {
    recovered: true,
    videoId: video.id,
    youtubeUrl: `https://www.youtube.com/watch?v=${replacementId}`,
  };
}
