import { useEffect, useState, type FormEvent } from "react";
import {
  clubAdminService,
  type Price,
  type Season,
} from "../services/clubAdminService";
import "./ClubPages.css";

export function ClubSeasonsPage() {
  const [items, setItems] = useState<Season[]>([]);
  const load = () => clubAdminService.listSeasons().then(setItems);
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    await clubAdminService.createSeason({
      name: String(d.get("name")),
      startsOn: String(d.get("start")),
      endsOn: String(d.get("end")),
      isActive: d.get("active") === "on",
    });
    e.currentTarget.reset();
    await load();
  }
  return (
    <Collection
      title="Saisons"
      lead="Structurez les exercices sportifs utilisés demain par les licences, tournois et statistiques."
    >
      <form className="club-inline" onSubmit={submit}>
        <input name="name" required placeholder="2026–2027" />
        <input name="start" required type="date" />
        <input name="end" required type="date" />
        <label>
          <input name="active" type="checkbox" /> Active
        </label>
        <button>Ajouter</button>
      </form>
      <ul className="club-list">
        {items.map((x) => (
          <li key={x.id}>
            <span>
              <strong>{x.name}</strong>
              <small>
                {x.startsOn} — {x.endsOn}
                {x.isActive ? " · Active" : ""}
              </small>
            </span>
            <button
              onClick={() => clubAdminService.deleteSeason(x.id).then(load)}
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
    </Collection>
  );
}
export function ClubPricingPage() {
  const [items, setItems] = useState<Price[]>([]);
  const load = () => clubAdminService.listPrices().then(setItems);
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    await clubAdminService.createPrice({
      name: String(d.get("name")),
      amountCents: Math.round(Number(d.get("amount")) * 100),
      audience: String(d.get("audience")),
      isActive: true,
    });
    e.currentTarget.reset();
    await load();
  }
  return (
    <Collection
      title="Tarifs"
      lead="Créez plusieurs catégories tarifaires sans figer les futures règles commerciales."
    >
      <form className="club-inline" onSubmit={submit}>
        <input name="name" required placeholder="Tarif licencié" />
        <input
          name="amount"
          required
          type="number"
          min="0"
          step=".01"
          placeholder="Montant (€)"
        />
        <select name="audience">
          <option value="member">Licenciés</option>
          <option value="public">Public</option>
          <option value="all">Tous</option>
        </select>
        <button>Ajouter</button>
      </form>
      <ul className="club-list">
        {items.map((x) => (
          <li key={x.id}>
            <span>
              <strong>{x.name}</strong>
              <small>
                {(x.amountCents / 100).toLocaleString("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                })}{" "}
                · {x.audience}
              </small>
            </span>
            <button
              onClick={() => clubAdminService.deletePrice(x.id).then(load)}
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
    </Collection>
  );
}
function Collection({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>{title}</h1>
        <p className="admin-page__lead">{lead}</p>
      </header>
      <div className="admin-card">{children}</div>
    </section>
  );
}
