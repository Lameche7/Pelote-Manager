import { ImageIcon, Palette, Save, Upload } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  clubIdentityService,
  type ClubIdentity,
} from "../services/clubIdentityService";
import "./ClubPages.css";

type PreviewStyle = CSSProperties & {
  "--club-preview-primary": string;
  "--club-preview-secondary": string;
  "--club-preview-accent": string;
  "--club-preview-neutral": string;
  "--club-preview-image": string;
};

type IdentityTextKey = Exclude<
  keyof ClubIdentity,
  | "id"
  | "updatedAt"
  | "primaryColor"
  | "secondaryColor"
  | "accentColor"
  | "neutralColor"
>;

type ColorKey =
  | "primaryColor"
  | "secondaryColor"
  | "accentColor"
  | "neutralColor";

const colorPattern = /^#[0-9a-f]{6}$/i;

const useFilePreview = (file: File | null, fallback: string) => {
  const [preview, setPreview] = useState(fallback);

  useEffect(() => {
    if (!file) {
      setPreview(fallback);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [fallback, file]);

  return preview;
};

export function ClubInformationPage() {
  const [club, setClub] = useState<ClubIdentity | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    clubIdentityService
      .getIdentity()
      .then(setClub)
      .catch(() => setStatus("Impossible de charger l’identité du club."));
  }, []);

  const logoPreview = useFilePreview(logoFile, club?.logoUrl ?? "");
  const heroPreview = useFilePreview(heroFile, club?.heroImageUrl ?? "");

  const previewStyle = useMemo<PreviewStyle | undefined>(() => {
    if (!club) return undefined;
    return {
      "--club-preview-primary": club.primaryColor,
      "--club-preview-secondary": club.secondaryColor,
      "--club-preview-accent": club.accentColor,
      "--club-preview-neutral": club.neutralColor,
      "--club-preview-image": heroPreview ? `url("${heroPreview}")` : "none",
    };
  }, [club, heroPreview]);

  if (!club) {
    return (
      <section className="admin-page">
        <p>{status || "Chargement…"}</p>
      </section>
    );
  }

  const updateText = (key: IdentityTextKey, value: string) =>
    setClub((current) => (current ? { ...current, [key]: value } : current));

  const updateColor = (key: ColorKey, value: string) =>
    setClub((current) =>
      current ? { ...current, [key]: value.toLowerCase() } : current,
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("");

    if (!club.name.trim() || !club.shortName.trim() || !club.logoAlt.trim()) {
      setStatus("Le nom, le nom court et le texte alternatif du logo sont obligatoires.");
      return;
    }

    const colors = [
      club.primaryColor,
      club.secondaryColor,
      club.accentColor,
      club.neutralColor,
    ];
    if (colors.some((value) => !colorPattern.test(value))) {
      setStatus("Les quatre couleurs doivent utiliser le format #RRGGBB.");
      return;
    }

    setIsSaving(true);
    try {
      let nextClub = { ...club };
      if (logoFile) {
        nextClub.logoUrl = await clubIdentityService.uploadLogo(club.id, logoFile);
      }
      if (heroFile) {
        nextClub.heroImageUrl = await clubIdentityService.uploadHeroImage(
          club.id,
          heroFile,
        );
      }

      nextClub = await clubIdentityService.updateIdentity(nextClub);
      setClub(nextClub);
      setLogoFile(null);
      setHeroFile(null);
      setStatus("Identité enregistrée et appliquée au site.");
    } catch (saveError: unknown) {
      setStatus(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const textField = (
    key: IdentityTextKey,
    label: string,
    type = "text",
    placeholder = "",
  ) => (
    <label>
      {label}
      <input
        type={type}
        value={club[key]}
        placeholder={placeholder}
        onChange={(event) => updateText(key, event.target.value)}
      />
    </label>
  );

  const colorField = (
    key: ColorKey,
    label: string,
    description: string,
  ) => (
    <label className="club-identity__color">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span>
        <input
          type="color"
          value={club[key]}
          aria-label={`${label} — sélecteur`}
          onChange={(event) => updateColor(key, event.target.value)}
        />
        <input
          type="text"
          value={club[key]}
          pattern="#[0-9A-Fa-f]{6}"
          aria-label={`${label} — code hexadécimal`}
          onChange={(event) => updateColor(key, event.target.value)}
        />
      </span>
    </label>
  );

  return (
    <section className="admin-page club-identity">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>Informations et identité visuelle</h1>
        <p className="admin-page__lead">
          Le nom, les images et la palette enregistrés ici personnalisent
          immédiatement l’accueil, l’en-tête et le pied de page de cette
          instance Pelote Manager.
        </p>
      </header>

      <form className="club-identity__layout" onSubmit={submit}>
        <div className="club-identity__editor">
          <article className="admin-card club-identity__section">
            <header>
              <h2>Identité du club</h2>
              <p>Les textes visibles sur la page d’accueil.</p>
            </header>
            <div className="club-form">
              {textField("name", "Nom complet du club")}
              {textField("shortName", "Nom court")}
              {textField("location", "Ville ou territoire")}
              {textField("venueName", "Nom de l’installation principale")}
              {textField("tagline", "Slogan")}
              {textField("foundedYear", "Année de fondation", "number")}
              <label className="club-form__wide">
                Présentation du club
                <textarea
                  value={club.description}
                  onChange={(event) =>
                    updateText("description", event.target.value)
                  }
                />
              </label>
            </div>
          </article>

          <article className="admin-card club-identity__section">
            <header>
              <ImageIcon aria-hidden="true" />
              <div>
                <h2>Logo et photo d’accueil</h2>
                <p>Formats acceptés : PNG, JPEG ou WebP, 8 Mo maximum.</p>
              </div>
            </header>
            <div className="club-identity__media-grid">
              <div className="club-identity__upload-card">
                <strong>Logo</strong>
                <div className="club-identity__logo-preview">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Aperçu du logo" />
                  ) : (
                    <span>Aucun logo</span>
                  )}
                </div>
                <label className="club-identity__file-button">
                  <Upload aria-hidden="true" /> Choisir un logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setLogoFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {textField("logoUrl", "URL du logo", "url")}
                {textField("logoAlt", "Texte alternatif du logo")}
              </div>

              <div className="club-identity__upload-card">
                <strong>Photo d’arrière-plan</strong>
                <div className="club-identity__hero-preview">
                  {heroPreview ? (
                    <img src={heroPreview} alt="Aperçu de l’accueil" />
                  ) : (
                    <span>Aucune photo</span>
                  )}
                </div>
                <label className="club-identity__file-button">
                  <Upload aria-hidden="true" /> Choisir une photo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setHeroFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {textField("heroImageUrl", "URL de la photo", "url")}
              </div>
            </div>
          </article>

          <article className="admin-card club-identity__section">
            <header>
              <Palette aria-hidden="true" />
              <div>
                <h2>Palette du club</h2>
                <p>Quatre couleurs structurent automatiquement toute l’interface.</p>
              </div>
            </header>
            <div className="club-identity__palette">
              {colorField(
                "primaryColor",
                "Couleur principale",
                "En-tête, pied de page et grands titres.",
              )}
              {colorField(
                "secondaryColor",
                "Couleur secondaire",
                "Liens, boutons secondaires et repères.",
              )}
              {colorField(
                "accentColor",
                "Couleur d’accent",
                "Actions principales et informations fortes.",
              )}
              {colorField(
                "neutralColor",
                "Couleur neutre",
                "Textes secondaires, bordures et fonds légers.",
              )}
            </div>
          </article>

          <article className="admin-card club-identity__section">
            <header>
              <h2>Coordonnées administratives</h2>
              <p>Ces données ne sont pas exposées par la projection publique.</p>
            </header>
            <div className="club-form">
              {textField("affiliationNumber", "Numéro d’affiliation")}
              {textField("email", "E-mail", "email")}
              {textField("phone", "Téléphone", "tel")}
              {textField("website", "Site internet", "url")}
              <label className="club-form__wide">
                Adresse
                <textarea
                  value={club.address}
                  onChange={(event) => updateText("address", event.target.value)}
                />
              </label>
              {textField("socialLinks", "Réseaux sociaux")}
              <label className="club-form__wide">
                Informations diverses
                <textarea
                  value={club.notes}
                  onChange={(event) => updateText("notes", event.target.value)}
                />
              </label>
            </div>
          </article>
        </div>

        <aside className="club-identity__preview-column">
          <div className="club-identity__preview-sticky">
            <p>Aperçu de l’accueil</p>
            <article className="club-identity__site-preview" style={previewStyle}>
              <div className="club-identity__preview-header">
                {logoPreview && <img src={logoPreview} alt="" />}
                <strong>Pelote Manager</strong>
              </div>
              <div className="club-identity__preview-hero">
                <span>{club.name}</span>
                <h2>Pelote Manager</h2>
                <p>
                  {club.foundedYear ? `Depuis ${club.foundedYear} — ` : ""}
                  {club.tagline}
                </p>
                <div>
                  <b>Réserver un créneau</b>
                  <b>Accéder à mon compte</b>
                </div>
              </div>
              <div className="club-identity__preview-strip">
                <span>Réservations</span>
                <span>Évènements</span>
                <span>Communauté</span>
              </div>
            </article>

            <button
              className="club-identity__save"
              type="submit"
              disabled={isSaving}
            >
              <Save aria-hidden="true" />
              {isSaving
                ? "Enregistrement et application…"
                : "Enregistrer et appliquer au site"}
            </button>
            <span className="club-identity__status" role="status">
              {status}
            </span>
          </div>
        </aside>
      </form>
    </section>
  );
}
