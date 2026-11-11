import { useEffect, useState } from "react";
import { TournamentFinalBracket } from "@/features/tournaments/components/TournamentResultsBoard";
import {
  tournamentResultsService,
  type PublicTournamentResultSeries,
} from "@/features/tournaments/services/tournamentResultsService";

export function MyTournamentFinalBracket({
  tournamentId,
  seriesId,
  teamId,
}: {
  tournamentId: string;
  seriesId: string;
  teamId: string;
}) {
  const [series, setSeries] = useState<PublicTournamentResultSeries | null>(
    null,
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setSeries(null);
    setError(false);
    void tournamentResultsService
      .get(tournamentId)
      .then((result) => {
        if (active)
          setSeries(
            result?.series.find((item) => item.id === seriesId) ?? null,
          );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [tournamentId, seriesId]);

  if (error) return <p role="status">Tableau indisponible pour le moment.</p>;
  if (!series?.finalsGenerated) return null;

  const seed = series.finalSeeds.find((item) => item.teamId === teamId);
  return (
    <section
      aria-label="Tableau de ma série"
      className="my-tournaments__final-stage"
    >
      <p className="my-tournaments__label">Nouvelle phase · {series.name}</p>
      {seed && (
        <p>
          <strong>Votre équipe : tête de série n°{seed.seed}</strong>
        </p>
      )}
      <TournamentFinalBracket series={series} />
      <p>
        Les horaires apparaissent dès publication des rencontres. Les
        adversaires des tours suivants restent prévisionnels.
      </p>
    </section>
  );
}
