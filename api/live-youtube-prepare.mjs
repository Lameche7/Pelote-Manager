import {
  googleAccessToken,
  listPreparedVideos,
  storePreparedVideo,
  synchronizeClubVideos,
  validateBroadcastInput,
  verifiedLiveClubAdmin,
  youtubeCreateBroadcast,
} from "./_live-youtube-broadcast.mjs";
import { jsonError } from "./_live-google-shared.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "POST" && request.method !== "GET") {
    response.setHeader("Allow", "POST, GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
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
    // No side effect on YouTube before validating both the request and club permissions.
    const input = validateBroadcastInput(request.body);
    const { clubId, channelId } = await verifiedLiveClubAdmin(
      request,
      process.env,
    );
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
