import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, ShieldCheck, UsersRound } from "lucide-react";
import {
  championshipReservationService,
  type ChampionshipReservationSettings,
  type ChampionshipReservationWindow,
} from "@/features/admin/championships/services/championshipReservationService";
import "./AdminChampionshipReservationsPage.css";

const WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
] as const;

const DEFAULT_WINDOWS: ChampionshipReservationWindow[] = [
  { weekday: 5, opensAt: "17:30", closesAt: "21:30" },
  { weekday: 6, opensAt: "09:00", closesAt: "18:00" },
  { weekday: 7, opensAt: "09:00", closesAt: "18:00" },
];

export function AdminChampionshipReservationsPage() {
  const [settings, setSettings] =
    useState<ChampionshipReservationSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [advanceDays, setAdvanceDays] = useState(90);
  const [maxActiveReservations, setMaxActiveReservations] = useState(20);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [windows, setWindows] =
    useState<ChampionshipReservationWindow[]>(DEFAULT_WINDOWS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await championshipReservationService.getSettings();
      setSettings(next);
      setEnabled(next.enabled);
      setAdvanceDays(next.advanceDays);
      setMaxActiveReservations(next.maxActiveReservations);
      setResourceIds(
        next.resources
          .filter((resource) => resource.selected)
          .map((resource) => resource.id),
      );
      setWindows(next.windows.length > 0 ? next.windows : DEFAULT_WINDOWS);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible de charger les paramètres championnat.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const windowByDay = useMemo(
    () => new Map(windows.map((window) => [window.weekday, window])),
    [windows],
  );

  const toggleResource = (resourceId: string, selected: boolean) => {
    setResourceIds((current) =>
      selected
        ? Array.from(new Set([...current, resourceId]))
        : current.filter((id) => id !== resourceId),
    );
  };

  const toggleDay = (weekday: number, selected: boolean) => {
    setWindows((current) => {
      if (!selected)
        return current.filter((window) => window.weekday !== weekday);
      if (current.some((window) => window.weekday === weekday)) return current;
      return [
        ...current,
        { weekday, opensAt: "09:00", closesAt: "18:00" },
      ].sort((a, b) => a.weekday - b.weekday);
    });
  };

  const updateWindow = (
    weekday: number,
    field: "opensAt" | "closesAt",
    value: string,
  ) => {
    setWindows((current) =>
      current.map((window) =>
        window.weekday === weekday ? { ...window, [field]: value } : window,
      ),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await championshipReservationService.saveSettings({
        enabled,
        advanceDays,
        maxActiveReservations,
        resourceIds,
        windows,
      });
      setMessage("Règles de réservation championnat enregistrées.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’enregistrer les paramètres.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="championship-reservation-admin">
      <header className="championship-reservation-admin__hero">
        <div>
          <p className="eyebrow">Championnats</p>
          <h1>Réservations championnat</h1>
          <p>
            Accordez aux joueurs réellement engagés en championnat un accès
            anticipé à des plages réservées, sans modifier les règles normales
            du club.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </header>

      {error && (
        <p className="championship-reservation-admin__alert championship-reservation-admin__alert--error">
          {error}
        </p>
      )}
      {message && (
        <p className="championship-reservation-admin__alert" role="status">
          {message}
        </p>
      )}

      {loading || !settings ? (
        <p role="status">Chargement…</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <article className="championship-reservation-admin__panel championship-reservation-admin__summary">
            <UsersRound aria-hidden="true" />
            <div>
              <strong>
                {settings.eligiblePlayerCount} joueur(s) actuellement
                éligible(s)
              </strong>
              <p>
                L’éligibilité vient automatiquement des effectifs des
                championnats en préparation ou actifs et du rattachement du
                compte joueur.
              </p>
            </div>
          </article>

          <article className="championship-reservation-admin__panel">
            <label className="championship-reservation-admin__switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>
                <strong>Activer l’accès anticipé championnat</strong>
                <small>
                  Désactivé, tous les joueurs conservent uniquement les règles
                  de réservation habituelles.
                </small>
              </span>
            </label>

            <div className="championship-reservation-admin__numbers">
              <label>
                Réservable combien de jours à l’avance ?
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={advanceDays}
                  onChange={(event) =>
                    setAdvanceDays(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Maximum de réservations actives
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxActiveReservations}
                  onChange={(event) =>
                    setMaxActiveReservations(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </article>

          <article className="championship-reservation-admin__panel">
            <h2>Terrains concernés</h2>
            <p>
              Les plages championnat peuvent exister même lorsqu’un terrain
              n’est pas ouvert à la réservation publique à ce moment-là.
            </p>
            <div className="championship-reservation-admin__resources">
              {settings.resources.map((resource) => (
                <label key={resource.id}>
                  <input
                    type="checkbox"
                    checked={resourceIds.includes(resource.id)}
                    onChange={(event) =>
                      toggleResource(resource.id, event.target.checked)
                    }
                  />
                  {resource.name}
                </label>
              ))}
            </div>
          </article>

          <article className="championship-reservation-admin__panel">
            <div className="championship-reservation-admin__section-title">
              <div>
                <h2>Plages réservées championnat</h2>
                <p>
                  La proposition initiale reprend vendredi 17h30–21h30 et le
                  week-end. Les horaires restent entièrement modifiables.
                </p>
              </div>
              <CalendarClock aria-hidden="true" />
            </div>

            <div className="championship-reservation-admin__windows">
              {WEEKDAYS.map((day) => {
                const window = windowByDay.get(day.value);
                return (
                  <div
                    key={day.value}
                    className="championship-reservation-admin__window"
                  >
                    <label className="championship-reservation-admin__day">
                      <input
                        type="checkbox"
                        checked={Boolean(window)}
                        onChange={(event) =>
                          toggleDay(day.value, event.target.checked)
                        }
                      />
                      <strong>{day.label}</strong>
                    </label>
                    <input
                      aria-label={`Début ${day.label}`}
                      type="time"
                      value={window?.opensAt ?? "09:00"}
                      disabled={!window}
                      onChange={(event) =>
                        updateWindow(day.value, "opensAt", event.target.value)
                      }
                    />
                    <span>→</span>
                    <input
                      aria-label={`Fin ${day.label}`}
                      type="time"
                      value={window?.closesAt ?? "18:00"}
                      disabled={!window}
                      onChange={(event) =>
                        updateWindow(day.value, "closesAt", event.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </article>

          <footer className="championship-reservation-admin__footer">
            <button disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer les règles"}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
