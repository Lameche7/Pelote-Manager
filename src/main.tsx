import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "@/app/App";
import "@/features/admin/tournaments/pages/AdminTournamentPlanningCompact.css";
import { setupTvFullscreenPrompt } from "@/features/tv/tvFullscreenPrompt";
import {
  MARKETING_PREVIEW_PATH,
  isMarketingHostname,
} from "@/shared/config/domains";

const isMarketingSite =
  isMarketingHostname(window.location.hostname) ||
  window.location.pathname === MARKETING_PREVIEW_PATH;

if (isMarketingSite) {
  document.querySelector('link[rel="manifest"]')?.remove();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", "#0d2b6c");

  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations.map((registration) => registration.unregister()),
        ),
      )
      .catch(() => undefined);
  }
} else if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // L’application reste utilisable si le navigateur refuse le service worker.
    });
  });
}

setupTvFullscreenPrompt();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
