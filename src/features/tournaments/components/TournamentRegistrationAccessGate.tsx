import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/infrastructure/supabase/client";

export function TournamentRegistrationAccessGate({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setUnlocked(false);
    setError("");
    void (async () => {
      try {
        const { data, error: problem } = await supabase.rpc(
          "get_tournament_registration_access",
          { target_tournament_id: tournamentId },
        );
        if (problem || !data) throw new Error();
        if (active) {
          setUnlocked(data.code_required === false || data.unlocked === true);
          setLoading(false);
        }
      } catch {
        if (active) {
          setError("Impossible de vérifier l’accès aux inscriptions.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [tournamentId, retry]);

  const unlock = async () => {
    setBusy(true);
    setError("");
    try {
      const { data, error: problem } = await supabase.rpc(
        "unlock_tournament_registration",
        { target_tournament_id: tournamentId, access_code: code.trim() },
      );
      if (problem || !data) throw new Error();
      if (data.unlocked === true) {
        setCode("");
        setUnlocked(true);
      } else if (data.closed) {
        setError("Les inscriptions sont fermées.");
      } else if (data.retry_at) {
        const time = new Date(data.retry_at).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        });
        setError(`Trop de tentatives. Réessayez à partir de ${time}.`);
      } else {
        setError("Code incorrect. Vérifiez le code communiqué par le club.");
      }
    } catch {
      setError("Impossible de vérifier le code. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  if (unlocked && !loading) return <>{children}</>;

  return (
    <div className="public-registration-login">
      {loading ? (
        <>
          <p>Vérification de l’accès aux inscriptions…</p>
          {error && (
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Réessayer
            </button>
          )}
        </>
      ) : (
        <>
          <h3>Inscriptions réservées</h3>
          <p>Munissez-vous du code communiqué par le club organisateur.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <label>
              Code d’accès
              <input
                type="password"
                autoComplete="off"
                value={code}
                maxLength={72}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || !code.trim()}
            >
              Déverrouiller les inscriptions
            </button>
          </form>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Vérifier si les inscriptions sont désormais libres
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
