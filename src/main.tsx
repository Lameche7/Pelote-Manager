import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "@/app/App";
import "@/features/admin/tournaments/pages/AdminTournamentPlanningCompact.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
