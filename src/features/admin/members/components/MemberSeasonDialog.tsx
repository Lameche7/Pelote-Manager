import { useState } from "react";
import type { MemberSeason } from "../types";
type Props = {
  season: MemberSeason;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (input: {
    ranking: string | null;
    isLicensed: boolean;
    reason: string;
  }) => void;
};
export function MemberSeasonDialog({
  season,
  pending,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [ranking, setRanking] = useState(season.ranking ?? "");
  const [isLicensed, setIsLicensed] = useState(season.isLicensed);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const sensitive = isLicensed !== season.isLicensed;
  const blocked =
    (!season.isActive && !reason.trim()) ||
    ((!season.isActive || sensitive) && !confirmed);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="member-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="season-dialog-title"
      >
        <h2 id="season-dialog-title">Modifier la saison {season.seasonName}</h2>
        <dl>
          <dt>Club représenté</dt>
          <dd>{season.clubName}</dd>
          <dt>Catégorie calculée</dt>
          <dd>{season.category}</dd>
          <dt>Classement actuel</dt>
          <dd>{season.ranking ?? "—"}</dd>
          <dt>Statut actuel</dt>
          <dd>{season.isLicensed ? "Licencié" : "Non licencié"}</dd>
        </dl>
        <label>
          Classement
          <input
            value={ranking}
            onChange={(event) => setRanking(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={isLicensed}
            onChange={(event) => setIsLicensed(event.target.checked)}
          />{" "}
          Licence valide pour cette saison
        </label>
        <label>
          Motif {season.isActive ? "facultatif" : "obligatoire"}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
        </label>
        {(!season.isActive || sensitive) && (
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            Je confirme cette correction{" "}
            {season.isActive ? "de validité" : "historique"}.
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="secondary" disabled={pending} onClick={onCancel}>
            Annuler
          </button>
          <button
            disabled={pending || blocked}
            onClick={() =>
              onConfirm({
                ranking: ranking.trim() || null,
                isLicensed,
                reason: reason.trim(),
              })
            }
          >
            {pending ? "Enregistrement…" : "Enregistrer la saison"}
          </button>
        </footer>
      </section>
    </div>
  );
}
