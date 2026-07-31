import { useState, type ReactNode } from "react";
type Props = {
  title: string;
  summary: string;
  confirmLabel: string;
  children?: ReactNode;
  error?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};
export function SensitiveActionDialog({
  title,
  summary,
  confirmLabel,
  children,
  error,
  pending,
  onCancel,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="member-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitive-title"
      >
        <h2 id="sensitive-title">{title}</h2>
        <p>{summary}</p>
        {children}
        <label>
          Motif obligatoire
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          Je confirme avoir vérifié cette opération sensible.
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="secondary" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={pending || !confirmed || !reason.trim()}
          >
            {pending ? "Traitement…" : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
