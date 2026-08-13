import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "@/app/App";
import "@/features/admin/tournaments/pages/AdminTournamentPlanningCompact.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // L’application reste utilisable si le navigateur refuse le service worker.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
