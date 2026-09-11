import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  CalendarPlus,
  Download,
  FileCheck2,
  FileWarning,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  localInputToStoredDateTime,
  storedDateTimeToLocalInput,
} from "@/features/admin/events/domain/eventDateTime";
import {
  licenceService,
  type AdminLicenceRequest,
  type AdminLicenceSettings,
} from "@/features/licences/services/licenceService";
import { ROUTES } from "@/shared/config";
import "./AdminLicencesPage.css";

type Tab = "requests" | "settings";

const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

const typeLabel = (request: AdminLicenceRequest) =>
  request.type === "renewal" ? "Renouvellement" : "Première licence";

const statusLabel = (request: AdminLicenceRequest) => {
  switch (request.status) {
    case "pending_documents":
      return "Document attendu";
    case "pending_payment":
      return "Paiement attendu";
    case "ready_for_review":
      return "À contrôler";
    case "document_rejected":
      return "Document refusé";
    case "approved":
      return "Dossier validé";
    case "licensed":
      return "Licence enregistrée";
    case "cancelled":
      return "Annulé";
  }
};

export function AdminLicencesPage() {
  const [tab, setTab] = useState<Tab>("requests");
  const [settings, setSettings] = useState<AdminLicenceSettings | null>(null);
  const [requests, setRequests] = useState<AdminLicenceRequest[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextRequests] = await Promise.all([
        licenceService.getAdminSettings(),
        licenceService.listAdminRequests(),
      ]);
      setSettings(nextSettings);
      setRequests(nextRequests);
      setSeasonId(
        (current) =>
          current ||
          nextSettings.seasons.find((season) => season.isActive)?.id ||
          nextSettings.seasons[0]?.id ||
          "",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible de charger les licences.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const campaign = useMemo(
    () =>
      settings?.campaigns.find((item) => item.seasonId === seasonId) ?? null,
    [settings, seasonId],
  );

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || !seasonId) return;
    const form = new FormData(event.currentTarget);
    const renewalPrice = Math.round(
      Number(form.get("renewalPrice") || 0) * 100,
    );
    const firstPrice = Math.round(Number(form.get("firstPrice") || 0) * 100);
    const opensAt = String(form.get("opensAt") || "");
    const closesAt = String(form.get("closesAt") || "");
    const template = (
      event.currentTarget.elements.namedItem("template") as HTMLInputElement
    ).files?.[0];

    setBusy(true);
    setError("");
    setMessage("");
    try {
      let applicationFormPath = campaign?.applicationFormPath ?? null;
      if (template) {
        if (template.type !== "application/pdf") {
          throw new Error(
            "Le formulaire de première licence doit être un PDF.",
          );
        }
        applicationFormPath = await licenceService.uploadTemplate(
          settings.clubId,
          seasonId,
          template,
        );
      }
      await licenceService.saveCampaign({
        seasonId,
        isOpen: form.get("isOpen") === "on",
        renewalPriceCents: renewalPrice,
        firstApplicationPriceCents: firstPrice,
        opensAt: opensAt ? localInputToStoredDateTime(opensAt) : null,
        closesAt: closesAt ? localInputToStoredDateTime(closesAt) : null,
        applicationFormPath,
        instructions: String(form.get("instructions") || "").trim() || null,
      });
      setMessage("Paramètres de licence enregistrés.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’enregistrer les paramètres.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (request: AdminLicenceRequest) => {
    if (!request.documentPath) return;
    setBusy(true);
    setError("");
    try {
      window.open(
        await licenceService.getDocumentUrl(request.documentPath),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’ouvrir le document.",
      );
    } finally {
      setBusy(false);
    }
  };

  const review = async (
    request: AdminLicenceRequest,
    action: "approve" | "reject" | "mark_licensed",
  ) => {
    let reason: string | undefined;
    let licenceNumber: string | undefined;
    if (action === "reject") {
      reason = window.prompt("Pourquoi ce document est-il refusé ?")?.trim();
      if (!reason) return;
    }
    if (action === "mark_licensed" && request.type === "first_application") {
      licenceNumber = window
        .prompt("Numéro de licence attribué par la FFPB :")
        ?.trim();
      if (!licenceNumber) return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await licenceService.review(request.id, action, reason, licenceNumber);
      setMessage(
        action === "reject"
          ? "Le joueur devra remplacer son document."
          : action === "approve"
            ? "Dossier validé par le club."
            : "Licence enregistrée pour la saison.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible de traiter le dossier.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-licences">
      <header className="admin-licences__header">
        <div>
          <p className="eyebrow">Licenciés</p>
          <h1>Licences</h1>
          <p>
            Suivez les renouvellements et les premières demandes de licence.
          </p>
        </div>
        <nav aria-label="Sections licences">
          <button
            className={tab === "requests" ? "active" : "secondary"}
            onClick={() => setTab("requests")}
          >
            <FileCheck2 aria-hidden="true" /> Demandes
          </button>
          <button
            className={tab === "settings" ? "active" : "secondary"}
            onClick={() => setTab("settings")}
          >
            <Settings aria-hidden="true" /> Paramètres
          </button>
        </nav>
      </header>

      {error && (
        <p
          className="admin-licences__alert admin-licences__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="admin-licences__alert" role="status">
          {message}
        </p>
      )}

      {loading ? (
        <p role="status">Chargement…</p>
      ) : tab === "settings" ? (
        <form
          className="admin-licences__panel"
          onSubmit={(event) => void saveSettings(event)}
        >
          <div className="admin-licences__season-row">
            <label>
              Saison
              <select
                value={seasonId}
                onChange={(event) => setSeasonId(event.target.value)}
                required
              >
                {settings?.seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                    {season.isActive ? " · active" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-licences__season-actions">
              <span>
                Les saisons sont libres : 2027, 2026-2027 ou toute autre période
                définie par le club.
              </span>
              <Link className="secondary" to={ROUTES.adminClubSeasons}>
                <CalendarPlus aria-hidden="true" /> Créer / gérer les saisons
              </Link>
            </div>
          </div>

          <div className="admin-licences__form-grid">
            <label>
              Tarif renouvellement (€)
              <input
                name="renewalPrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={campaign ? campaign.renewalPriceCents / 100 : ""}
                key={`renewal-${seasonId}-${campaign?.updatedAt ?? "new"}`}
                required
              />
            </label>
            <label>
              Tarif première licence (€)
              <input
                name="firstPrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  campaign ? campaign.firstApplicationPriceCents / 100 : ""
                }
                key={`first-${seasonId}-${campaign?.updatedAt ?? "new"}`}
                required
              />
            </label>
            <label>
              Ouverture
              <input
                name="opensAt"
                type="datetime-local"
                defaultValue={
                  campaign?.opensAt
                    ? storedDateTimeToLocalInput(campaign.opensAt)
                    : ""
                }
                key={`open-${seasonId}-${campaign?.updatedAt ?? "new"}`}
              />
            </label>
            <label>
              Clôture
              <input
                name="closesAt"
                type="datetime-local"
                defaultValue={
                  campaign?.closesAt
                    ? storedDateTimeToLocalInput(campaign.closesAt)
                    : ""
                }
                key={`close-${seasonId}-${campaign?.updatedAt ?? "new"}`}
              />
            </label>
            <label>
              Formulaire première licence (PDF)
              <input name="template" type="file" accept="application/pdf" />
              <small>
                {campaign?.applicationFormPath
                  ? "Un formulaire est déjà enregistré."
                  : "Aucun formulaire enregistré."}
              </small>
            </label>
          </div>
          <label>
            Instructions pour les joueurs
            <textarea
              name="instructions"
              rows={4}
              defaultValue={campaign?.instructions ?? ""}
              key={`instructions-${seasonId}-${campaign?.updatedAt ?? "new"}`}
            />
          </label>
          <label className="admin-licences__switch">
            <input
              name="isOpen"
              type="checkbox"
              defaultChecked={campaign?.isOpen ?? false}
              key={`toggle-${seasonId}-${campaign?.updatedAt ?? "new"}`}
            />
            Ouvrir la campagne aux joueurs
          </label>
          <footer>
            <button disabled={busy || !seasonId}>Enregistrer</button>
          </footer>
        </form>
      ) : requests.length === 0 ? (
        <div className="admin-licences__panel">
          <p>Aucune demande de licence pour le moment.</p>
        </div>
      ) : (
        <div className="admin-licences__requests">
          {requests.map((request) => (
            <article key={request.id} className="admin-licences__request">
              <header>
                <div>
                  <span>
                    {typeLabel(request)} · {request.seasonName}
                  </span>
                  <h2>
                    {request.firstName} {request.lastName}
                  </h2>
                  <small>
                    {request.licenceNumber
                      ? `Licence ${request.licenceNumber}`
                      : request.email}
                  </small>
                </div>
                <strong>{statusLabel(request)}</strong>
              </header>
              <dl>
                <div>
                  <dt>Document</dt>
                  <dd>{request.documentOriginalName ?? "Manquant"}</dd>
                </div>
                <div>
                  <dt>Paiement</dt>
                  <dd>
                    {request.paymentStatus === "paid"
                      ? `Payé · ${euro(request.amountCents)}`
                      : `À régler · ${euro(request.amountCents)}`}
                  </dd>
                </div>
              </dl>
              {request.rejectionReason && (
                <p className="admin-licences__warning">
                  <FileWarning aria-hidden="true" /> {request.rejectionReason}
                </p>
              )}
              <footer>
                {request.documentPath && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void openDocument(request)}
                  >
                    <Download aria-hidden="true" /> Voir le document
                  </button>
                )}
                {request.status === "ready_for_review" && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void review(request, "reject")}
                    >
                      Refuser le document
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void review(request, "approve")}
                    >
                      Valider le dossier
                    </button>
                  </>
                )}
                {request.status === "approved" && (
                  <button
                    disabled={busy}
                    onClick={() => void review(request, "mark_licensed")}
                  >
                    <BadgeCheck aria-hidden="true" />{" "}
                    {request.type === "renewal"
                      ? "Confirmer le renouvellement"
                      : "Enregistrer la licence"}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
