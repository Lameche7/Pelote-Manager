type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockManagerLike = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: WakeLockManagerLike;
};

type CanvasWithCaptureStream = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

const TV_PATH_PATTERN = /^\/tv\/[^/]+\/?$/;
const SILK_USER_AGENT_PATTERN = /Silk\//i;
const SILK_KEEP_ALIVE_VIDEO_ID = "pilotoki-tv-silk-keep-awake";
const SILK_FRAME_INTERVAL_MS = 15_000;

function setupSilkMediaKeepAlive() {
  if (!SILK_USER_AGENT_PATTERN.test(navigator.userAgent)) return;
  if (document.getElementById(SILK_KEEP_ALIVE_VIDEO_ID)) return;

  const canvas = document.createElement("canvas") as CanvasWithCaptureStream;
  canvas.width = 2;
  canvas.height = 2;

  const context = canvas.getContext("2d");
  const captureStream = canvas.captureStream;
  if (!context || !captureStream) return;

  let stream: MediaStream;
  try {
    stream = captureStream.call(canvas, 1);
  } catch {
    return;
  }

  const video = document.createElement("video");
  video.id = SILK_KEEP_ALIVE_VIDEO_ID;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.srcObject = stream;
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.left = "-10px";
  video.style.top = "-10px";
  video.style.opacity = "0.001";
  video.style.pointerEvents = "none";

  document.body.append(video);

  let alternateFrame = false;
  const renderKeepAliveFrame = () => {
    alternateFrame = !alternateFrame;
    context.fillStyle = alternateFrame ? "#000000" : "#010101";
    context.fillRect(0, 0, canvas.width, canvas.height);
  };

  renderKeepAliveFrame();
  const frameTimer = window.setInterval(
    renderKeepAliveFrame,
    SILK_FRAME_INTERVAL_MS,
  );

  const removeGestureListeners = () => {
    window.removeEventListener("pointerdown", resumeFromUserGesture);
    window.removeEventListener("keydown", resumeFromUserGesture);
    window.removeEventListener("click", resumeFromUserGesture);
  };

  const ensurePlayback = async () => {
    if (
      document.visibilityState !== "visible" ||
      !TV_PATH_PATTERN.test(window.location.pathname)
    ) {
      return;
    }

    try {
      await video.play();
      removeGestureListeners();
    } catch {
      // Silk peut exiger une interaction télécommande avant d'autoriser la lecture.
    }
  };

  function resumeFromUserGesture() {
    void ensurePlayback();
  }

  const syncPlaybackWithVisibility = () => {
    if (document.visibilityState === "visible") {
      void ensurePlayback();
      return;
    }

    video.pause();
  };

  const cleanup = () => {
    window.clearInterval(frameTimer);
    removeGestureListeners();
    document.removeEventListener(
      "visibilitychange",
      syncPlaybackWithVisibility,
    );
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
  };

  window.addEventListener("pointerdown", resumeFromUserGesture);
  window.addEventListener("keydown", resumeFromUserGesture);
  window.addEventListener("click", resumeFromUserGesture);
  document.addEventListener("visibilitychange", syncPlaybackWithVisibility);
  window.addEventListener("pagehide", cleanup, { once: true });

  void ensurePlayback();
}

export function setupTvWakeLock() {
  if (!TV_PATH_PATTERN.test(window.location.pathname)) return;

  // Sur Amazon Silk, une micro-lecture vidéo muette sert de second garde-fou :
  // Fire TV traite alors le Mode TV comme un média actif même si le Wake Lock
  // web n'est pas propagé correctement au système.
  setupSilkMediaKeepAlive();

  const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLock) return;

  let sentinel: WakeLockSentinelLike | null = null;
  let retryTimer: number | null = null;

  const clearRetry = () => {
    if (retryTimer === null) return;
    window.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const release = async () => {
    clearRetry();
    const current = sentinel;
    sentinel = null;
    if (!current) return;

    try {
      await current.release();
    } catch {
      // Le navigateur peut déjà avoir relâché le verrou.
    }
  };

  const acquire = async () => {
    if (
      sentinel ||
      document.visibilityState !== "visible" ||
      !TV_PATH_PATTERN.test(window.location.pathname)
    ) {
      return;
    }

    try {
      const nextSentinel = await wakeLock.request("screen");
      sentinel = nextSentinel;
      nextSentinel.addEventListener("release", () => {
        if (sentinel === nextSentinel) sentinel = null;

        if (
          document.visibilityState === "visible" &&
          TV_PATH_PATTERN.test(window.location.pathname)
        ) {
          clearRetry();
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void acquire();
          }, 1_000);
        }
      });
    } catch {
      // Le Mode TV reste fonctionnel si le navigateur refuse le Wake Lock.
    }
  };

  const syncWithPageState = () => {
    if (
      document.visibilityState === "visible" &&
      TV_PATH_PATTERN.test(window.location.pathname)
    ) {
      void acquire();
      return;
    }

    void release();
  };

  document.addEventListener("visibilitychange", syncWithPageState);
  window.addEventListener("pagehide", () => void release());
  window.addEventListener("popstate", syncWithPageState);

  void acquire();
}
