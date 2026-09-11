import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  CreditCard,
  Download,
  FileCheck2,
  FileUp,
  RefreshCcw,
} from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import { useAuth } from "@/shared/hooks/useAuth";
import {
  licenceService,
  type LicencePortal,
  type LicenceRequestStatus,
} from "../services/licenceService";
import "./MyLicencePage.css";

const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

const STATUS_LABELS: Record<LicenceRequestStatus, string> = {
  pending_documents: "Document à fournir",
  pending_payment: "Paiement à effectuer",
  ready_for_review: "Dossier complet · en attente de validation",
  document_rejected: "Document à remplacer",
  approved: "Dossier validé par le club",
  licensed: "Licence enregistrée",
  cancelled: "Demande annulée",
};

export function MyLicencePage() {
  const { profile } = useAuth();
  const [portal, setPortal] = useState<LicencePortal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setPortal(await licenceService.getMyPortal());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger votre licence.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const amount = useMemo(() => {
    if (!portal?.campaign) return 0;
    return portal.recommendedType === "renewal"
      ? portal.campaign.renewalPriceCents
      : portal.campaign.firstApplicationPriceCents;
  }, [portal]);

  const startRenewal = async () => {
    setBusy(true);
    setError("");
    try {
      await licenceService.startMyRequest();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de démarrer la demande.");
    } finally {
      setBusy(false);
    }
  };

  const startFirstApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await licenceService.startMyRequest({
        firstName: String(form.get("firstName") || ""),
        lastName: String(form.get("lastName") || ""),
        birthDate: String(form.get("birthDate") || ""),
        gender: String(form.get("gender") || ""),
        phone: String(form.get("phone") || ""),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de démarrer la demande.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    if (!portal?.campaign?.applicationFormPath) return;
    setBusy(true);
    setError("");
    try {
      window.open(
        await licenceService.getTemplateUrl(portal.campaign.applicationFormPath),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible d’ouvrir le formulaire.");
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = portal?.request;
    if (!request) return;
    const input = event.currentTarget.elements.namedItem("document") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await licenceService.uploadMyDocument(request.id, file);
      setMessage("Document transmis au club.");
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible d’envoyer le document.");
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!portal?.request) return;
    setBusy(true);
    setError("");
    try {
      const url = await licenceService.preparePayment(portal.request.id);
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de lancer le paiement.");
      setBusy(false);
    }
  };

  return (
    <UserSpaceShell>
      <section className="my-licence" aria-labelledby="my-licence-title">
        <header className="my-licence__header">
          <div>
            <p>Mon espace</p>
            <h1 id="my-licence-title">Ma licence</h1>
            <span>Demandez ou renouvelez votre licence directement auprès du club.</span>
          </div>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCcw aria-hidden="true" /> Actualiser
          </button>
        </header>

        {error && <p className="my-licence__alert my-licence__alert--error" role="alert">{error}</p>}
        {message && <p className="my-licence__alert" role="status">{message}</p>}

        {loading ? (
          <p role="status">Chargement de votre situation…</p>
        ) : !portal?.campaign ? (
          <article className="my-licence__card">
            <h2>Aucune campagne ouverte</h2>
            <p>Le club n’a pas encore ouvert les demandes de licence pour une nouvelle saison.</p>
          </article>
        ) : portal.licensedForCampaign ? (
          <article className="my-licence__card my-licence__card--success">
            <BadgeCheck aria-hidden="true" />
            <div>
              <h2>Licence {portal.campaign.seasonName} valide</h2>
              <p>Votre licence est déjà enregistrée pour cette saison.</p>
              {portal.member && <strong>N° {portal.member.licenceNumber}</strong>}
            </div>
          </article>
        ) : !portal.campaign.isOpen ? (
          <article className="my-licence__card">
            <h2>Campagne {portal.campaign.seasonName}</h2>
            <p>La campagne est configurée mais n’est pas ouverte actuellement.</p>
          </article>
        ) : !portal.request ? (
          portal.recommendedType === "renewal" ? (
            <article className="my-licence__card">
              <div className="my-licence__badge">Renouvellement</div>
              <h2>Renouveler ma licence {portal.campaign.seasonName}</h2>
              <p>Pour un renouvellement, il vous suffit de déposer votre certificat médical puis de régler la licence.</p>
              <div className="my-licence__price">{euro(amount)}</div>
              {portal.campaign.instructions && <p>{portal.campaign.instructions}</p>}
              <button type="button" disabled={busy} onClick={() => void startRenewal()}>
                Commencer mon renouvellement
              </button>
            </article>
          ) : (
            <article className="my-licence__card">
              <div className="my-licence__badge">Première licence</div>
              <h2>Demander une première licence</h2>
              <p>Téléchargez d’abord le formulaire FFPB, complétez-le et faites-le viser si nécessaire. Vous pourrez ensuite le déposer ici et payer votre licence.</p>
              <div className="my-licence__actions">
                <button type="button" className="secondary" disabled={busy || !portal.campaign.applicationFormPath} onClick={() => void downloadTemplate()}>
                  <Download aria-hidden="true" /> Télécharger le formulaire
                </button>
                <strong>{euro(amount)}</strong>
              </div>
              <form className="my-licence__form" onSubmit={(event) => void startFirstApplication(event)}>
                <label>Prénom<input name="firstName" required defaultValue={profile?.firstName ?? ""} /></label>
                <label>Nom<input name="lastName" required defaultValue={profile?.lastName ?? ""} /></label>
                <label>Date de naissance<input name="birthDate" type="date" required /></label>
                <label>Sexe<select name="gender" required><option value="">Choisir</option><option value="female">Femme</option><option value="male">Homme</option></select></label>
                <label>Téléphone<input name="phone" type="tel" /></label>
                <button disabled={busy}>Créer ma demande</button>
              </form>
            </article>
          )
        ) : (
          <div className="my-licence__stack">
            <article className="my-licence__card">
              <div className="my-licence__request-head">
                <div>
                  <div className="my-licence__badge">
                    {portal.request.type === "renewal" ? "Renouvellement" : "Première licence"}
                  </div>
                  <h2>{portal.campaign.seasonName}</h2>
                </div>
                <strong>{STATUS_LABELS[portal.request.status]}</strong>
              </div>
              {portal.request.rejectionReason && (
                <p className="my-licence__alert my-licence__alert--error">
                  Document refusé : {portal.request.rejectionReason}
                </p>
              )}
            </article>

            <div className="my-licence__steps">
              {portal.request.type === "first_application" && (
                <article className="my-licence__card">
                  <Download aria-hidden="true" />
                  <h3>1. Formulaire FFPB</h3>
                  <p>Téléchargez le formulaire de première demande et complétez-le avant de le déposer.</p>
                  <button type="button" className="secondary" disabled={busy || !portal.campaign.applicationFormPath} onClick={() => void downloadTemplate()}>
                    Télécharger
                  </button>
                </article>
              )}

              <article className="my-licence__card">
                {portal.request.documentPath ? <FileCheck2 aria-hidden="true" /> : <FileUp aria-hidden="true" />}
                <h3>{portal.request.type === "renewal" ? "Certificat médical" : "Formulaire complété"}</h3>
                <p>{portal.request.documentOriginalName ?? "Aucun document transmis"}</p>
                {portal.request.status !== "approved" && portal.request.status !== "licensed" && (
                  <form onSubmit={(event) => void uploadDocument(event)}>
                    <input name="document" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" />
                    <button disabled={busy}>{portal.request.documentPath ? "Remplacer" : "Déposer le document"}</button>
                  </form>
                )}
              </article>

              <article className="my-licence__card">
                <CreditCard aria-hidden="true" />
                <h3>Paiement</h3>
                <div className="my-licence__price">{euro(portal.request.amountCents)}</div>
                {portal.request.payment?.status === "paid" ? (
                  <strong>✓ Paiement reçu</strong>
                ) : portal.request.status === "approved" || portal.request.status === "licensed" ? null : (
                  <button type="button" disabled={busy} onClick={() => void pay()}>
                    Payer avec HelloAsso
                  </button>
                )}
              </article>
            </div>
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
