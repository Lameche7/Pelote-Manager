import {
  googleAccessToken,
  privilegedHeaders,
  listPreparedVideos,
  storePreparedVideo,
  synchronizeClubVideos,
  validateBroadcastInput,
  verifiedLiveClubAdmin,
  youtubeCreateBroadcast,
} from "./_live-youtube-broadcast.mjs";
import { jsonError, LiveAuthError } from "./_live-google-shared.mjs";
import { resolveVerifiedCalendarMatch } from "./_live-calendar-match.mjs";
import { recoverMissingYoutubeBroadcast } from "./_live-youtube-recover.mjs";
import {
  authorizedCron,
  reconcileDailyVideos,
} from "./_live-youtube-daily-sync.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "POST" && request.method !== "GET") {
    response.setHeader("Allow", "POST, GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    // Vercel Cron reuses this existing GET function to stay within Hobby limits.
    if (
      request.method === "GET" &&
      process.env.CRON_SECRET &&
      request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
    ) {
      authorizedCron(request, process.env);
      const result = await reconcileDailyVideos(process.env);
      return response.status(200).json({ ok: true, ...result });
    }
    // Club identity and permissions always come from the authenticated session.
    if (request.method === "GET") {
      const { clubId, channelId } = await verifiedLiveClubAdmin(
        request,
        process.env,
      );
      let syncWarning = false;
      try {
        await synchronizeClubVideos(process.env, clubId, channelId);
      } catch {
        // Listing remains available if YouTube temporarily refuses a status read.
        syncWarning = true;
      }
      const videos = await listPreparedVideos(process.env, clubId);
      return response.status(200).json({ videos, syncWarning });
    }
    if (request.body?.action === "recover_missing") {
      const { clubId, channelId } = await verifiedLiveClubAdmin(
        request,
        process.env,
      );
      const result = await recoverMissingYoutubeBroadcast(
        process.env,
        request,
        clubId,
        channelId,
      );
      return response.status(200).json(result);
    }
    // No side effect on YouTube before validating both the request and club permissions.
    const input = validateBroadcastInput(request.body);
    const { clubId, channelId } = await verifiedLiveClubAdmin(
      request,
      process.env,
    );
    if (request.body?.calendarSlot) {
      const match = await resolveVerifiedCalendarMatch(
        process.env,
        request,
        clubId,
        request.body.calendarSlot,
      );
      if (input.sourceType !== match.sourceType)
        throw new LiveAuthError(409, "Type de rencontre incohérent.");
      input.sourceId = match.sourceId;
      const lookup = new URLSearchParams({
        club_id: `eq.${clubId}`,
        source_id: `eq.${match.sourceId}`,
        select: "id",
        limit: "1",
      });
      const existingResponse = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/pilotoki_live_videos?${lookup}`,
        {
          headers: privilegedHeaders(process.env),
          cache: "no-store",
        },
      );
      if (!existingResponse.ok)
        throw new LiveAuthError(
          503,
          "Vérification des directs existants indisponible.",
        );
      if ((await existingResponse.json())?.length)
        throw new LiveAuthError(
          409,
          "Une vidéo existe déjà pour cette partie. Ouvrez sa régie depuis Pilotoki.",
        );
    }
    const accessToken = await googleAccessToken(process.env, channelId);
    const youtubeVideoId = await youtubeCreateBroadcast(accessToken, input);
    await storePreparedVideo(process.env, clubId, youtubeVideoId, input);
    return response.status(201).json({
      youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      title: input.title,
      scheduledStartTime: input.scheduledStartTime,
      status: "scheduled",
      broadcastAvailable: false,
    });
  } catch (error) {
    return jsonError(response, error);
  }
}
