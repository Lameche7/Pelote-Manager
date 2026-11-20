import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.LIVE_BRIDGE_SHARED_SECRET || "";
const PUBLIC_ORIGIN = process.env.LIVE_BRIDGE_PUBLIC_ORIGIN || "";
const MAX_LIFETIME_MS = 20 * 60 * 1000;
const sessions = new Map();
if (
  SECRET.length < 32 ||
  !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(PUBLIC_ORIGIN)
) {
  throw new Error(
    "Set a 32+ character LIVE_BRIDGE_SHARED_SECRET and HTTPS LIVE_BRIDGE_PUBLIC_ORIGIN.",
  );
}

function isSecret(value) {
  const candidate = Buffer.from(value || "");
  const expected = Buffer.from(SECRET);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
function send(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0,
      chunks = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(chunks || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function isYoutubeIngest(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "rtmps:" &&
      u.port === "" &&
      /^(?:[a-z0-9-]+\.)*rtmp\.youtube\.com$/i.test(u.hostname) &&
      u.pathname.startsWith("/live2") &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.timer);
  clearTimeout(s.retry);
  s.stopped = true;
  s.worker?.kill("SIGTERM");
}
function runWorker(s) {
  if (s.stopped) return;
  // WHIP sessions may take seconds to establish. Retry RTSP input while waiting.
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-rtsp_transport",
    "tcp",
    "-i",
    `rtsp://127.0.0.1:8554/${s.path}`,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-g",
    "60",
    "-b:v",
    "2200k",
    "-maxrate",
    "2500k",
    "-bufsize",
    "5000k",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-f",
    "flv",
    s.ingest,
  ];
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  s.worker = child;
  // Never log FFmpeg diagnostics: they can contain the RTMPS stream key.
  child.stderr.resume();
  child.on("error", () => {
    s.state = "ffmpeg_error";
  });
  child.on("exit", () => {
    if (s.worker === child) s.worker = null;
    if (s.stopped || Date.now() >= s.expires) return;
    s.state = "waiting_or_reconnecting";
    s.retry = setTimeout(() => runWorker(s), 2500);
  });
  s.state = "bridge_running";
}
function checkToken(s, token) {
  if (!s || s.stopped || Date.now() >= s.expires || typeof token !== "string")
    return false;
  const a = Buffer.from(token),
    b = Buffer.from(s.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeHandler() {
  return async (req, res) => {
    try {
      if (req.url === "/health" && req.method === "GET")
        return send(res, 200, { ok: true });
      if (req.url === "/auth" && req.method === "POST") {
        const data = await body(req);
        const id = typeof data.path === "string" ? data.path.split("/")[1] : "";
        const s = sessions.get(id);
        const token = data.token || data.password || "";
        const permitted =
          data.protocol === "webrtc" &&
          data.action === "publish" &&
          data.path === s?.path &&
          checkToken(s, token);
        // Only FFmpeg on loopback can consume RTSP, and only on the active path.
        const localRead =
          data.action === "read" &&
          data.protocol === "rtsp" &&
          data.path === s?.path &&
          (data.ip === "127.0.0.1" || data.ip === "::1");
        return send(res, permitted || localRead ? 200 : 403, {});
      }
      if (req.url?.startsWith("/control/")) {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!isSecret(token)) return send(res, 401, { error: "Unauthorized" });
        if (req.method !== "POST")
          return send(res, 405, { error: "Method not allowed" });
        const payload = await body(req);
        if (req.url === "/control/start") {
          if (!isYoutubeIngest(payload.ingestUrl))
            return send(res, 400, { error: "Invalid YouTube RTMPS endpoint" });
          // Pilot limited to one active encoder. Avoid overlapping user streams.
          if (sessions.size !== 0)
            return send(res, 409, { error: "An emission is already active" });
          const id = randomBytes(16).toString("hex");
          const s = {
            path: `live/${id}`,
            token: randomBytes(32).toString("hex"),
            ingest: payload.ingestUrl,
            expires: Date.now() + MAX_LIFETIME_MS,
            stopped: false,
            worker: null,
            state: "starting",
          };
          sessions.set(id, s);
          s.timer = setTimeout(() => closeSession(id), MAX_LIFETIME_MS);
          runWorker(s);
          return send(res, 201, {
            sessionId: id,
            whipUrl: `${PUBLIC_ORIGIN}/${s.path}/whip`,
            publishToken: s.token,
            expiresAt: new Date(s.expires).toISOString(),
          });
        }
        if (req.url === "/control/stop") {
          if (
            typeof payload.sessionId !== "string" ||
            !/^[a-f0-9]{32}$/.test(payload.sessionId)
          )
            return send(res, 400, { error: "Invalid session" });
          closeSession(payload.sessionId);
          return send(res, 200, { stopped: true });
        }
        if (req.url === "/control/status") {
          const s = sessions.get(payload.sessionId);
          if (!s) return send(res, 404, { error: "Session missing" });
          return send(res, 200, {
            state: s.state,
            expiresAt: new Date(s.expires).toISOString(),
          });
        }
      }
      return send(res, 404, { error: "Not found" });
    } catch {
      return send(res, 400, { error: "Invalid request" });
    }
  };
}
if (process.env.NODE_ENV !== "test")
  createServer(makeHandler()).listen(PORT, "127.0.0.1");
export { isYoutubeIngest };
