import { jsonError, LiveAuthError } from "./_live-google-shared.mjs";
import {
  googleAccessToken,
  verifiedLiveClubAdmin,
} from "./_live-youtube-broadcast.mjs";
import {
  existingIngest,
  getClubVideo,
  encryptIngestCredentials,
  saveIngest,
  youtubeBindIngest,
  youtubeCreateIngest,
} from "./_live-youtube-ingest.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const videoId = request.body?.videoId;
    const { clubId, channelId } = await verifiedLiveClubAdmin(request, process.env);
    const video = await getClubVideo(process.env, clubId, videoId);
    if (await existingIngest(process.env, video.id)) {
      return response.status(200).json({
        status: "configured",
        message: "Le flux YouTube est déjà associé à ce direct.",
      });
    }
    // YouTube will refuse this until the channel's 24-hour Live activation is complete.
    const accessToken = await googleAccessToken(process.env, channelId);
    const stream = await youtubeCreateIngest(accessToken, video.title);
    await youtubeBindIngest(accessToken, video.youtube_video_id, stream.id);
    const encrypted = encryptIngestCredentials(process.env, {
      address: stream.address,
      streamName: stream.streamName,
    });
    await saveIngest(process.env, video.id, stream.id, encrypted);
    // Never return RTMPS address, stream key, OAuth token, or encrypted values.
    return response.status(201).json({
      status: "configured",
      message: "Flux YouTube prêt. La passerelle caméra reste à connecter.",
    });
  } catch (error) {
    return jsonError(response, error);
  }
}
