import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  buildChampionshipMatchesUpdatePayload,
  buildChampionshipMatchesUpdatePreview,
  type ChampionshipMatchesFilePreview,
  type ChampionshipMatchesUpdatePreview,
} from "@/features/admin/championships/domain/championshipMatchUpdate";
import {
  championshipImportService,
  type AdminChampionshipDetail,
} from "@/features/admin/championships/services/championshipImportService";
import { championshipSourceFileService } from "@/features/admin/championships/services/championshipSourceFileService";
import { ROUTES } from "@/shared/config";
import "./AdminChampionshipDetailPage.css";

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

export function AdminChampionshipDetailPage() {
  const { championshipId = "" } = useParams();
  const [detail, setDetail] = useState<AdminChampionshipDetail | null>(null);
  const [divisionId, setDivisionId] = useState("");
  const [phase, setPhase] = useState("");
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] =
    useState<ChampionshipMatchesFilePreview | null>(null);
  const [updatePreview, setUpdatePreview] =
    useState<ChampionshipMatchesUpdatePreview | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await championshipImportService.detail(championshipId);
      setDetail(value);
      setSourceUrl(value.sourceUrl ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de charger le championnat.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [championshipId]);

  const phases = useMemo(
    () =>
      Array.from(
        new Set(detail?.matches.map((match) => match.phase) ?? []),
      ).sort((a, b) => a.localeCompare(b, "fr")),
    [detail],
  );
  const filteredMatches = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fr");
    return (detail?.matches ?? []).filter((match) => {
      if (divisionId && match.divisionName !== divisionId) return false;
      if (phase && match.phase !== phase) return false;
      if (!needle) return true;
      return `${match.team1Label} ${match.team2Label} ${match.poolCode ?? ""}`
        .toLocaleLowerCase("fr")
        .includes(needle);
    });
  }, [detail, divisionId, phase, search]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setFilePreview(null);
    setUpdatePreview(null);
    setSuccess("");
    setError("");
  };

  const analyseUpdate = async () => {
    if (!file || !detail) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const parsed = await championshipSourceFileService.parseMatches(file);
      setFilePreview(parsed);
      setUpdatePreview(buildChampionshipMatchesUpdatePreview(detail, parsed));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’analyser la mise à jour.",
      );
    } finally {
      setBusy(false);
    }
  };

  const applyUpdate = async () => {
    if (!file || !filePreview || !updatePreview?.valid) return;
    setBusy(true);
    setError("");
    try {
      const descriptor = await championshipSourceFileService.describeMatches(
        file,
        filePreview,
      );
      const payload = buildChampionshipMatchesUpdatePayload(
        filePreview,
        descriptor,
        sourceUrl,
      );
      const result = await championshipImportService.updateMatches(
        championshipId,
        payload,
      );
      setSuccess(
        `${result.summary.insertedMatches} nouvelle(s) rencontre(s), ${result.summary.updatedMatches} mise(s) à jour, ${result.summary.unchangedMatches} inchangée(s).`,
      );
      setFile(null);
      setFilePreview(null);
      setUpdatePreview(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’actualiser le championnat.",
      );
      setBusy(false);
    }
  };

  if (busy && !detail)
    return (
      <section className="admin-page">
        <div className="admin-card">Chargement du championnat…</div>
      </section>
    );
  if (!detail)
    return (
      <section className="admin-page">
        <p className="admin-championship-detail__alert">
          {error || "Championnat introuvable."}
        </p>
      </section>
    );

  return (
    <section className="admin-page admin-championship-detail">
      <header className="admin-page__header admin-championship-detail__header">
        <div>
          <Link to={ROUTES.adminChampionships}>← Championnats</Link>
          <p className="admin-page__eyebrow">{detail.seasonLabel}</p>
          <h1>{detail.name}</h1>
          <p className="admin-page__lead">{detail.specialty}</p>
        </div>
        {detail.sourceUrl && (
          <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
            Source officielle
          </a>
        )}
      </header>

      {error && <p className="admin-championship-detail__alert">{error}</p>}
      {success && (
        <p className="admin-championship-detail__success">{success}</p>
      )}

      <div className="admin-championship-detail__kpis">
        {[
          ["Séries", detail.counts.divisionCount],
          ["Poules", detail.counts.poolCount],
          ["Équipes", detail.counts.teamCount],
          ["Joueurs", detail.counts.playerCount],
          ["Rencontres", detail.counts.matchCount],
          ["Résultats", detail.counts.playedMatchCount],
          ["Comptes liés", detail.counts.linkedPlayerCount],
        ].map(([label, value]) => (
          <div className="admin-card" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="admin-card admin-championship-detail__update">
        <div>
          <h2>Actualiser depuis parties.xlsx</h2>
          <p>
            Le fichier est comparé au championnat actuel avant toute écriture.
            Les rencontres absentes du nouveau fichier ne sont jamais supprimées
            automatiquement.
          </p>
        </div>
        <label>
          URL officielle
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://lbpb.competition.ffpb.net?id_competition=…"
          />
        </label>
        <label>
          Nouveau fichier des parties (.xlsx)
          <input
            type="file"
            accept=".xlsx"
            onChange={chooseFile}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          onClick={() => void analyseUpdate()}
          disabled={!file || busy}
        >
          Comparer la mise à jour
        </button>

        {updatePreview && (
          <div className="admin-championship-detail__diff">
            <div className="admin-championship-detail__diff-summary">
              <span>
                <strong>{updatePreview.newMatches}</strong> nouvelles
              </span>
              <span>
                <strong>{updatePreview.updatedMatches}</strong> modifiées
              </span>
              <span>
                <strong>{updatePreview.resultChanges}</strong> résultats
              </span>
              <span>
                <strong>{updatePreview.scheduleChanges}</strong> programmations
              </span>
              <span>
                <strong>{updatePreview.unchangedMatches}</strong> inchangées
              </span>
            </div>
            {updatePreview.existingMatchesMissingFromFile > 0 && (
              <p>
                ℹ️ {updatePreview.existingMatchesMissingFromFile} rencontre(s)
                déjà connues ne figurent pas dans ce fichier : elles seront
                conservées.
              </p>
            )}
            {updatePreview.issues.map((issue) => (
              <p className="admin-championship-detail__alert" key={issue}>
                {issue}
              </p>
            ))}
            {updatePreview.changes.slice(0, 30).map((change) => (
              <article key={change.identity}>
                <strong>
                  {change.kind === "new"
                    ? "Nouvelle rencontre"
                    : "Modification"}{" "}
                  · {change.category} · {change.phase}
                </strong>
                <p>
                  {change.team1Label} — {change.team2Label}
                </p>
                {change.fields.map((field) => (
                  <small key={field.label}>
                    {field.label} : {field.before} → {field.after}
                  </small>
                ))}
              </article>
            ))}
            {updatePreview.valid && (
              <button
                type="button"
                onClick={() => void applyUpdate()}
                disabled={busy}
              >
                {busy ? "Application…" : "Appliquer la mise à jour"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="admin-card admin-championship-detail__filters">
        <h2>Rencontres</h2>
        <select
          value={divisionId}
          onChange={(event) => setDivisionId(event.target.value)}
        >
          <option value="">Toutes les séries</option>
          {detail.divisions.map((division) => (
            <option key={division.id} value={division.name}>
              {division.name}
            </option>
          ))}
        </select>
        <select
          value={phase}
          onChange={(event) => setPhase(event.target.value)}
        >
          <option value="">Toutes les phases</option>
          {phases.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Club ou équipe…"
        />
      </div>

      <div className="admin-card admin-championship-detail__matches">
        <div className="admin-championship-detail__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Série</th>
                <th>Poule</th>
                <th>Phase</th>
                <th>Date</th>
                <th>Équipe 1</th>
                <th>Équipe 2</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((match) => (
                <tr key={match.id}>
                  <td>{match.divisionName}</td>
                  <td>{match.poolCode ?? "—"}</td>
                  <td>{match.phase}</td>
                  <td>
                    {formatDate(
                      match.reportOn ?? match.agreementOn ?? match.scheduledOn,
                    )}
                  </td>
                  <td>{match.team1Label}</td>
                  <td>{match.team2Label}</td>
                  <td>
                    <strong>{match.scoreRaw ?? "—"}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-championship-detail__divisions">
        {detail.divisions.map((division) => (
          <section className="admin-card" key={division.id}>
            <h2>{division.name}</h2>
            {division.pools.map((pool) => (
              <details key={pool.id}>
                <summary>
                  {pool.name} · {pool.teams.length} équipes
                </summary>
                {pool.teams.map((team) => (
                  <div
                    className="admin-championship-detail__team"
                    key={team.id}
                  >
                    <strong>{team.sourceLabel}</strong>
                    <span>
                      {team.players
                        .map(
                          (player) =>
                            `${player.lastName} ${player.firstName} (${player.licenceNumber})`,
                        )
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </details>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
