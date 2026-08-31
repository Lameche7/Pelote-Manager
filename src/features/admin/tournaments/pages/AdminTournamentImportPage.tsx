import { useState } from "react";
import {
  buildErrebotIdentityMatchPayload,
  errebotIdentityReasonLabel,
  errebotIdentityStatusLabel,
  summarizeErrebotIdentityMatches,
  type ErrebotIdentityMatch,
} from "@/features/admin/tournaments/domain/errebotIdentityMatching";
import {
  buildErrebotExtractionPreview,
  formatErrebotFileSize,
  validateErrebotPdfSelection,
  type ErrebotExtractionPreview,
} from "@/features/admin/tournaments/domain/errebotImportPreview";
import {
  extractErrebotPdfText,
  sha256File,
} from "@/features/admin/tournaments/domain/errebotPdfExtraction";
import {
  parseErrebotTournament,
  type ErrebotTournamentParseResult,
} from "@/features/admin/tournaments/domain/errebotParser";
import { errebotImportService } from "@/features/admin/tournaments/services/errebotImportService";
import "./AdminTournamentImportPage.css";

type SelectedPdf = {
  file: File;
  hash: string;
};

const steps = [
  "Fichier",
  "Contrôle",
  "Prévisualisation",
  "Rapprochement",
] as const;

export function AdminTournamentImportPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [preview, setPreview] = useState<ErrebotExtractionPreview | null>(null);
  const [parsed, setParsed] = useState<ErrebotTournamentParseResult | null>(
    null,
  );
  const [identityMatches, setIdentityMatches] = useState<
    ErrebotIdentityMatch[] | null
  >(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setSelected(null);
    setPreview(null);
    setParsed(null);
    setIdentityMatches(null);
    setError("");
    setStep(1);
  };

  const selectFile = async (file: File) => {
    setError("");
    setPreview(null);
    setParsed(null);
    setIdentityMatches(null);
    const validationError = validateErrebotPdfSelection(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    try {
      const hash = await sha256File(file);
      setSelected({ file, hash });
      setStep(2);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de contrôler le fichier PDF.",
      );
    } finally {
      setBusy(false);
    }
  };

  const analyse = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setIdentityMatches(null);
    try {
      const extracted = await extractErrebotPdfText(selected.file);
      const nextPreview = buildErrebotExtractionPreview(
        extracted.text,
        extracted.pageCount,
      );
      if (nextPreview.characterCount === 0) {
        setError(
          "Aucun texte exploitable n’a été extrait. Le PDF est peut-être scanné sous forme d’image.",
        );
        return;
      }
      const nextParsed = parseErrebotTournament(extracted.text);
      setPreview(nextPreview);
      setParsed(nextParsed);
      setStep(3);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’extraire le texte du PDF Errebot.",
      );
    } finally {
      setBusy(false);
    }
  };

  const analyseIdentityMatches = async () => {
    if (!parsed || parsed.issues.length > 0) return;
    const payload = buildErrebotIdentityMatchPayload(parsed);
    setBusy(true);
    setError("");
    try {
      const matches =
        await errebotImportService.previewIdentityMatches(payload);
      if (matches.length !== payload.length) {
        throw new Error(
          "Le serveur n’a pas retourné un résultat pour chaque joueur Errebot.",
        );
      }
      setIdentityMatches(matches);
      setStep(4);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’analyser les rapprochements de joueurs.",
      );
    } finally {
      setBusy(false);
    }
  };

  const matchSummary = identityMatches
    ? summarizeErrebotIdentityMatches(identityMatches)
    : null;

  return (
    <section className="admin-page admin-tournament-import">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois · Errebot</p>
          <h1>Importer un tournoi</h1>
          <p className="admin-page__lead">
            Contrôlez le PDF Errebot, vérifiez sa structure puis préparez le
            rapprochement des joueurs avant toute création dans Pelote Manager.
          </p>
        </div>
      </header>

      <ol
        className="admin-tournament-import__steps"
        aria-label="Étapes de l’import"
      >
        {steps.map((label, index) => (
          <li key={label} className={step === index + 1 ? "is-active" : ""}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <p className="admin-tournament-import__alert" role="alert">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="admin-card admin-tournament-import__card">
          <div>
            <h2>Choisir le PDF Errebot</h2>
            <p>
              Le fichier est lu localement. Aucun PDF ni texte extrait n’est
              envoyé au serveur pendant ce contrôle.
            </p>
          </div>
          <label className="admin-tournament-import__file">
            Fichier PDF
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void selectFile(file);
              }}
            />
          </label>
          <small>20 Mo maximum.</small>
        </div>
      )}

      {step === 2 && selected && (
        <div className="admin-card admin-tournament-import__card">
          <div>
            <h2>Contrôle du fichier</h2>
            <p>
              L’empreinte permet de reconnaître exactement ce fichier sans
              stocker son contenu.
            </p>
          </div>
          <dl className="admin-tournament-import__metadata">
            <div>
              <dt>Nom</dt>
              <dd>{selected.file.name}</dd>
            </div>
            <div>
              <dt>Taille</dt>
              <dd>{formatErrebotFileSize(selected.file.size)}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd className="admin-tournament-import__hash">{selected.hash}</dd>
            </div>
          </dl>
          <div className="admin-tournament-import__actions">
            <button type="button" disabled={busy} onClick={reset}>
              Changer de fichier
            </button>
            <button
              type="button"
              className="admin-tournament-import__primary"
              disabled={busy}
              onClick={() => void analyse()}
            >
              {busy ? "Extraction en cours…" : "Extraire et prévisualiser"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && selected && preview && parsed && (
        <>
          <div className="admin-card admin-tournament-import__summary">
            <div>
              <strong>{parsed.teams.length}</strong>
              <span>équipes</span>
            </div>
            <div>
              <strong>{parsed.pools.length}</strong>
              <span>poules</span>
            </div>
            <div>
              <strong>{parsed.poolSize3Count}</strong>
              <span>poules de 3</span>
            </div>
            <div>
              <strong>{parsed.fixtures.length}</strong>
              <span>matchs</span>
            </div>
            <div>
              <strong>{parsed.emptySlotCount}</strong>
              <span>créneaux libres</span>
            </div>
          </div>

          <div className="admin-card admin-tournament-import__card">
            <div>
              <h2>Structure détectée</h2>
              <p>
                Parser {parsed.parserVersion} · {preview.pageCount} page
                {preview.pageCount > 1 ? "s" : ""} · {preview.lineCount} lignes
                utiles.
              </p>
            </div>
            <div className="admin-tournament-import__table-wrap">
              <table className="admin-tournament-import__table">
                <thead>
                  <tr>
                    <th>Série</th>
                    <th>Équipes</th>
                    <th>Poules</th>
                    <th>Matchs</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.series.map((series) => (
                    <tr key={series.series}>
                      <td>{series.series}</td>
                      <td>{series.teamCount}</td>
                      <td>{series.poolCount}</td>
                      <td>{series.fixtureCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.issues.length === 0 ? (
              <p className="admin-tournament-import__success">
                Structure cohérente : chaque équipe appartient à une seule poule
                et le calendrier couvre exactement les confrontations attendues.
              </p>
            ) : (
              <div className="admin-tournament-import__issues" role="alert">
                <strong>{parsed.issues.length} anomalie(s) détectée(s)</strong>
                <ul>
                  {parsed.issues.slice(0, 10).map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="admin-card admin-tournament-import__card">
            <div>
              <h2>Prévisualisation de l’extraction</h2>
              <p>
                Vérifiez que les équipes, poules et informations du tournoi sont
                lisibles. Cette zone peut contenir des données personnelles :
                elle reste locale et n’est pas enregistrée.
              </p>
            </div>
            <pre className="admin-tournament-import__preview">
              {preview.excerpt}
            </pre>
            {preview.truncated && (
              <small>
                Aperçu limité aux 80 premières lignes utiles. Le texte complet
                reste disponible en mémoire pour l’analyse suivante.
              </small>
            )}
            <p className="admin-tournament-import__privacy-note">
              Le rapprochement envoie uniquement le prénom, le nom et le
              téléphone structurés de chaque joueur au RPC sécurisé. Le PDF et
              son texte extrait restent dans votre navigateur. Une concordance
              nouvelle ne sera jamais validée automatiquement.
            </p>
            <div className="admin-tournament-import__actions">
              <button type="button" disabled={busy} onClick={reset}>
                Tester un autre PDF
              </button>
              <button
                type="button"
                className="admin-tournament-import__primary"
                disabled={busy || parsed.issues.length > 0}
                onClick={() => void analyseIdentityMatches()}
              >
                {busy
                  ? "Rapprochement en cours…"
                  : "Analyser les rapprochements"}
              </button>
            </div>
          </div>
        </>
      )}

      {step === 4 && identityMatches && matchSummary && (
        <>
          <div className="admin-card admin-tournament-import__match-summary">
            <div>
              <strong>{matchSummary.verified}</strong>
              <span>déjà vérifiés</span>
            </div>
            <div>
              <strong>{matchSummary.suggested}</strong>
              <span>suggestions</span>
            </div>
            <div>
              <strong>{matchSummary.conflict}</strong>
              <span>à contrôler</span>
            </div>
            <div>
              <strong>{matchSummary.unmatched}</strong>
              <span>non trouvés</span>
            </div>
          </div>

          <div className="admin-card admin-tournament-import__card">
            <div>
              <h2>Rapprochement des joueurs</h2>
              <p>
                Une identité déjà vérifiée peut être réutilisée. Toutes les
                nouvelles concordances restent de simples suggestions jusqu’à
                une validation explicite.
              </p>
            </div>
            <div className="admin-tournament-import__table-wrap">
              <table className="admin-tournament-import__table admin-tournament-import__matches">
                <thead>
                  <tr>
                    <th>Équipe</th>
                    <th>Joueur Errebot</th>
                    <th>Statut</th>
                    <th>Correspondance Pelote Manager</th>
                    <th>Pourquoi</th>
                  </tr>
                </thead>
                <tbody>
                  {identityMatches.map((match) => (
                    <tr key={match.externalKey}>
                      <td>#{match.teamExternalId}</td>
                      <td>
                        {match.firstName} {match.lastName}
                      </td>
                      <td>
                        <span
                          className={`admin-tournament-import__match-status is-${match.status}`}
                        >
                          {errebotIdentityStatusLabel(match.status)}
                        </span>
                      </td>
                      <td>
                        {match.memberDisplayName ? (
                          <div className="admin-tournament-import__candidate">
                            <strong>{match.memberDisplayName}</strong>
                            <span>
                              {match.licenceNumber ?? "Licence inconnue"}
                              {match.clubName ? ` · ${match.clubName}` : ""}
                              {match.linkedAccount ? " · compte lié" : ""}
                            </span>
                          </div>
                        ) : match.profileId ? (
                          "Compte Pelote Manager déjà vérifié"
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{errebotIdentityReasonLabel(match.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="admin-tournament-import__privacy-note">
              Aucun rapprochement proposé n’a encore été enregistré. L’étape
              suivante ajoutera la confirmation explicite des suggestions avant
              l’import transactionnel du tournoi.
            </p>
            <div className="admin-tournament-import__actions">
              <button type="button" onClick={() => setStep(3)}>
                Retour à la structure
              </button>
              <button type="button" onClick={reset}>
                Tester un autre PDF
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
