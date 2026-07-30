import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  clubAdminService,
  type Price,
  type Season,
} from "../services/clubAdminService";
import "./ClubPages.css";

type Feedback = {
  loading: boolean;
  saving: boolean;
  error: string;
  message: string;
};
const initialFeedback: Feedback = {
  loading: true,
  saving: false,
  error: "",
  message: "",
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Opération impossible.";

export function ClubSeasonsPage() {
  const [items, setItems] = useState<Season[]>([]);
  const [feedback, setFeedback] = useState(initialFeedback);
  async function load() {
    setItems(await clubAdminService.listSeasons());
  }
  useEffect(() => {
    load()
      .catch((e) => setFeedback((f) => ({ ...f, error: messageOf(e) })))
      .finally(() => setFeedback((f) => ({ ...f, loading: false })));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback((f) => ({ ...f, saving: true, error: "", message: "" }));
    try {
      await clubAdminService.createSeason({
        name: String(data.get("name")),
        startsOn: String(data.get("start")),
        endsOn: String(data.get("end")),
        isActive: data.get("active") === "on",
      });
      form.reset();
      await load();
      setFeedback((f) => ({ ...f, message: "Saison ajoutée." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, error: messageOf(e) }));
    } finally {
      setFeedback((f) => ({ ...f, saving: false }));
    }
  }
  async function remove(id: string) {
    if (!confirm("Supprimer cette saison ?")) return;
    setFeedback((f) => ({ ...f, saving: true, error: "", message: "" }));
    try {
      await clubAdminService.deleteSeason(id);
      await load();
      setFeedback((f) => ({ ...f, message: "Saison supprimée." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, error: messageOf(e) }));
    } finally {
      setFeedback((f) => ({ ...f, saving: false }));
    }
  }
  return (
    <Collection
      title="Saisons"
      lead="Structurez les exercices sportifs utilisés demain par les licences, tournois et statistiques."
      feedback={feedback}
    >
      <form className="club-inline" onSubmit={submit}>
        <input name="name" required placeholder="2026–2027" />
        <input name="start" required type="date" />
        <input name="end" required type="date" />
        <label>
          <input name="active" type="checkbox" /> Active
        </label>
        <button disabled={feedback.saving}>Ajouter</button>
      </form>
      <ul className="club-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.startsOn} — {item.endsOn}
                {item.isActive ? " · Active" : ""}
              </small>
            </span>
            <button
              disabled={feedback.saving}
              onClick={() => void remove(item.id)}
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
  const [feedback, setFeedback] = useState(initialFeedback);
  async function load() {
    setItems(await clubAdminService.listPrices());
  }
  useEffect(() => {
    load()
      .catch((e) => setFeedback((f) => ({ ...f, error: messageOf(e) })))
      .finally(() => setFeedback((f) => ({ ...f, loading: false })));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback((f) => ({ ...f, saving: true, error: "", message: "" }));
    try {
      await clubAdminService.createPrice({
        name: String(data.get("name")),
        amountCents: Math.round(Number(data.get("amount")) * 100),
        audience: String(data.get("audience")),
        isActive: true,
      });
      form.reset();
      await load();
      setFeedback((f) => ({ ...f, message: "Tarif ajouté." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, error: messageOf(e) }));
    } finally {
      setFeedback((f) => ({ ...f, saving: false }));
    }
  }
  async function remove(id: string) {
    if (!confirm("Supprimer ce tarif ?")) return;
    setFeedback((f) => ({ ...f, saving: true, error: "", message: "" }));
    try {
      await clubAdminService.deletePrice(id);
      await load();
      setFeedback((f) => ({ ...f, message: "Tarif supprimé." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, error: messageOf(e) }));
    } finally {
      setFeedback((f) => ({ ...f, saving: false }));
    }
  }
  return (
    <Collection
      title="Tarifs"
      lead="Créez plusieurs catégories tarifaires sans figer les futures règles commerciales."
      feedback={feedback}
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
        <button disabled={feedback.saving}>Ajouter</button>
      </form>
      <ul className="club-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {(item.amountCents / 100).toLocaleString("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                })}{" "}
                · {item.audience}
              </small>
            </span>
            <button
              disabled={feedback.saving}
              onClick={() => void remove(item.id)}
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
  feedback,
  children,
}: {
  title: string;
  lead: string;
  feedback: Feedback;
  children: ReactNode;
}) {
  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>{title}</h1>
        <p className="admin-page__lead">{lead}</p>
      </header>
      {feedback.error && (
        <p className="club-alert club-alert--error" role="alert">
          {feedback.error}
        </p>
      )}
      {feedback.message && (
        <p className="club-alert" role="status">
          {feedback.message}
        </p>
      )}
      <div className="admin-card">
        {feedback.loading ? <p role="status">Chargement…</p> : children}
      </div>
    </section>
  );
}
