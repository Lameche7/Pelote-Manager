import { useCallback, useEffect, useMemo, useState } from "react";
import { requirePlatformSupabase } from "@/infrastructure/platform/platformClient";

type RegistrationStatus = "pending" | "contacted" | "approved" | "rejected";
type RegistrationRequest = {
  id: string;
  club_name: string;
  city: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  requested_plan: "essentiel" | "club" | "premium";
  status: RegistrationStatus;
  created_at: string;
  reviewed_at: string | null;
};

const labels: Record<RegistrationStatus, string> = {
  pending: "À traiter",
  contacted: "Contacté",
  approved: "Accepté",
  rejected: "Refusé",
};
const planLabels = {
  essentiel: "Essentiel · 9,90 €",
  club: "Club · 14,90 €",
  premium: "Premium · 19,90 €",
};

async function apiCall<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await requirePlatformSupabase().auth.getSession();
  if (!session?.access_token) throw new Error("Veuillez vous reconnecter.");
  const response = await fetch("/api/platform-registration-requests", {
    method,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Service des demandes indisponible.");
  }
  return payload as T;
}

export function PlatformRegistrationRequestsPanel() {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState("");
  const [filter, setFilter] = useState<RegistrationStatus | "all">("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiCall<{ requests: RegistrationRequest[] }>("GET");
      setRequests(result.requests);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Chargement impossible.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? requests
        : requests.filter((request) => request.status === filter),
    [filter, requests],
  );
  const pending = requests.filter(
    (request) => request.status === "pending",
  ).length;

  const setStatus = async (
    request: RegistrationRequest,
    status: RegistrationStatus,
  ) => {
    if (request.status === status || changingId) return;
    setChangingId(request.id);
    setError("");
    setMessage("");
    try {
      const result = await apiCall<{ request: RegistrationRequest }>("POST", {
        id: request.id,
        status,
      });
      setRequests((items) =>
        items.map((item) => (item.id === request.id ? result.request : item)),
      );
      setMessage(
        `Statut de ${request.club_name} : ${labels[status].toLowerCase()}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Mise à jour impossible.",
      );
    } finally {
      setChangingId("");
    }
  };

  return (
    <section
      className="platform-card platform-registration-panel"
      id="demandes-inscription"
    >
      <div className="platform-registration-panel__heading">
        <div>
          <p className="platform-kicker">Pilotoki Network</p>
          <h2>Demandes d'inscription</h2>
          <p>
            {pending} demande{pending > 1 ? "s" : ""} à traiter ·{" "}
            {requests.length} candidature{requests.length > 1 ? "s" : ""}{" "}
            récente
            {requests.length > 1 ? "s" : ""}
          </p>
        </div>
        <button
          className="button button--small button--ghost"
          type="button"
          onClick={() => void refresh()}
          disabled={loading || Boolean(changingId)}
        >
          {loading ? "Actualisation…" : "Actualiser"}
        </button>
      </div>
      <p className="platform-registration-panel__notice">
        Accepter une demande signifie uniquement la valider pour le suivi
        commercial. Cela ne crée ni club, ni compte, ni abonnement, ni paiement.
      </p>
      {error && (
        <p className="platform-message platform-message--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="platform-message platform-message--success" role="status">
          {message}
        </p>
      )}
      <div
        className="platform-registration-panel__filters"
        role="group"
        aria-label="Filtrer les demandes"
      >
        {(["all", "pending", "contacted", "approved", "rejected"] as const).map(
          (option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              className="button button--small button--ghost"
              onClick={() => setFilter(option)}
            >
              {option === "all" ? "Toutes" : labels[option]}
            </button>
          ),
        )}
      </div>
      {loading ? (
        <p>Chargement des candidatures…</p>
      ) : visible.length === 0 ? (
        <p>Aucune demande dans cette catégorie.</p>
      ) : (
        <div className="platform-registration-panel__list">
          {visible.map((request) => (
            <article
              className="platform-registration-panel__item"
              key={request.id}
            >
              <div className="platform-registration-panel__item-header">
                <div>
                  <h3>{request.club_name}</h3>
                  <small>
                    {request.city} ·{" "}
                    {new Date(request.created_at).toLocaleDateString("fr-FR")}
                  </small>
                </div>
                <span
                  className={`platform-registration-panel__status platform-registration-panel__status--${request.status}`}
                >
                  {labels[request.status]}
                </span>
              </div>
              <p>
                <strong>{planLabels[request.requested_plan]}</strong> ·{" "}
                {request.contact_name}
              </p>
              <div className="platform-registration-panel__contact">
                <a href={`mailto:${request.contact_email}`}>
                  {request.contact_email}
                </a>
                {request.contact_phone && (
                  <a href={`tel:${request.contact_phone}`}>
                    {request.contact_phone}
                  </a>
                )}
              </div>
              <div className="platform-registration-panel__actions">
                {(
                  ["contacted", "approved", "rejected", "pending"] as const
                ).map((status) => (
                  <button
                    key={status}
                    className="button button--small button--ghost"
                    type="button"
                    disabled={Boolean(changingId) || request.status === status}
                    onClick={() => void setStatus(request, status)}
                  >
                    {status === "pending"
                      ? "Remettre en attente"
                      : status === "contacted"
                        ? "Marquer contacté"
                        : status === "approved"
                          ? "Accepter"
                          : "Refuser"}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {requests.length >= 100 && (
        <small>Seules les 100 demandes les plus récentes sont affichées.</small>
      )}
    </section>
  );
}
