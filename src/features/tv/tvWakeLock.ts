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

const TV_PATH_PATTERN = /^\/tv\/[^/]+\/?$/;

export function setupTvWakeLock() {
  const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLock || !TV_PATH_PATTERN.test(window.location.pathname)) return;

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
      // Wake Lock est un confort : le Mode TV reste fonctionnel s'il est refusé.
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
