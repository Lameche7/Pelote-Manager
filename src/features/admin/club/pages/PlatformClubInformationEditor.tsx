import { useEffect, useState } from "react";
import { clubAdminService, type Club } from "../services/clubAdminService";

/**
 * Scoped information editor. Mount only after server-side lease issuance has
 * been confirmed by the caller. The RPC independently checks the lease on
 * every read and write; the selected club id never grants access by itself.
 *
 * Deliberately excludes image uploads, media management, publishing and all
 * other legacy administration modules.
 */
export function PlatformClubInformationEditor({
  clubId,
}: {
  clubId: string;
}) {
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setClub(null);
    setError("");
    setLoading(true);
    clubAdminService
      .getClubForPlatformLease(clubId)
      .then((result) => {
        if (active) setClub(result);
      })
      .catch(() => {
        if (active) setError("Accès au club refusé ou autorisation expirée.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clubId]);

  if (loading) return <p role="status">Vérification de l’autorisation…</p>;
  if (!club) return <p role="alert">{error || "Club indisponible."}</p>;

  const fields: Array<{ key: keyof Club; label: string; type?: string }> = [
    { key: "name", label: "Nom du club" },
    { key: "affiliationNumber", label: "Numéro d’affiliation" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "phone", label: "Téléphone", type: "tel" },
    { key: "website", label: "Site internet", type: "url" },
    { key: "socialLinks", label: "Réseaux sociaux" },
    { key: "address", label: "Adresse" },
    { key: "notes", label: "Informations diverses" },
    { key: "primaryColor", label: "Couleur principale" },
    { key: "secondaryColor", label: "Couleur secondaire" },
    { key: "accentColor", label: "Couleur d’accent" },
    { key: "neutralColor", label: "Couleur neutre" },
  ];
  const update = (key: keyof Club, value: string) => {
    setClub((previous) => {
      if (!previous || previous.id !== clubId) return previous;
      return { ...previous, [key]: value };
    });
  };

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <h1>Informations du club sélectionné</h1>
        <p className="admin-page__lead">
          Modification temporaire et limitée aux coordonnées et aux couleurs.
          Les logos, photos et autres paramètres restent protégés.
        </p>
      </header>
      <form
        className="admin-card club-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || !club || club.id !== clubId) return;
          setSaving(true);
          setError("");
          try {
            await clubAdminService.updateClubForPlatformLease(club);
            const refreshed = await clubAdminService.getClubForPlatformLease(
              clubId,
            );
            setClub(refreshed);
          } catch {
            setClub(null);
            setError(
              "Modification refusée ou autorisation expirée. Rechargez l’accès.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {fields.map(({ key, label, type }) => (
          <label key={key}>
            {label}
            <input
              type={type ?? "text"}
              value={String(club[key])}
              disabled={saving}
              onChange={(event) => update(key, event.target.value)}
              pattern={key.endsWith("Color") ? "#[0-9a-fA-F]{6}" : undefined}
            />
          </label>
        ))}
        <button type="submit" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
