import { jsonError, LiveAuthError } from "./_live-google-shared.mjs";
import { upstreamConnectionStatus, upstreamStreamInventory } from "./_live-upstream.mjs";
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
  if (request.method !== "POST" && request.method !== "GET") {
    response.setHeader("Allow", "POST, GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    // Read-only upstream connection health. Never return provider metadata
    // or stream credentials to the browser.
    if (request.method === "GET") {
      const admin = await verifiedLiveClubAdmin(request, process.env);
      if (request.query?.upstream === "streams") {
        if (!admin.canConnectGoogle)
          throw new LiveAuthError(403, "Inventaire réservé à l'administration pilote.");
        return response.status(200).json(await upstreamStreamInventory(process.env));
      }
      return response
        .status(200)
        .json(await upstreamConnectionStatus(process.env));
    }
    const videoId = request.body?.videoId;
    const { clubId, channelId } = await verifiedLiveClubAdmin(
      request,
      process.env,
    );
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
