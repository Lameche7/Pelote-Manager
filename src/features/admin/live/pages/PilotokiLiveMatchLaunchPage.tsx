import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  adminLiveSettingsService,
  type ClubBroadcastSummary,
} from "@/features/admin/live/services/adminLiveSettingsService";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function PilotokiLiveMatchLaunchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const clubId = params.get("liveClub") ?? "";
  const resourceId = params.get("liveResource") ?? "";
  const startsAt = params.get("liveStart") ?? "";
  const endsAt = params.get("liveEnd") ?? "";
  const sourceType = params.get("liveType") ?? "";
  const rawTitle = params.get("liveTitle")?.trim() || "Partie au trinquet";
  const title = rawTitle.slice(0, 100).padEnd(5, " ");
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [broadcast, setBroadcast] = useState<ClubBroadcastSummary | null>(null);
  const [madeForKids, setMadeForKids] = useState<"yes" | "no" | "">("");
  const [consent, setConsent] = useState(false);
  const hasCalendarMatch =
    UUID.test(resourceId) &&
    Number.isFinite(Date.parse(startsAt)) &&
    Number.isFinite(Date.parse(endsAt)) &&
    (sourceType === "tournoi" || sourceType === "championnat");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!UUID.test(clubId))
          throw new Error("Le club associé à cette partie est invalide.");
        if (
          !Number.isFinite(Date.parse(startsAt)) ||
          !["tournoi", "championnat", "other"].includes(sourceType)
        )
          throw new Error("Informations de la partie incomplètes.");
        const settings = await adminLiveSettingsService.get();
        if (settings.clubId !== clubId || !settings.canConnectGoogle)
          throw new Error(
            "La diffusion n'est pas autorisée pour ce club. Vérifiez vos droits.",
          );
        const videos = await adminLiveSettingsService.listBroadcasts();
        // Match identity is resolved and validated by the preparation API,
        // never inferred from arbitrary URL-supplied team names or IDs.
        if (active) {
          const existing = videos.find(
            (video) =>
              video.status === "scheduled" &&
              video.title === title.trim() &&
              video.sourceType === sourceType,
          );
          if (existing) setBroadcast(existing);
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Préparation impossible.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [clubId, startsAt, sourceType, title]);

  const launch = (videoId: string) => {
    navigate(`/live/camera?videoId=${encodeURIComponent(videoId)}&launch=1`);
  };

  const start = async () => {
    if (preparing || !consent || madeForKids === "") return;
    setPreparing(true);
    setError("");
    try {
      if (broadcast) {
        launch(broadcast.id);
        return;
      }
      // YouTube requires a future time even when starting immediately.
      const planned = new Date(startsAt);
      const scheduledStartTime = new Date(
        Math.max(planned.getTime(), Date.now() + 180_000),
      ).toISOString();
      await adminLiveSettingsService.prepareBroadcast({
        title: title.trim(),
        sourceType: sourceType as "tournoi" | "championnat" | "other",
        sourceId: null,
        ...(hasCalendarMatch
          ? { calendarSlot: { resourceId, startsAt, endsAt } }
          : {}),
        scheduledStartTime,
        madeForKids: madeForKids === "yes",
        consentConfirmed: true,
      });
      const videos = await adminLiveSettingsService.listBroadcasts();
      const prepared = videos.find(
        (video) =>
          video.status === "scheduled" &&
          video.title === title.trim() &&
          video.sourceType === sourceType,
      );
      if (!prepared)
        throw new Error(
          "YouTube a préparé le direct, mais Pilotoki n'a pas encore retrouvé la vidéo. N'en créez pas une deuxième : actualisez l'écran.",
        );
      setBroadcast(prepared);
      launch(prepared.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Direct non préparé.",
      );
    } finally {
      setPreparing(false);
    }
  };

  return (
    <main className="admin-page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1>Diffuser la partie</h1>
      <p>{title.trim()}</p>
      <p>
        La diffusion se lance depuis votre téléphone, sans accès aux
        paramètres d'administration du club.
      </p>
      {loading ? (
        <p role="status">Vérification de la partie et des droits…</p>
      ) : (
        <>
          {!broadcast && !error && (
            <p>Cette partie n'a pas encore de direct YouTube préparé.</p>
          )}
          {!broadcast && (
            <label>
              Ce direct est-il destiné spécifiquement aux enfants ?
              <select
                value={madeForKids}
                onChange={(event) =>
                  setMadeForKids(event.target.value as "yes" | "no" | "")
                }
              >
                <option value="">Choisir</option>
                <option value="no">Non</option>
                <option value="yes">Oui</option>
              </select>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Je confirme disposer des autorisations de captation et de diffusion.
          </label>
          <button
            type="button"
            disabled={preparing || !consent || (!broadcast && madeForKids === "")}
            onClick={() => void start()}
          >
            {preparing ? "Préparation YouTube…" : "Diffuser la partie"}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <p>
        <Link to="/reservations">Retour au calendrier</Link>
      </p>
    </main>
  );
}
