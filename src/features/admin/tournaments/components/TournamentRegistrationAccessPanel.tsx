import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type Mode = "free" | "locked" | "temporary";

export function TournamentRegistrationAccessPanel({
  tournamentId,
  toLocalInput,
  toStoredDateTime,
}: {
  tournamentId: string;
  toLocalInput: (value: string) => string;
  toStoredDateTime: (value: string) => string;
}) {
  const [mode, setMode] = useState<Mode>("free");
  const [code, setCode] = useState("");
  const [opening, setOpening] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setCode("");
    setMessage("");
    void (async () => {
      try {
        const { data, error: problem } = await supabase.rpc(
          "get_tournament_registration_access",
          { target_tournament_id: tournamentId },
        );
        if (problem || !data) throw new Error();
        if (!active) return;
        setHasCode(Boolean(data.code_required || data.opens_public_at));
        setMode(
          data.opens_public_at
            ? "temporary"
            : data.code_required
              ? "locked"
              : "free",
        );
        setOpening(
          data.opens_public_at ? toLocalInput(data.opens_public_at) : "",
        );
        setLoading(false);
      } catch {
        if (active) setError("Impossible de charger les règles d’accès.");
      }
    })();
    return () => {
      active = false;
    };
  }, [tournamentId, toLocalInput]);

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: problem } = await supabase.rpc(
        "admin_set_tournament_registration_access",
        {
          target_tournament_id: tournamentId,
          access_mode: mode,
          access_code: mode === "free" ? null : code.trim() || null,
          public_at: mode === "temporary" ? toStoredDateTime(opening) : null,
        },
      );
      if (problem) throw problem;
      setHasCode(mode !== "free");
      setCode("");
      setMessage("Règles d’accès enregistrées.");
    } catch {
      setError("Enregistrement impossible. Vérifiez le code et la date.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card tournament-form">
      <h3>Accès aux inscriptions</h3>
      <p>Les équipes déjà inscrites conservent leur inscription.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p>Chargement des règles d’accès…</p>
      ) : (
        <>
          <label>
            Mode d’inscription
            <select
              value={mode}
              disabled={saving}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              <option value="free">Inscriptions libres</option>
              <option value="locked">Code obligatoire</option>
              <option value="temporary">Priorité temporaire sur code</option>
            </select>
          </label>
          {mode !== "free" && (
            <label>
              {hasCode ? "Nouveau code (facultatif)" : "Code d’accès"}
              <input
                type="text"
                autoComplete="off"
                value={code}
                minLength={8}
                maxLength={72}
                disabled={saving}
                onChange={(event) => setCode(event.target.value)}
                placeholder={hasCode ? "Conserver le code actuel" : ""}
              />
              <small>
                Minimum 8 caractères. Copiez le code avant de l’enregistrer :
                il ne sera plus affiché.
              </small>
            </label>
          )}
          {mode === "temporary" && (
            <label>
              Ouverture à tous (heure de Paris)
              <input
                type="datetime-local"
                value={opening}
                disabled={saving}
                onChange={(event) => setOpening(event.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className="tournaments-primary"
            disabled={
              saving ||
              (mode !== "free" && !hasCode && code.trim().length < 8) ||
              (mode === "temporary" && !opening)
            }
            onClick={() => void save()}
          >
            Enregistrer les règles d’accès
          </button>
        </>
      )}
    </section>
  );
}
