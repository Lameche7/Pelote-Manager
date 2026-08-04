import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  clubAdminService,
  type ReservationPrices,
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

function centsToEuros(value: number) {
  return (value / 100).toFixed(2).replace(".", ",");
}

function eurosToCents(value: string) {
  const amount = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Saisissez des montants valides et positifs.");
  }
  return Math.round(amount * 100);
}

export function ClubSeasonsPage() {
  const [items, setItems] = useState<Season[]>([]);
  const [feedback, setFeedback] = useState(initialFeedback);
  async function load() {
    setItems(await clubAdminService.listSeasons());
  }
  useEffect(() => {
    load()
      .catch((error) =>
        setFeedback((feedbackValue) => ({
          ...feedbackValue,
          error: messageOf(error),
        })),
      )
      .finally(() =>
        setFeedback((feedbackValue) => ({
          ...feedbackValue,
          loading: false,
        })),
      );
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback((feedbackValue) => ({
      ...feedbackValue,
      saving: true,
      error: "",
      message: "",
    }));
    try {
      await clubAdminService.createSeason({
        name: String(data.get("name")),
        startsOn: String(data.get("start")),
        endsOn: String(data.get("end")),
        isActive: data.get("active") === "on",
      });
      form.reset();
      await load();
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        message: "Saison ajoutée.",
      }));
    } catch (error) {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        error: messageOf(error),
      }));
    } finally {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        saving: false,
      }));
    }
  }
  async function remove(id: string) {
    if (!confirm("Supprimer cette saison ?")) return;
    setFeedback((feedbackValue) => ({
      ...feedbackValue,
      saving: true,
      error: "",
      message: "",
    }));
    try {
      await clubAdminService.deleteSeason(id);
      await load();
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        message: "Saison supprimée.",
      }));
    } catch (error) {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        error: messageOf(error),
      }));
    } finally {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        saving: false,
      }));
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
  const [form, setForm] = useState({ licensee: "", public: "" });
  const [feedback, setFeedback] = useState(initialFeedback);

  async function load() {
    const prices = await clubAdminService.getReservationPrices();
    setForm({
      licensee: centsToEuros(prices.licenseePriceCents),
      public: centsToEuros(prices.publicPriceCents),
    });
  }

  useEffect(() => {
    load()
      .catch((error) =>
        setFeedback((feedbackValue) => ({
          ...feedbackValue,
          error: messageOf(error),
        })),
      )
      .finally(() =>
        setFeedback((feedbackValue) => ({
          ...feedbackValue,
          loading: false,
        })),
      );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback((feedbackValue) => ({
      ...feedbackValue,
      saving: true,
      error: "",
      message: "",
    }));

    try {
      const prices: ReservationPrices = {
        licenseePriceCents: eurosToCents(form.licensee),
        publicPriceCents: eurosToCents(form.public),
      };
      await clubAdminService.updateReservationPrices(prices);
      await load();
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        message: "Les tarifs de réservation ont été enregistrés.",
      }));
    } catch (error) {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        error: messageOf(error),
      }));
    } finally {
      setFeedback((feedbackValue) => ({
        ...feedbackValue,
        saving: false,
      }));
    }
  }

  return (
    <Collection
      title="Tarifs"
      lead="Définissez les montants réellement affichés et appliqués lors d’une réservation."
      feedback={feedback}
    >
      <form className="club-stack" onSubmit={submit}>
        <div className="club-inline">
          <label>
            Tarif licencié actif (€)
            <input
              inputMode="decimal"
              required
              value={form.licensee}
              onChange={(event) =>
                setForm({ ...form, licensee: event.target.value })
              }
            />
          </label>
          <label>
            Tarif visiteur ou compte non licencié (€)
            <input
              inputMode="decimal"
              required
              value={form.public}
              onChange={(event) =>
                setForm({ ...form, public: event.target.value })
              }
            />
          </label>
          <button disabled={feedback.saving}>
            {feedback.saving ? "Enregistrement…" : "Enregistrer les tarifs"}
          </button>
        </div>
        <p>
          Le tarif licencié est réservé aux comptes reliés à une licence active
          et validée. Le montant public s’applique aux visiteurs et aux comptes
          non licenciés.
        </p>
        <small>
          Toute nouvelle réservation conserve le montant calculé au moment de sa
          création. Une modification ultérieure ne change pas les réservations
          déjà enregistrées.
        </small>
      </form>
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
