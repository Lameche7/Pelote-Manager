import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ClubMediaManager } from "../components/ClubMediaManager";
import { NetworkClubPublishing } from "../components/NetworkClubPublishing";
import {
  clubBrandingUploadService,
  type BrandingImageKind,
} from "../services/clubBrandingUploadService";
import { clubAdminService, type Club } from "../services/clubAdminService";
import "./ClubPages.css";
import "./ClubBranding.css";

type PreviewStyle = CSSProperties & {
  "--preview-primary": string;
  "--preview-secondary": string;
  "--preview-accent": string;
  "--preview-neutral": string;
  "--preview-hero": string;
};

const colorFields: Array<{ key: keyof Club; label: string; help: string }> = [
  {
    key: "primaryColor",
    label: "Couleur principale",
    help: "Navigation, fonds forts et titres principaux.",
  },
  {
    key: "secondaryColor",
    label: "Couleur secondaire",
    help: "Liens, éléments complémentaires et repères.",
  },
  {
    key: "accentColor",
    label: "Couleur d’accent",
    help: "Boutons importants, alertes et mises en avant.",
  },
  {
    key: "neutralColor",
    label: "Couleur neutre",
    help: "Textes secondaires, bordures et informations discrètes.",
  },
];

export function ClubInformationPage() {
  const [club, setClub] = useState<Club | null>(null);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<BrandingImageKind | null>(null);

  useEffect(() => {
    clubAdminService
      .getClub()
      .then(setClub)
      .catch(() =>
        setStatus("Impossible de charger les informations du club."),
      );
  }, []);

  const previewStyle = useMemo<PreviewStyle | undefined>(() => {
    if (!club) return undefined;
    return {
      "--preview-primary": club.primaryColor,
      "--preview-secondary": club.secondaryColor,
      "--preview-accent": club.accentColor,
      "--preview-neutral": club.neutralColor,
      "--preview-hero": `url("${club.heroImageUrl}")`,
    };
  }, [club]);

  const updateImage = async (kind: BrandingImageKind, file: File | null) => {
    if (!club || uploading) return;
    setUploading(kind);
    setStatus("");
    let uploadedUrl = "";
    try {
      if (file)
        uploadedUrl = await clubBrandingUploadService.upload(
          club.id,
          kind,
          file,
        );
      const nextClub = {
        ...club,
        [kind === "logo" ? "logoUrl" : "heroImageUrl"]: uploadedUrl,
      };
      await clubAdminService.updateClub(nextClub);
      setClub(nextClub);
      window.dispatchEvent(new CustomEvent("club-branding-updated"));
      setStatus(
        file ? "Image enregistrée avec succès." : "Image retirée du club.",
      );
    } catch (error: unknown) {
      if (uploadedUrl)
        await clubBrandingUploadService.discardUploadedImage(
          club.id,
          uploadedUrl,
        );
      setStatus(
        error instanceof Error
          ? error.message
          : "Impossible de modifier l’image.",
      );
    } finally {
      setUploading(null);
    }
  };

  if (!club) {
    return (
      <section className="admin-page">
        <p>{status || "Chargement…"}</p>
      </section>
    );
  }

  const field = (key: keyof Club, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={String(club[key])}
        onChange={(event) => setClub({ ...club, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>Informations générales et identité visuelle</h1>
        <p className="admin-page__lead">
          Ces informations personnalisent automatiquement l’instance du club et
          sa page d’accueil.
        </p>
      </header>

      <form
        className="club-information-layout"
        onSubmit={(event) => {
          event.preventDefault();
          setStatus("");
          setIsSaving(true);
          clubAdminService
            .updateClub(club)
            .then(() => {
              setStatus(
                "Informations enregistrées. La page d’accueil utilise désormais cette identité visuelle.",
              );
              window.dispatchEvent(new CustomEvent("club-branding-updated"));
            })
            .catch((error: unknown) =>
              setStatus(
                error instanceof Error
                  ? error.message
                  : "Enregistrement impossible.",
              ),
            )
            .finally(() => setIsSaving(false));
        }}
      >
        <div className="admin-card club-form">
          <div className="club-form__section club-form__wide">
            <div>
              <p className="admin-page__eyebrow">Identité</p>
              <h2>Coordonnées du club</h2>
            </div>
          </div>
          {field("name", "Nom du club")}
          {field("affiliationNumber", "Numéro d’affiliation")}
          {field("email", "E-mail", "email")}
          {field("phone", "Téléphone", "tel")}
          {field("website", "Site internet", "url")}
          {field("socialLinks", "Réseaux sociaux")}
          <label className="club-form__wide">
            Adresse
            <textarea
              value={club.address}
              onChange={(event) =>
                setClub({ ...club, address: event.target.value })
              }
            />
          </label>
          <label className="club-form__wide">
            Informations diverses
            <textarea
              value={club.notes}
              onChange={(event) =>
                setClub({ ...club, notes: event.target.value })
              }
            />
          </label>

          <div className="club-form__section club-form__wide">
            <div>
              <p className="admin-page__eyebrow">Apparence</p>
              <h2>Page d’accueil</h2>
              <p>
                Utilisez des adresses d’images publiques. Les quatre couleurs
                deviennent le thème de cette instance sans modifier le code.
              </p>
            </div>
          </div>
          {(
            [
              ["logo", "Logo du club"],
              ["hero", "Photo d’arrière-plan"],
            ] as const
          ).map(([kind, label]) => {
            const url = kind === "logo" ? club.logoUrl : club.heroImageUrl;
            return (
              <div
                className="club-form__wide"
                key={kind}
                style={{ display: "grid", gap: 10 }}
              >
                <strong>{label}</strong>
                <p style={{ margin: 0 }}>
                  PNG, JPG ou WebP — 2 Mo maximum. L’image est enregistrée
                  automatiquement.
                </p>
                {url && (
                  <img
                    src={url}
                    alt={label}
                    style={{
                      maxWidth: 260,
                      maxHeight: 140,
                      objectFit: "contain",
                      borderRadius: 12,
                    }}
                  />
                )}
                <label style={{ display: "block" }}>
                  {uploading === kind
                    ? "Téléversement en cours…"
                    : url
                      ? "Remplacer l’image"
                      : "Choisir une image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading !== null || isSaving}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void updateImage(kind, file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {url && (
                  <button
                    type="button"
                    disabled={uploading !== null || isSaving}
                    onClick={() => void updateImage(kind, null)}
                  >
                    Supprimer l’image
                  </button>
                )}
              </div>
            );
          })}

          <div className="club-branding-colors club-form__wide">
            {colorFields.map(({ key, label, help }) => (
              <label key={key}>
                <span>{label}</span>
                <div className="club-branding-color-input">
                  <input
                    type="color"
                    aria-label={`${label} — sélecteur`}
                    value={String(club[key])}
                    onChange={(event) =>
                      setClub({ ...club, [key]: event.target.value })
                    }
                  />
                  <input
                    type="text"
                    pattern="#[0-9A-Fa-f]{6}"
                    value={String(club[key])}
                    onChange={(event) =>
                      setClub({ ...club, [key]: event.target.value })
                    }
                  />
                </div>
                <small>{help}</small>
              </label>
            ))}
          </div>

          <ClubMediaManager />

          <div className="club-form__actions">
            <button type="submit" disabled={isSaving || uploading !== null}>
              {isSaving ? "Enregistrement…" : "Enregistrer et appliquer"}
            </button>
            <span role="status">{status}</span>
          </div>
        </div>

        <aside className="club-branding-preview" style={previewStyle}>
          <p className="admin-page__eyebrow">Aperçu</p>
          <div className="club-branding-preview__hero">
            {club.logoUrl && <img src={club.logoUrl} alt="" />}
            <span>{club.name || "Nom du club"}</span>
            <strong>Pelote Manager</strong>
            <button type="button">Réserver un créneau</button>
          </div>
          <div className="club-branding-preview__palette">
            <span title="Principale" />
            <span title="Secondaire" />
            <span title="Accent" />
            <span title="Neutre" />
          </div>
          <small>
            Cet aperçu représente l’ambiance générale. La page publique
            conservera sa mise en page responsive complète.
          </small>
        </aside>
      </form>
      <NetworkClubPublishing clubId={club.id} />
    </section>
  );
}
