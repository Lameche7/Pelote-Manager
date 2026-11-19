import {
  googleAccessToken,
  storePreparedVideo,
  validateBroadcastInput,
  verifiedLiveClubAdmin,
  youtubeCreateBroadcast,
} from "./_live-youtube-broadcast.mjs";
import { jsonError } from "./_live-google-shared.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    // No side effect on YouTube before validating both the request and club permissions.
    const input = validateBroadcastInput(request.body);
    const { clubId, channelId } = await verifiedLiveClubAdmin(request, process.env);
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
