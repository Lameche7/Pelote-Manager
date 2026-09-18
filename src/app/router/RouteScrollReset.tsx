import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

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
    document.querySelector<HTMLElement>(`[name="${CSS.escape(targetId)}"]`);

  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
};

export function RouteScrollReset() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    // Le navigateur sait mieux restaurer une position lors d'un retour/avance.
    if (navigationType === "POP") return;

    if (location.hash) {
      const frame = window.requestAnimationFrame(() => {
        scrollToHashTarget(location.hash);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.hash, navigationType]);

  return null;
}
