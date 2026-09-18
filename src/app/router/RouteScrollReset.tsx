import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

const resetScrollPositions = () => {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  document
    .querySelectorAll<HTMLElement>(
      ".app-main, .admin-shell__content, [data-route-scroll-container]",
    )
    .forEach((container) => {
      container.scrollTop = 0;
      container.scrollLeft = 0;
    });
};

const scrollToHashTarget = (hash: string) => {
  const rawTarget = hash.replace(/^#/u, "");
  if (!rawTarget) return false;

  let targetId = rawTarget;
  try {
    targetId = decodeURIComponent(rawTarget);
  } catch {
    // Garde la valeur brute si l'ancre n'est pas un URI valide.
  }

  const target =
    document.getElementById(targetId) ??
    (document.getElementsByName(targetId)[0] as HTMLElement | undefined);

  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
};

export function RouteScrollReset() {
  const location = useLocation();

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;

    if (location.hash) {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          scrollToHashTarget(location.hash);
        });
      });
    } else {
      resetScrollPositions();
      firstFrame = window.requestAnimationFrame(() => {
        resetScrollPositions();
        secondFrame = window.requestAnimationFrame(resetScrollPositions);
      });
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [location.key, location.pathname, location.search, location.hash]);

  return null;
}
