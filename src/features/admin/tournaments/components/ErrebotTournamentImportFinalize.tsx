import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildErrebotTournamentImportPayload,
  defaultErrebotTournamentName,
  getErrebotTournamentDateRange,
  type ErrebotImportFileMetadata,
  type ErrebotTournamentImportResult,
} from "../domain/errebotTransactionalImport";
import type { ErrebotTournamentParseResult } from "../domain/errebotParser";
import { errebotImportService } from "../services/errebotImportService";
import {
  tournamentAdminService,
  type TournamentOptions,
  type TournamentSeasonOption,
} from "../services/tournamentAdminService";
import { ROUTES } from "@/shared/config";
import "./ErrebotTournamentImportFinalize.css";

type Props = {
  file: ErrebotImportFileMetadata;
  parsed: ErrebotTournamentParseResult;
  onBack: () => void;
  onReset: () => void;
};

const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(`${value}T12:00:00`))
    : "—";

const seasonCovers = (
  season: TournamentSeasonOption,
  startsOn: string,
  endsOn: string,
) => season.startsOn <= startsOn && season.endsOn >= endsOn;

export function ErrebotTournamentImportFinalize({
  file,
  parsed,
  onBack,
  onReset,
}: Props) {
  const dateRange = useMemo(
    () => getErrebotTournamentDateRange(parsed),
    [parsed],
  );
  const [options, setOptions] = useState<TournamentOptions | null>(null);
  const [name, setName] = useState(defaultErrebotTournamentName(file.name));
  const [seasonId, setSeasonId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ErrebotTournamentImportResult | null>(
    null,
  );

  const eligibleSeasons = useMemo(
    () =>
      (options?.seasons ?? []).filter((season) =>
        seasonCovers(season, dateRange.startsOn, dateRange.endsOn),
      ),
    [dateRange.endsOn, dateRange.startsOn, options?.seasons],
  );

  useEffect(() => {
    let active = true;
    tournamentAdminService
      .getOptions()
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        const eligible = loaded.seasons.filter((season) =>
          seasonCovers(season, dateRange.startsOn, dateRange.endsOn),
        );
        const preferredSeason =
          eligible.find((season) => season.isActive) ?? eligible[0];
        setSeasonId(preferredSeason?.id ?? "");
        setResourceId(loaded.resources[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les saisons et terrains.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dateRange.endsOn, dateRange.startsOn]);

  const importTournament = async () => {
    if (!name.trim() || !seasonId || !resourceId) return;
    setImporting(true);
    setError("");
    try {
      const imported = await errebotImportService.importTournament(
        buildErrebotTournamentImportPayload(file, parsed, {
          name,
          seasonId,
          resourceId,
          slotDurationMinutes: 60,
        }),
      );
      setResult(imported);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’importer le tournoi Errebot.",
      );
    } finally {
      setImporting(false);
    }
  };

  if (result) {
    return (
      <div className="admin-card admin-tournament-import__card errebot-import-finalize">
        <div>
          <p className="errebot-import-finalize__success-label">
            Import terminé
          </p>
          <h2>{name}</h2>
          <p>
            {result.alreadyImported
              ? "Ce fichier avait déjà été importé : aucun doublon n’a été créé."
              : "Le tournoi a été créé dans le moteur natif Pelote Manager en une seule transaction."}
          </p>
        </div>

        <div className="errebot-import-finalize__result-grid">
          <div>
            <strong>{result.summary.teamCount}</strong>
            <span>équipes</span>
          </div>
          <div>
            <strong>{result.summary.poolCount}</strong>
            <span>poules</span>
          </div>
          <div>
            <strong>{result.summary.matchCount}</strong>
            <span>matchs planifiés</span>
          </div>
          <div>
            <strong>{result.summary.verifiedPlayerCount ?? "—"}</strong>
            <span>joueurs liés</span>
          </div>
          <div>
            <strong>{result.summary.externalPlayerCount ?? "—"}</strong>
            <span>joueurs externes</span>
          </div>
          <div>
            <strong>{result.summary.sourceScoreCount ?? 0}</strong>
            <span>scores source conservés</span>
          </div>
        </div>

        <p className="admin-tournament-import__privacy-note">
          Le planning est importé mais pas encore publié dans le calendrier du
          club. La publication native effectuera son contrôle de conflits avant
          de créer les occupations. Les scores Errebot simples restent conservés
          comme provenance et ne sont pas transformés artificiellement en
          manches.
        </p>

        <div className="admin-tournament-import__actions">
          <button type="button" onClick={onReset}>
            Importer un autre fichier
          </button>
          <Link
            className="admin-tournament-import__primary errebot-import-finalize__link"
            to={`${ROUTES.admin}/tournois/publication`}
          >
            Contrôler puis publier le planning
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-card admin-tournament-import__card errebot-import-finalize">
      <div>
        <h2>Créer le tournoi dans Pelote Manager</h2>
        <p>
          Le fichier est prêt. Choisissez uniquement la saison et le terrain :
          équipes, joueurs, poules et matchs seront créés ensemble ou pas du
          tout.
        </p>
      </div>

      <div className="errebot-import-finalize__facts">
        <span>
          <strong>{parsed.teams.length}</strong> équipes
        </span>
        <span>
          <strong>{parsed.pools.length}</strong> poules
        </span>
        <span>
          <strong>{parsed.fixtures.length}</strong> matchs
        </span>
        <span>
          <strong>{formatDate(dateRange.startsOn)}</strong> →{" "}
          {formatDate(dateRange.endsOn)}
        </span>
      </div>

      {error && (
        <p className="admin-tournament-import__alert" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p>Chargement des saisons et terrains…</p>
      ) : (
        <div className="errebot-import-finalize__form">
          <label>
            Nom du tournoi
            <input
              value={name}
              maxLength={160}
              disabled={importing}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            Saison
            <select
              value={seasonId}
              disabled={importing || eligibleSeasons.length === 0}
              onChange={(event) => setSeasonId(event.target.value)}
            >
              {eligibleSeasons.length === 0 && (
                <option value="">Aucune saison compatible</option>
              )}
              {eligibleSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                  {season.isActive ? " · active" : ""}
                </option>
              ))}
            </select>
            {eligibleSeasons.length === 0 && (
              <small>
                Aucune saison du club ne couvre les dates détectées dans le PDF.
              </small>
            )}
          </label>

          <label>
            Terrain
            <select
              value={resourceId}
              disabled={importing || (options?.resources.length ?? 0) === 0}
              onChange={(event) => setResourceId(event.target.value)}
            >
              {(options?.resources.length ?? 0) === 0 && (
                <option value="">Aucun terrain actif</option>
              )}
              {options?.resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className="admin-tournament-import__privacy-note">
        Seules les données structurées nécessaires à la création sont envoyées
        au RPC sécurisé. Le PDF et son texte extrait restent dans le navigateur.
        Le premier joueur de chaque équipe est conservé au poste avant et le
        second au poste arrière, selon l’ordre de l’export Errebot.
      </p>

      <div className="admin-tournament-import__actions">
        <button type="button" disabled={importing} onClick={onBack}>
          Retour aux rapprochements
        </button>
        <button
          type="button"
          className="admin-tournament-import__primary"
          disabled={
            loading ||
            importing ||
            !name.trim() ||
            !seasonId ||
            !resourceId ||
            parsed.issues.length > 0
          }
          onClick={() => void importTournament()}
        >
          {importing ? "Import transactionnel…" : "Importer le tournoi"}
        </button>
      </div>
    </div>
  );
}
