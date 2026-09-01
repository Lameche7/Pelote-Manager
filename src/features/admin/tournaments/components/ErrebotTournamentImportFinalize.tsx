import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildErrebotTournamentImportPayload,
  defaultErrebotTournamentName,
  getErrebotTournamentDateRange,
  type ErrebotImportFileMetadata,
  type ErrebotTournamentGoalAverageMode,
  type ErrebotTournamentImportResult,
  type ErrebotTournamentMatchFormat,
  type ErrebotTournamentRankingMode,
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

const numberValue = (value: string) => Number(value || 0);

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
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [primaryResourceId, setPrimaryResourceId] = useState("");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60);
  const [matchFormat, setMatchFormat] = useState<
    ErrebotTournamentMatchFormat | ""
  >("");
  const [singleGamePoints, setSingleGamePoints] = useState(40);
  const [mainSetPoints, setMainSetPoints] = useState(20);
  const [decidingSetPoints, setDecidingSetPoints] = useState(10);
  const [baseWinPoints, setBaseWinPoints] = useState(3);
  const [baseLossPoints, setBaseLossPoints] = useState(1);
  const [offensiveBonusPoints, setOffensiveBonusPoints] = useState(1);
  const [defensiveBonusPoints, setDefensiveBonusPoints] = useState(1);
  const [offensiveBonusMargin, setOffensiveBonusMargin] = useState(10);
  const [defensiveBonusMargin, setDefensiveBonusMargin] = useState(5);
  const [rankingMode, setRankingMode] =
    useState<ErrebotTournamentRankingMode>("points_per_match");
  const [goalAverageMode, setGoalAverageMode] =
    useState<ErrebotTournamentGoalAverageMode>(
      "point_difference_per_match",
    );
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

  const selectedResources = useMemo(
    () =>
      (options?.resources ?? []).filter((resource) =>
        resourceIds.includes(resource.id),
      ),
    [options?.resources, resourceIds],
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
        const firstResource = loaded.resources[0];
        setSeasonId(preferredSeason?.id ?? "");
        setResourceIds(firstResource ? [firstResource.id] : []);
        setPrimaryResourceId(firstResource?.id ?? "");
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

  const toggleResource = (resourceId: string) => {
    setResourceIds((current) => {
      if (current.includes(resourceId)) {
        const next = current.filter((id) => id !== resourceId);
        if (primaryResourceId === resourceId) {
          setPrimaryResourceId(next[0] ?? "");
        }
        return next;
      }

      const next = [...current, resourceId];
      if (!primaryResourceId) setPrimaryResourceId(resourceId);
      return next;
    });
  };

  const sportingRulesValid =
    matchFormat !== "" &&
    singleGamePoints >= 1 &&
    mainSetPoints >= 1 &&
    decidingSetPoints >= 1 &&
    baseWinPoints >= 0 &&
    baseLossPoints >= 0 &&
    offensiveBonusPoints >= 0 &&
    defensiveBonusPoints >= 0 &&
    offensiveBonusMargin >= 1 &&
    defensiveBonusMargin >= 1;

  const importTournament = async () => {
    if (
      !name.trim() ||
      !seasonId ||
      resourceIds.length === 0 ||
      !primaryResourceId ||
      !matchFormat ||
      !sportingRulesValid
    ) {
      return;
    }

    setImporting(true);
    setError("");
    try {
      const imported = await errebotImportService.importTournament(
        buildErrebotTournamentImportPayload(file, parsed, {
          name,
          seasonId,
          resourceIds,
          primaryResourceId,
          slotDurationMinutes,
          sportingRules: {
            matchFormat,
            singleGamePoints,
            mainSetPoints,
            decidingSetPoints,
            baseWinPoints,
            baseLossPoints,
            offensiveBonusPoints,
            defensiveBonusPoints,
            offensiveBonusMargin,
            defensiveBonusMargin,
            rankingMode,
            goalAverageMode,
          },
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
              ? "Ce fichier avait déjà été importé : aucun doublon n’a été créé et les options du tournoi existant ont été mises à jour."
              : "Le tournoi et ses options ont été créés dans le moteur natif Pelote Manager en une seule transaction."}
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
            <strong>{result.resourceCount ?? resourceIds.length}</strong>
            <span>terrain(s)</span>
          </div>
          <div>
            <strong>
              {(result.matchFormat ?? matchFormat) === "single_game"
                ? `1 × ${singleGamePoints}`
                : `${mainSetPoints}/${mainSetPoints}/${decidingSetPoints}`}
            </strong>
            <span>format de score</span>
          </div>
          <div>
            <strong>{result.slotDurationMinutes ?? slotDurationMinutes} min</strong>
            <span>par créneau</span>
          </div>
        </div>

        <p className="admin-tournament-import__privacy-note">
          Le planning est importé mais pas encore publié dans le calendrier du
          club. Les scores Errebot simples restent conservés comme provenance et
          ne sont pas transformés artificiellement en manches.
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
        <h2>Configurer puis créer le tournoi</h2>
        <p>
          Vérifiez les paramètres métier avant l’import. Aucun format de score,
          nombre de terrains ou durée de créneau ne sera déduit silencieusement.
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
        <div className="errebot-import-finalize__sections">
          <section className="errebot-import-finalize__section">
            <h3>1. Tournoi et calendrier</h3>
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
                    Aucune saison du club ne couvre les dates détectées dans le
                    PDF.
                  </small>
                )}
              </label>

              <label>
                Durée d’un créneau
                <div className="errebot-import-finalize__number-with-unit">
                  <input
                    type="number"
                    min="15"
                    max="240"
                    step="5"
                    value={slotDurationMinutes}
                    disabled={importing}
                    onChange={(event) =>
                      setSlotDurationMinutes(numberValue(event.target.value))
                    }
                  />
                  <span>minutes</span>
                </div>
              </label>
            </div>
          </section>

          <section className="errebot-import-finalize__section">
            <div className="errebot-import-finalize__section-heading">
              <div>
                <h3>2. Terrains</h3>
                <p>
                  Sélectionnez les terrains disponibles pour ce tournoi. Le
                  nombre retenu sera enregistré dans sa configuration native.
                </p>
              </div>
              <strong>{resourceIds.length} sélectionné(s)</strong>
            </div>

            <div className="errebot-import-finalize__resource-list">
              {(options?.resources.length ?? 0) === 0 && (
                <p>Aucun terrain actif.</p>
              )}
              {options?.resources.map((resource) => (
                <label key={resource.id}>
                  <input
                    type="checkbox"
                    checked={resourceIds.includes(resource.id)}
                    disabled={importing}
                    onChange={() => toggleResource(resource.id)}
                  />
                  <span>{resource.name}</span>
                </label>
              ))}
            </div>

            <label className="errebot-import-finalize__primary-resource">
              Terrain utilisé par le planning importé
              <select
                value={primaryResourceId}
                disabled={importing || selectedResources.length === 0}
                onChange={(event) => setPrimaryResourceId(event.target.value)}
              >
                {selectedResources.length === 0 && (
                  <option value="">Sélectionnez d’abord un terrain</option>
                )}
                {selectedResources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
              <small>
                Le PDF Errebot ne fournit pas d’identifiant de terrain par match.
                Son planning est donc affecté à ce terrain principal ; les autres
                restent disponibles pour les phases ou ajustements ultérieurs.
              </small>
            </label>
          </section>

          <section className="errebot-import-finalize__section">
            <h3>3. Format des scores et classement</h3>
            <div className="errebot-import-finalize__form">
              <label>
                Format des parties
                <select
                  value={matchFormat}
                  disabled={importing}
                  onChange={(event) =>
                    setMatchFormat(
                      event.target.value as ErrebotTournamentMatchFormat | "",
                    )
                  }
                >
                  <option value="">Choisir le format…</option>
                  <option value="single_game">Une partie en X points</option>
                  <option value="best_of_three_sets">
                    2 manches gagnantes
                  </option>
                </select>
              </label>

              {matchFormat === "single_game" && (
                <label>
                  Nombre de points de la partie
                  <input
                    type="number"
                    min="1"
                    value={singleGamePoints}
                    disabled={importing}
                    onChange={(event) =>
                      setSingleGamePoints(numberValue(event.target.value))
                    }
                  />
                </label>
              )}

              {matchFormat === "best_of_three_sets" && (
                <>
                  <label>
                    Points des manches principales
                    <input
                      type="number"
                      min="1"
                      value={mainSetPoints}
                      disabled={importing}
                      onChange={(event) =>
                        setMainSetPoints(numberValue(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Points de la manche décisive
                    <input
                      type="number"
                      min="1"
                      value={decidingSetPoints}
                      disabled={importing}
                      onChange={(event) =>
                        setDecidingSetPoints(numberValue(event.target.value))
                      }
                    />
                  </label>
                </>
              )}

              <label>
                Points de base — victoire
                <input
                  type="number"
                  min="0"
                  value={baseWinPoints}
                  disabled={importing}
                  onChange={(event) =>
                    setBaseWinPoints(numberValue(event.target.value))
                  }
                />
              </label>

              <label>
                Points de base — défaite
                <input
                  type="number"
                  min="0"
                  value={baseLossPoints}
                  disabled={importing}
                  onChange={(event) =>
                    setBaseLossPoints(numberValue(event.target.value))
                  }
                />
              </label>

              <label>
                Bonus offensif
                <input
                  type="number"
                  min="0"
                  value={offensiveBonusPoints}
                  disabled={importing}
                  onChange={(event) =>
                    setOffensiveBonusPoints(numberValue(event.target.value))
                  }
                />
              </label>

              <label>
                Bonus défensif
                <input
                  type="number"
                  min="0"
                  value={defensiveBonusPoints}
                  disabled={importing}
                  onChange={(event) =>
                    setDefensiveBonusPoints(numberValue(event.target.value))
                  }
                />
              </label>

              {matchFormat === "single_game" && (
                <>
                  <label>
                    Bonus offensif — écart minimum
                    <input
                      type="number"
                      min="1"
                      value={offensiveBonusMargin}
                      disabled={importing}
                      onChange={(event) =>
                        setOffensiveBonusMargin(numberValue(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Bonus défensif — écart maximum
                    <input
                      type="number"
                      min="1"
                      value={defensiveBonusMargin}
                      disabled={importing}
                      onChange={(event) =>
                        setDefensiveBonusMargin(numberValue(event.target.value))
                      }
                    />
                  </label>
                </>
              )}

              <label>
                Critère principal de classement
                <select
                  value={rankingMode}
                  disabled={importing}
                  onChange={(event) =>
                    setRankingMode(
                      event.target.value as ErrebotTournamentRankingMode,
                    )
                  }
                >
                  <option value="points_per_match">
                    Points de classement / partie
                  </option>
                  <option value="total_points">
                    Total des points de classement
                  </option>
                </select>
              </label>

              <label>
                Goal-average
                <select
                  value={goalAverageMode}
                  disabled={importing}
                  onChange={(event) =>
                    setGoalAverageMode(
                      event.target.value as ErrebotTournamentGoalAverageMode,
                    )
                  }
                >
                  <option value="point_difference_per_match">
                    Différence de points / partie
                  </option>
                  <option value="point_difference">
                    Différence totale de points
                  </option>
                </select>
              </label>
            </div>

            {matchFormat === "" && (
              <p className="errebot-import-finalize__required-note">
                Choisissez explicitement le format des parties avant l’import.
              </p>
            )}
          </section>
        </div>
      )}

      <p className="admin-tournament-import__privacy-note">
        Seules les données structurées nécessaires à la création sont envoyées
        au RPC sécurisé. Le PDF et son texte extrait restent dans le navigateur.
        Si ce même PDF a déjà été importé, aucun doublon n’est créé : ces options
        corrigent le tournoi Errebot existant tant que son planning n’est pas
        publié.
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
            resourceIds.length === 0 ||
            !primaryResourceId ||
            slotDurationMinutes < 15 ||
            slotDurationMinutes > 240 ||
            !sportingRulesValid ||
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
