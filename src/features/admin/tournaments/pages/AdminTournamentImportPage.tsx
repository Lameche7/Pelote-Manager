import { useState } from "react";
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
import "./AdminTournamentImportPage.css";

type SelectedPdf = {
  file: File;
  hash: string;
};

const steps = ["Fichier", "Contrôle", "Prévisualisation"] as const;

export function AdminTournamentImportPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [preview, setPreview] = useState<ErrebotExtractionPreview | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setSelected(null);
    setPreview(null);
    setError("");
    setStep(1);
  };

  const selectFile = async (file: File) => {
    setError("");
    setPreview(null);
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
      setPreview(nextPreview);
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

  return (
    <section className="admin-page admin-tournament-import">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois · Errebot</p>
          <h1>Importer un tournoi</h1>
          <p className="admin-page__lead">
            Contrôlez le PDF Errebot et vérifiez son extraction avant toute
            création dans Pelote Manager. À cette étape, le document reste
            uniquement dans votre navigateur.
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

      {step === 3 && selected && preview && (
        <>
          <div className="admin-card admin-tournament-import__summary">
            <div>
              <strong>{preview.pageCount}</strong>
              <span>page{preview.pageCount > 1 ? "s" : ""}</span>
            </div>
            <div>
              <strong>{preview.lineCount}</strong>
              <span>lignes utiles</span>
            </div>
            <div>
              <strong>{preview.characterCount}</strong>
              <span>caractères extraits</span>
            </div>
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
            <div className="admin-tournament-import__actions">
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
