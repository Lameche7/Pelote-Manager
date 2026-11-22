import { jsonError, LiveAuthError } from "./_live-google-shared.mjs";
import { handleWhip } from "./_live-browser-ingest.mjs";
import { authorizeLivekitPublisher } from "./_live-livekit.mjs";
import {
  startLivekitEgress,
  livekitEgressStatus,
  publishLivekitYoutube,
  finishLivekitYoutube,
  abortLivekitEgress,
} from "./_live-livekit-egress.mjs";
import {
  inspectUpstreamControl,
  loadControlBinding,
  controlUpstreamStream,
  publicControlStatus,
} from "./_live-upstream-control.mjs";
import {
  prepareUpstreamYoutubeDestination,
  loadYoutubeIngest,
} from "./_live-upstream-destination.mjs";
import {
  publishVerifiedYoutubeLive,
  completeVerifiedYoutubeLive,
} from "./_live-youtube-publish.mjs";
import { reuseIdleUpstreamForVideo } from "./_live-upstream-reuse.mjs";
import {
  associateUpstreamStream,
  getUpstreamBinding,
} from "./_live-upstream-binding.mjs";
import {
  upstreamConnectionStatus,
  upstreamStreamInventory,
} from "./_live-upstream.mjs";
import {
  googleAccessToken,
  verifiedLiveClubAdmin,
  synchronizeClubVideos,
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
    if (
      request.method === "POST" &&
      request.body?.action === "livekit_publisher_token"
    ) {
      return response
        .status(200)
        .json(await authorizeLivekitPublisher(request, process.env));
    }
    if (
      request.method === "POST" &&
      [
        "livekit_egress_start",
        "livekit_egress_status",
        "livekit_youtube_publish",
        "livekit_youtube_finish",
        "livekit_egress_abort",
      ].includes(request.body?.action)
    ) {
      const { clubId, channelId, canConnectGoogle } =
        await verifiedLiveClubAdmin(request, process.env);
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Diffusion LiveKit réservée au club pilote.",
        );
      const action = request.body.action;
      const videoId = request.body?.videoId;
      if (action !== "livekit_egress_status" && request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmation explicite requise.");
      if (action === "livekit_egress_status") {
        await getClubVideo(process.env, clubId, videoId, fetch, true);
        return response.status(200).json(
          await livekitEgressStatus(process.env, clubId, videoId),
        );
      }
      if (action === "livekit_egress_start") {
        const authorized = await authorizeLivekitPublisher(request, process.env);
        const video = await getClubVideo(process.env, clubId, videoId);
        return response.status(200).json(
          await startLivekitEgress(
            process.env,
            clubId,
            video,
            authorized.identity,
          ),
        );
      }
      if (action === "livekit_youtube_publish")
        return response.status(200).json(
          await publishLivekitYoutube(
            process.env,
            clubId,
            channelId,
            videoId,
          ),
        );
      if (action === "livekit_youtube_finish")
        return response.status(200).json(
          await finishLivekitYoutube(
            process.env,
            clubId,
            channelId,
            videoId,
          ),
        );
      return response.status(200).json(
        await abortLivekitEgress(process.env, clubId, videoId),
      );
    }
    // Reuse this existing API function for WebRTC signalling, preserving the
    // Vercel Hobby 12-functions limit. The helper revalidates credentials.
    if (
      request.method === "POST" &&
      ["whip_offer", "whip_close"].includes(request.body?.action)
    ) {
      return handleWhip(
        {
          ...request,
          method: request.body.action === "whip_close" ? "DELETE" : "POST",
        },
        response,
        process.env,
      );
    }
    // Read-only upstream connection health. Never return provider metadata
    // or stream credentials to the browser.
    if (request.method === "GET") {
      const admin = await verifiedLiveClubAdmin(request, process.env);
      if (request.query?.upstream === "control") {
        if (!admin.canConnectGoogle)
          throw new LiveAuthError(
            403,
            "Pilotage réservé à l'administration pilote.",
          );
        const status = await inspectUpstreamControl(
          process.env,
          admin.clubId,
          request.query?.videoId,
        );
        return response.status(200).json(publicControlStatus(status));
      }
      if (request.query?.upstream === "binding") {
        if (!admin.canConnectGoogle)
          throw new LiveAuthError(
            403,
            "Liaison réservée à l’administration pilote.",
          );
        return response.status(200).json({
          binding: await getUpstreamBinding(
            process.env,
            admin.clubId,
            request.query?.videoId,
          ),
        });
      }
      if (request.query?.upstream === "streams") {
        if (!admin.canConnectGoogle)
          throw new LiveAuthError(
            403,
            "Inventaire réservé à l'administration pilote.",
          );
        return response
          .status(200)
          .json(await upstreamStreamInventory(process.env));
      }
      return response
        .status(200)
        .json(await upstreamConnectionStatus(process.env));
    }
    const videoId = request.body?.videoId;
    const { clubId, channelId, canConnectGoogle } = await verifiedLiveClubAdmin(
      request,
      process.env,
    );
    if (request.body?.action === "reuse_upstream") {
      if (!canConnectGoogle)
        throw new LiveAuthError(403, "Régie réservée au club pilote.");
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmation de la régie requise.");
      const video = await getClubVideo(process.env, clubId, videoId);
      const token = await googleAccessToken(process.env, channelId);
      const result = await reuseIdleUpstreamForVideo(
        process.env,
        clubId,
        video,
        token,
      );
      return response.status(200).json(result);
    }
    if (request.body?.action === "finish_youtube") {
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Arrêt réservé à l'administration pilote.",
        );
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmez la fin du direct.");
      const status = await inspectUpstreamControl(process.env, clubId, videoId);
      if (!status.safe)
        throw new LiveAuthError(409, status.reason || "Régie non vérifiable.");
      const binding = await loadControlBinding(process.env, clubId, videoId);
      const ingest = await loadYoutubeIngest(process.env, videoId);
      const token = await googleAccessToken(process.env, channelId);
      await completeVerifiedYoutubeLive(
        token,
        binding.youtubeId,
        ingest.youtube_stream_id,
      );
      if (status.canStop)
        await controlUpstreamStream(process.env, clubId, videoId, "stop");
      await synchronizeClubVideos(process.env, clubId, channelId);
      return response.status(200).json({ completed: true });
    }
    if (request.body?.action === "publish_youtube") {
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Diffusion réservée à l'administration pilote.",
        );
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(
          400,
          "Confirmez le lancement public du direct.",
        );
      const video = await getClubVideo(process.env, clubId, videoId);
      const status = await inspectUpstreamControl(
        process.env,
        clubId,
        video.id,
      );
      if (!status.safe || status.streamStatus !== "active")
        throw new LiveAuthError(
          409,
          "Démarrez d'abord la régie liée à cette vidéo dans Pilotoki.",
        );
      const ingest = await loadYoutubeIngest(process.env, video.id);
      const accessToken = await googleAccessToken(process.env, channelId);
      const result = await publishVerifiedYoutubeLive(
        accessToken,
        video.youtube_video_id,
        ingest.youtube_stream_id,
      );
      try {
        await synchronizeClubVideos(process.env, clubId, channelId);
      } catch {
        // The YouTube transition succeeded, but the public catalogue may need
        // its next scheduled reconciliation. Never retry a publication blindly.
      }
      return response.status(200).json(result);
    }
    if (request.body?.action === "control_upstream") {
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Pilotage réservé à l'administration pilote.",
        );
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmation explicite nécessaire.");
      const result = await controlUpstreamStream(
        process.env,
        clubId,
        videoId,
        request.body?.command,
      );
      return response.status(200).json(result);
    }
    if (request.body?.action === "prepare_upstream_destination") {
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Préparation réservée à l’administration pilote.",
        );
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmation explicite nécessaire.");
      const video = await getClubVideo(process.env, clubId, videoId);
      const result = await prepareUpstreamYoutubeDestination(
        process.env,
        clubId,
        video,
      );
      return response.status(200).json(result);
    }
    if (request.body?.action === "associate_upstream") {
      if (!canConnectGoogle)
        throw new LiveAuthError(
          403,
          "Liaison réservée à l’administration pilote.",
        );
      if (request.body?.confirmed !== true)
        throw new LiveAuthError(400, "Confirmation de la régie requise.");
      const video = await getClubVideo(process.env, clubId, videoId);
      const result = await associateUpstreamStream(
        process.env,
        clubId,
        video.id,
        request.body?.streamId,
      );
      return response.status(200).json({ binding: result });
    }
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
