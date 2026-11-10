import { useState } from "react";
import { env } from "@/shared/config/env";
import { platformSupabase } from "@/infrastructure/platform/platformClient";

type Diagnostic = {
  ok: boolean;
  timestamp?: string;
  status?: number;
  rayId?: string | null;
  server?: string | null;
  cfMitigated?: string | null;
  contentType?: string | null;
  responseBody?: string;
  error?: string;
};

export function PlatformHelloAssoDiagnosticPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Diagnostic | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      if (!platformSupabase) throw new Error("Connexion super admin indisponible.");
      const { data: { session } } = await platformSupabase.auth.getSession();
      if (!session) throw new Error("Reconnectez-vous à la console super admin.");
      const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/helloasso-oauth-diagnostic`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json() as Diagnostic;
      setResult(payload);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Test impossible." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="platform-section">
      <h2>Intégrations · HelloAsso</h2>
      <p>Test d'authentification uniquement : aucun paiement ni commande n'est créé.</p>
      <button className="button" type="button" disabled={running} onClick={() => void run()}>
        {running ? "Connexion en cours…" : "Tester la connexion HelloAsso"}
      </button>
      {result && (
        <div role="status" style={{ marginTop: 12 }}>
          <strong>{result.ok ? "Connexion HelloAsso réussie" : "Connexion HelloAsso non validée"}</strong>
          <p>{result.error ?? (result.ok ? "Jeton OAuth obtenu (non affiché)." : "Voir les informations de diagnostic ci-dessous.")}</p>
          {result.timestamp && <p>Date UTC : {result.timestamp}</p>}
          {result.status && <p>HTTP : {result.status}</p>}
          {result.rayId && <p>Ray ID : {result.rayId}</p>}
          {result.server && <p>Serveur : {result.server}</p>}
          {result.cfMitigated && <p>cf-mitigated : {result.cfMitigated}</p>}
          {result.contentType && <p>Content-Type : {result.contentType}</p>}
          {result.responseBody && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.responseBody}</pre>}
        </div>
      )}
    </section>
  );
}
