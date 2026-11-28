import { useSearchParams } from "react-router-dom";
import { usePublicCalendarMode } from "../services/publicCalendarMode";
import { ClubPlanningPage } from "./ClubPlanningPage";
import { ReservationsPage } from "./ReservationsPage";

export function ClubCalendarPage() {
  const [params] = useSearchParams();
  const clubSlug = params.get("club")?.trim() || null;
  const { mode, error } = usePublicCalendarMode(clubSlug);

  if (error) return <p role="alert">Calendrier momentanément indisponible.</p>;
  if (!mode) return <p role="status">Chargement du calendrier…</p>;
  if (mode === "disabled")
    return <p>Ce club ne propose pas de calendrier public.</p>;
  if (mode === "planning") {
    return <ClubPlanningPage key={clubSlug ?? ""} clubSlug={clubSlug} />;
  }
  return <ReservationsPage key={clubSlug ?? ""} />;
}
