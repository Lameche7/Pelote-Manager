import { useEffect, useState } from "react";
import { clubAdminService, type Club } from "../services/clubAdminService";
import "./ClubPages.css";

export function ClubInformationPage() {
  const [club, setClub] = useState<Club | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    clubAdminService
      .getClub()
      .then(setClub)
      .catch(() =>
        setStatus("Impossible de charger les informations du club."),
      );
  }, []);
  if (!club)
    return (
      <section className="admin-page">
        <p>{status || "Chargement…"}</p>
      </section>
    );
  const field = (key: keyof Club, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={club[key]}
        onChange={(e) => setClub({ ...club, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>Informations générales</h1>
        <p className="admin-page__lead">
          Ces informations constituent l’identité du club sur la plateforme.
        </p>
      </header>
      <form
        className="admin-card club-form"
        onSubmit={(e) => {
          e.preventDefault();
          setStatus("");
          clubAdminService
            .updateClub(club)
            .then(() => setStatus("Informations enregistrées."))
            .catch(() => setStatus("Enregistrement impossible."));
        }}
      >
        {field("name", "Nom du club")}
        {field("affiliationNumber", "Numéro d’affiliation")}
        {field("email", "E-mail", "email")}
        {field("phone", "Téléphone", "tel")}
        {field("website", "Site internet", "url")}
        {field("logoUrl", "URL du logo", "url")}
        <label className="club-form__wide">
          Adresse
          <textarea
            value={club.address}
            onChange={(e) => setClub({ ...club, address: e.target.value })}
          />
        </label>
        {field("socialLinks", "Réseaux sociaux")}
        <label className="club-form__wide">
          Informations diverses
          <textarea
            value={club.notes}
            onChange={(e) => setClub({ ...club, notes: e.target.value })}
          />
        </label>
        <div className="club-form__actions">
          <button type="submit">Enregistrer</button>
          <span role="status">{status}</span>
        </div>
      </form>
    </section>
  );
}
