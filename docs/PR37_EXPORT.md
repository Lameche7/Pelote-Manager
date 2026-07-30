# Export intégral de la PR 37

> Base : `b1e57af` — export généré depuis `4cfb3c2`.

Ce document contient le contenu intégral de chaque fichier ajouté ou modifié par la PR 37, dans son état courant.

## Manifeste

- `docs/EVENT_ENGINE.md` — Ajouté
- `src/app/router.tsx` — Modifié
- `src/features/admin/events/domain/eventDateTime.ts` — Ajouté
- `src/features/admin/events/domain/eventFormSubmission.ts` — Ajouté
- `src/features/admin/events/pages/AdminEventsPage.css` — Ajouté
- `src/features/admin/events/pages/AdminEventsPage.tsx` — Ajouté
- `src/features/admin/services/eventAdminService.ts` — Ajouté
- `supabase/migrations/20260730000600_add_event_engine.sql` — Ajouté
- `supabase/tests/event_engine.sql` — Ajouté
- `tests/eventDateTime.test.mjs` — Ajouté
- `tests/eventEngine.test.mjs` — Ajouté
- `tsconfig.test.json` — Modifié

---

## `docs/EVENT_ENGINE.md`

````markdown
# Event Engine

Le moteur d'évènements est la source générique des occupations planifiées du club. Un évènement possède un type administrable, une période, une visibilité, un état de publication et une relation normalisée vers un ou plusieurs terrains. Sélectionner « tous les terrains » signifie créer une relation vers chaque terrain actif : aucune donnée métier n'est dupliquée dans `events`.

## Intégration au calendrier

Un évènement publié et bloquant projette automatiquement une occupation `club_event` par terrain dans `calendar_occupations`. Le moteur de disponibilité existant n'a donc aucune connaissance des tournois ou des autres types : il détecte simplement une occupation en conflit. Un brouillon, un évènement informatif ou archivé ne bloque pas les réservations.

Seul un évènement public projette son nom. Les visibilités `members` et `private` projettent toujours le libellé neutre « Indisponible », car le calendrier d'occupation est lisible publiquement. Les anciennes commandes de blocages manuels acceptent exclusivement les occupations `closure` et ne peuvent donc ni modifier ni annuler une projection `club_event`.

`event_resources.calendar_occupation_id` relie chaque projection à sa source et permet une synchronisation atomique lors d'une modification, d'un archivage ou d'une suppression.

## Extensions prévues

`event_documents` réserve le modèle documentaire sans implémenter le stockage. Les champs de capacité et d'inscription préparent la participation. Les notifications, la communication, l'affichage TV, les statistiques et les enrichissements propres aux tournois devront référencer `events.id` plutôt que créer un calendrier parallèle.

Toutes les opérations d'administration sont isolées par `club_id` et protégées par `events.manage`.

Les horaires sont stockés en `timestamptz`. Le formulaire convertit explicitement entre cette valeur et l'heure murale `Europe/Paris` attendue par `datetime-local`, y compris lors des changements d'heure. Un responsable optionnel est un profil lié à un membre actif du club de l'évènement ; cette règle est contrôlée par la RPC, pas seulement par le sélecteur de l'interface.
````

## `src/app/router.tsx`

````tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { AdminPage } from "@/features/admin/pages/AdminPage";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { ClubInformationPage } from "@/features/admin/club/pages/ClubInformationPage";
import { ClubPricingPage, ClubSeasonsPage } from "@/features/admin/club/pages/ClubCollectionsPage";
import { ClubHoursPage } from "@/features/admin/club/pages/ClubHoursPage";
import { ClubClosuresPage } from "@/features/admin/club/pages/ClubClosuresPage";
import { AdminComingSoonPage } from "@/features/admin/pages/AdminComingSoonPage";
import { PermissionRoute } from "@/features/admin/access/PermissionRoute";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@/features/admin/config/adminPermissions";
import { AdminPaymentsPage } from "@/features/admin/pages/AdminPaymentsPage";
import { AdminReservationOperationsPage } from "@/features/admin/pages/AdminReservationOperationsPage";
import { AdminReservationsPage } from "@/features/admin/pages/AdminReservationsPage";
import { AdminReservationsManagementPage } from "@/features/admin/reservations/pages/AdminReservationsManagementPage";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";
import { AdminEventsPage } from "@/features/admin/events/pages/AdminEventsPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";
import { HomePage } from "@/features/home/pages/HomePage";
import { UserSpaceDashboardPage } from "@/features/user-space/dashboard/pages/UserSpaceDashboardPage";
import { MyProfilePage } from "@/features/user-space/profile/pages/MyProfilePage";
import { MyReservationsPage } from "@/features/reservations/pages/MyReservationsPage";
import { PaymentReturnPage } from "@/features/reservations/pages/PaymentReturnPage";
import { ReservationsPage } from "@/features/reservations/pages/ReservationsPage";
import { ROUTES, USER_ROLES } from "@/shared/config";
import { Forbidden } from "@/shared/pages/Forbidden";
import { NotFound } from "@/shared/pages/NotFound";

const permitted = (permission: AdminPermission, page: React.ReactNode) => (
  <PermissionRoute permission={permission}>{page}</PermissionRoute>
);

export const routes = [
  {
    path: ROUTES.home,
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: ROUTES.login, element: <LoginPage /> },
      { path: ROUTES.register, element: <RegisterPage /> },
      { path: ROUTES.reservations, element: <ReservationsPage /> },
      {
        path: ROUTES.userSpace,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.visitor, USER_ROLES.user, USER_ROLES.member, USER_ROLES.admin]}>
            <UserSpaceDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.myProfile,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.visitor, USER_ROLES.user, USER_ROLES.member, USER_ROLES.admin]}>
            <MyProfilePage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.myReservations,
        element: (
          <ProtectedRoute
            allowedRoles={[
              USER_ROLES.visitor,
              USER_ROLES.user,
              USER_ROLES.member,
              USER_ROLES.admin,
            ]}
          >
            <MyReservationsPage />
          </ProtectedRoute>
        ),
      },
      { path: ROUTES.reservationPaymentReturn, element: <PaymentReturnPage /> },
      { path: ROUTES.forbidden, element: <Forbidden /> },
      {
        path: ROUTES.admin,
        element: (
          <ProtectedRoute>
            <AdminShell />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: permitted(ADMIN_PERMISSIONS.dashboard, <AdminPage />) },
          { path: "club/informations", element: permitted(ADMIN_PERMISSIONS.club, <ClubInformationPage />) },
          { path: "club/horaires", element: permitted(ADMIN_PERMISSIONS.reservations, <ClubHoursPage />) },
          { path: "club/fermetures", element: permitted(ADMIN_PERMISSIONS.reservations, <ClubClosuresPage />) },
          { path: "club/saisons", element: permitted(ADMIN_PERMISSIONS.club, <ClubSeasonsPage />) },
          { path: "club/tarifs", element: permitted(ADMIN_PERMISSIONS.pricing, <ClubPricingPage />) },
          { path: "reservations", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationsManagementPage />) },
          { path: "reservations/parametres", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationsPage />) },
          { path: "reservations/suivi", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationOperationsPage />) },
          { path: "utilisateurs", element: permitted(ADMIN_PERMISSIONS.settings, <AdminUsersPage />) },
          { path: "paiements", element: permitted(ADMIN_PERMISSIONS.paymentsRead, <AdminPaymentsPage />) },
          { path: "membres", element: permitted(ADMIN_PERMISSIONS.members, <AdminComingSoonPage title="Membres" />) },
          { path: "evenements", element: permitted(ADMIN_PERMISSIONS.events, <AdminEventsPage />) },
          { path: "tournois", element: permitted(ADMIN_PERMISSIONS.tournaments, <AdminComingSoonPage title="Tournois" />) },
          { path: "communication", element: permitted(ADMIN_PERMISSIONS.communication, <AdminComingSoonPage title="Communication" />) },
          { path: "statistiques", element: permitted(ADMIN_PERMISSIONS.statistics, <AdminComingSoonPage title="Statistiques" />) },
          { path: "parametres", element: permitted(ADMIN_PERMISSIONS.settings, <AdminComingSoonPage title="Paramètres" />) },
        ],
      },
      { path: ROUTES.notFound, element: <NotFound /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
````

## `src/features/admin/events/domain/eventDateTime.ts`

````typescript
const CLUB_TIME_ZONE = "Europe/Paris";

const formatter = new Intl.DateTimeFormat("fr-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsAt(date: Date): DateTimeParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as DateTimeParts;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Converts a stored timestamptz value to a wall-clock value for datetime-local. */
export function storedDateTimeToLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Date d’évènement invalide.");
  const parts = partsAt(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Converts a Europe/Paris datetime-local wall clock to an ISO timestamptz value. */
export function localInputToStoredDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Date et heure incomplètes.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockUtc;
  // Two passes account for the offset change when the first estimate crosses DST.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = partsAt(new Date(instant));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }
  const result = new Date(instant);
  const roundTrip = storedDateTimeToLocalInput(result.toISOString());
  if (roundTrip !== value) {
    throw new Error("Cette heure locale n’existe pas en Europe/Paris.");
  }
  return result.toISOString();
}
````

## `src/features/admin/events/domain/eventFormSubmission.ts`

````typescript
import { localInputToStoredDateTime } from "./eventDateTime.js";

export type EventSaveResult = { ok: true } | { ok: false; message: string };

export async function submitEventDraft<
  T extends { startsAt: string; endsAt: string },
>(draft: T, save: (value: T) => Promise<unknown>): Promise<EventSaveResult> {
  try {
    await save({
      ...draft,
      startsAt: localInputToStoredDateTime(draft.startsAt),
      endsAt: localInputToStoredDateTime(draft.endsAt),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer l’évènement.",
    };
  }
}
````

## `src/features/admin/events/pages/AdminEventsPage.css`

````css
.events-heading,
.events-toolbar,
.events-form header,
.events-form footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.events-primary {
  border: 0;
  border-radius: 0.65rem;
  padding: 0.75rem 1rem;
  color: #fff;
  background: #b22525;
  font-weight: 800;
}
.events-alert {
  padding: 0.8rem 1rem;
  border-radius: 0.7rem;
  background: #dcfce7;
  color: #166534;
}
.events-alert--error {
  background: #fee2e2;
  color: #991b1b;
}
.events-form > .events-alert {
  margin: 1rem 1.25rem 0;
}
.events-toolbar {
  margin-bottom: 1rem;
  justify-content: flex-start;
  flex-wrap: wrap;
}
.events-toolbar label {
  display: grid;
  gap: 0.3rem;
  color: #52606a;
  font-size: 0.78rem;
  font-weight: 800;
}
.events-toolbar input,
.events-toolbar select,
.events-form input,
.events-form select,
.events-form textarea {
  box-sizing: border-box;
  border: 1px solid #ccd5d9;
  border-radius: 0.55rem;
  padding: 0.65rem;
  background: #fff;
  font: inherit;
}
.events-toolbar input {
  width: min(24rem, 70vw);
}
.events-table-wrap {
  overflow-x: auto;
  padding: 0;
}
.events-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}
.events-table-wrap th,
.events-table-wrap td {
  padding: 0.85rem 0.7rem;
  border-bottom: 1px solid #e8edef;
  text-align: left;
  vertical-align: top;
}
.events-table-wrap th {
  color: #56636c;
  background: #f8fafb;
  font-size: 0.72rem;
  text-transform: uppercase;
}
.event-type {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}
.event-type:before {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--event-color);
  content: "";
}
.event-status {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 1rem;
  background: #e5e7eb;
}
.event-status--published {
  color: #166534;
  background: #dcfce7;
}
.event-status--archived {
  color: #475569;
  background: #e2e8f0;
}
.events-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-width: 13rem;
}
.events-actions button {
  border: 0;
  padding: 0;
  color: #2563eb;
  background: none;
  font-size: 0.76rem;
  cursor: pointer;
}
.events-actions .danger {
  color: #b91c1c;
}
.events-empty {
  padding: 2rem;
  text-align: center;
  color: #64748b;
}
.events-modal {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(15 23 42 / 55%);
}
.events-form {
  width: min(54rem, 100%);
  max-height: calc(100vh - 2rem);
  overflow: auto;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 25%);
}
.events-form header,
.events-form footer {
  position: sticky;
  z-index: 1;
  padding: 1rem 1.25rem;
  background: #fff;
}
.events-form header {
  top: 0;
  border-bottom: 1px solid #e5e7eb;
}
.events-form header h2 {
  margin: 0;
  color: #15372e;
}
.events-form header > button {
  border: 0;
  background: none;
  font-size: 1.8rem;
}
.events-form fieldset {
  margin: 1.25rem;
  border: 1px solid #dfe5e8;
  border-radius: 0.8rem;
  padding: 1rem;
}
.events-form legend {
  padding: 0 0.4rem;
  color: #15372e;
  font-weight: 850;
}
.events-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.events-grid > label {
  display: grid;
  gap: 0.35rem;
  color: #52606a;
  font-size: 0.8rem;
  font-weight: 750;
}
.events-grid .wide {
  grid-column: 1/-1;
}
.events-check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.events-resources,
.events-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 0.75rem;
}
.events-future {
  display: flex;
  gap: 0.8rem;
  margin: 1.25rem;
  padding: 1rem;
  border-radius: 0.7rem;
  color: #64748b;
  background: #f1f5f9;
  font-size: 0.82rem;
}
.events-future strong {
  color: #334155;
}
.events-form footer {
  bottom: 0;
  justify-content: flex-end;
  border-top: 1px solid #e5e7eb;
}
.events-form footer button {
  padding: 0.7rem 1rem;
  border-radius: 0.6rem;
  border: 1px solid #ccd5d9;
  font-weight: 750;
}
.events-form footer .events-primary {
  border: 0;
}
.events-checkboxes {
  display: grid;
  margin: 0;
}
.events-form input[type="checkbox"] {
  width: auto;
}
@media (max-width: 48rem) {
  .events-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .events-grid {
    grid-template-columns: 1fr;
  }
  .events-grid .wide {
    grid-column: auto;
  }
  .events-future {
    align-items: flex-start;
    flex-direction: column;
  }
}
````

## `src/features/admin/events/pages/AdminEventsPage.tsx`

````tsx
import { useEffect, useMemo, useState } from "react";
import {
  eventAdminService,
  type AdminEvent,
  type EventDraft,
  type EventResource,
  type EventResponsible,
  type EventType,
} from "@/features/admin/services/eventAdminService";
import { storedDateTimeToLocalInput } from "@/features/admin/events/domain/eventDateTime";
import { submitEventDraft } from "@/features/admin/events/domain/eventFormSubmission";
import "./AdminEventsPage.css";

const blank = (typeId = ""): EventDraft => ({
  name: "",
  eventTypeId: typeId,
  description: "",
  responsibleProfileId: null,
  color: null,
  startsAt: "",
  endsAt: "",
  resourceIds: [],
  isBlocking: false,
  visibility: "private",
  publicationStatus: "draft",
  maximumCapacity: null,
  registrationRequired: false,
});
const statusLabel = {
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
} as const;

export function AdminEventsPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]),
    [types, setTypes] = useState<EventType[]>([]),
    [resources, setResources] = useState<EventResource[]>([]),
    [responsibles, setResponsibles] = useState<EventResponsible[]>([]);
  const [draft, setDraft] = useState<EventDraft | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("start-desc");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => setEvents(await eventAdminService.listEvents());
  useEffect(() => {
    Promise.all([
      eventAdminService.listEvents(),
      eventAdminService.listEventTypes(),
      eventAdminService.listResources(),
      eventAdminService.listResponsibles(),
    ])
      .then(([e, t, r, responsibleList]) => {
        setEvents(e);
        setTypes(t);
        setResources(r);
        setResponsibles(responsibleList);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Chargement impossible."),
      )
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(
    () =>
      events
        .filter(
          (event) =>
            (status === "all" || event.publicationStatus === status) &&
            `${event.name} ${event.typeName} ${event.resourceNames.join(" ")}`
              .toLocaleLowerCase("fr")
              .includes(search.toLocaleLowerCase("fr")),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "fr")
            : (sort === "start-asc" ? 1 : -1) *
              a.startsAt.localeCompare(b.startsAt),
        ),
    [events, search, status, sort],
  );
  const act = async (
    job: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    setSaving(true);
    setError("");
    try {
      await job();
      await load();
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <section className="admin-page">
        <p role="status">Chargement des évènements…</p>
      </section>
    );
  return (
    <section className="admin-page events-page">
      <header className="admin-page__header events-heading">
        <div>
          <p className="admin-page__eyebrow">Administration</p>
          <h1>Évènements</h1>
          <p className="admin-page__lead">
            Planifiez toutes les occupations du club depuis un moteur unique.
          </p>
        </div>
        <button
          className="events-primary"
          onClick={() => setDraft(blank(types.find((t) => t.isActive)?.id))}
        >
          Créer un évènement
        </button>
      </header>
      {error && (
        <p className="events-alert events-alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="events-alert" role="status">
          {message}
        </p>
      )}
      <div className="admin-card events-toolbar">
        <label>
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, type ou terrain"
          />
        </label>
        <label>
          Statut
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tous</option>
            <option value="draft">Brouillon</option>
            <option value="published">Publié</option>
            <option value="archived">Archivé</option>
          </select>
        </label>
        <label>
          Trier
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="start-desc">Plus récents</option>
            <option value="start-asc">Plus anciens</option>
            <option value="name">Nom</option>
          </select>
        </label>
      </div>
      <div className="admin-card events-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Terrain(s)</th>
              <th>Responsable</th>
              <th>Statut</th>
              <th>Publication</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.name}</strong>
                </td>
                <td>
                  <span
                    className="event-type"
                    style={
                      {
                        "--event-color": event.typeColor,
                      } as React.CSSProperties
                    }
                  >
                    {event.typeName}
                  </span>
                </td>
                <td>{new Date(event.startsAt).toLocaleString("fr-FR")}</td>
                <td>{new Date(event.endsAt).toLocaleString("fr-FR")}</td>
                <td>{event.resourceNames.join(", ")}</td>
                <td>{event.responsibleName ?? "—"}</td>
                <td>{event.isBlocking ? "Bloquant" : "Informatif"}</td>
                <td>
                  <span
                    className={`event-status event-status--${event.publicationStatus}`}
                  >
                    {statusLabel[event.publicationStatus]}
                  </span>
                </td>
                <td>
                  <div className="events-actions">
                    <button
                      onClick={() =>
                        eventAdminService
                          .getEvent(event.id)
                          .then((value) =>
                            setDraft({
                              ...value,
                              startsAt: storedDateTimeToLocalInput(
                                value.startsAt,
                              ),
                              endsAt: storedDateTimeToLocalInput(value.endsAt),
                            }),
                          )
                          .catch((e: unknown) =>
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Consultation impossible.",
                            ),
                          )
                      }
                    >
                      Consulter / modifier
                    </button>
                    <button
                      disabled={saving}
                      onClick={() =>
                        void act(
                          () => eventAdminService.duplicateEvent(event.id),
                          "Évènement dupliqué en brouillon.",
                        )
                      }
                    >
                      Dupliquer
                    </button>
                    {event.publicationStatus !== "archived" && (
                      <button
                        disabled={saving}
                        onClick={() =>
                          confirm("Archiver cet évènement ?") &&
                          void act(
                            () => eventAdminService.archiveEvent(event.id),
                            "Évènement archivé.",
                          )
                        }
                      >
                        Archiver
                      </button>
                    )}
                    <button
                      className="danger"
                      disabled={saving}
                      onClick={() =>
                        confirm("Supprimer définitivement cet évènement ?") &&
                        void act(
                          () => eventAdminService.deleteEvent(event.id),
                          "Évènement supprimé.",
                        )
                      }
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="events-empty">
            Aucun évènement ne correspond aux critères.
          </p>
        )}
      </div>
      {draft && (
        <EventForm
          draft={draft}
          types={types}
          resources={resources}
          responsibles={responsibles}
          saving={saving}
          error={error}
          onCancel={() => setDraft(null)}
          onSave={async (value) => {
            setSaving(true);
            setError("");
            const result = await submitEventDraft(
              value,
              eventAdminService.updateEvent.bind(eventAdminService),
            );
            if (result.ok) {
              setMessage(value.id ? "Évènement modifié." : "Évènement créé.");
              setDraft(null);
              try {
                await load();
              } catch (loadError) {
                setError(
                  loadError instanceof Error
                    ? loadError.message
                    : "Actualisation impossible.",
                );
              }
            } else {
              setError(result.message);
            }
            setSaving(false);
          }}
        />
      )}
    </section>
  );
}

function EventForm({
  draft: initial,
  types,
  resources,
  responsibles,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: EventDraft;
  types: EventType[];
  resources: EventResource[];
  responsibles: EventResponsible[];
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (draft: EventDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const update = <K extends keyof EventDraft>(key: K, next: EventDraft[K]) =>
    setValue((v) => ({ ...v, [key]: next }));
  const allSelected = value.resourceIds.length === resources.length;
  return (
    <div
      className="events-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-form-title"
    >
      <form
        className="events-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(value);
        }}
      >
        <header>
          <div>
            <p className="admin-page__eyebrow">Event Engine</p>
            <h2 id="event-form-title">
              {value.id ? "Modifier l’évènement" : "Nouvel évènement"}
            </h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fermer">
            ×
          </button>
        </header>
        {error && (
          <p className="events-alert events-alert--error" role="alert">
            {error}
          </p>
        )}
        <fieldset>
          <legend>Informations générales</legend>
          <div className="events-grid">
            <label>
              Nom
              <input
                required
                value={value.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                required
                value={value.eventTypeId}
                onChange={(e) => update("eventTypeId", e.target.value)}
              >
                {types
                  .filter((t) => t.isActive || t.id === value.eventTypeId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Couleur
              <input
                type="color"
                value={
                  value.color ??
                  types.find((t) => t.id === value.eventTypeId)?.color ??
                  "#2563eb"
                }
                onChange={(e) => update("color", e.target.value)}
              />
            </label>
            <label>
              Responsable
              <select
                value={value.responsibleProfileId ?? ""}
                onChange={(e) =>
                  update("responsibleProfileId", e.target.value || null)
                }
              >
                <option value="">Aucun responsable</option>
                {responsibles.map((responsible) => (
                  <option
                    key={responsible.profileId}
                    value={responsible.profileId}
                  >
                    {responsible.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Début
              <input
                required
                type="datetime-local"
                value={value.startsAt}
                onChange={(e) => update("startsAt", e.target.value)}
              />
            </label>
            <label>
              Fin
              <input
                required
                type="datetime-local"
                value={value.endsAt}
                onChange={(e) => update("endsAt", e.target.value)}
              />
            </label>
            <label className="wide">
              Description
              <textarea
                rows={3}
                value={value.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Terrains</legend>
          <label className="events-check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                update(
                  "resourceIds",
                  e.target.checked ? resources.map((r) => r.id) : [],
                )
              }
            />{" "}
            Tous les terrains
          </label>
          <div className="events-resources">
            {resources.map((r) => (
              <label className="events-check" key={r.id}>
                <input
                  type="checkbox"
                  checked={value.resourceIds.includes(r.id)}
                  onChange={(e) =>
                    update(
                      "resourceIds",
                      e.target.checked
                        ? [...value.resourceIds, r.id]
                        : value.resourceIds.filter((id) => id !== r.id),
                    )
                  }
                />{" "}
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Options et publication</legend>
          <div className="events-grid">
            <label>
              Visibilité
              <select
                value={value.visibility}
                onChange={(e) =>
                  update(
                    "visibility",
                    e.target.value as EventDraft["visibility"],
                  )
                }
              >
                <option value="public">Visible publiquement</option>
                <option value="members">Membres uniquement</option>
                <option value="private">Privé</option>
              </select>
            </label>
            <label>
              Publication
              <select
                value={value.publicationStatus}
                onChange={(e) =>
                  update(
                    "publicationStatus",
                    e.target.value as EventDraft["publicationStatus"],
                  )
                }
              >
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
                <option value="archived">Archivé</option>
              </select>
            </label>
            <label>
              Capacité maximale
              <input
                min="1"
                type="number"
                value={value.maximumCapacity ?? ""}
                onChange={(e) =>
                  update(
                    "maximumCapacity",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
            <span className="events-checkboxes">
              <label className="events-check">
                <input
                  type="checkbox"
                  checked={value.isBlocking}
                  onChange={(e) => update("isBlocking", e.target.checked)}
                />{" "}
                Bloquant pour les réservations
              </label>
              <label className="events-check">
                <input
                  type="checkbox"
                  checked={value.registrationRequired}
                  onChange={(e) =>
                    update("registrationRequired", e.target.checked)
                  }
                />{" "}
                Inscription obligatoire
              </label>
            </span>
          </div>
        </fieldset>
        <aside className="events-future">
          <strong>Préparé pour les prochaines évolutions</strong>
          <span>Documents joints</span>
          <span>Notifications automatiques</span>
        </aside>
        <footer>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button
            className="events-primary"
            disabled={saving || value.resourceIds.length === 0}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </form>
    </div>
  );
}
````

## `src/features/admin/services/eventAdminService.ts`

````typescript
import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type EventStatus = "draft" | "published" | "archived";
export type EventVisibility = "public" | "members" | "private";
export type EventType = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
};
export type EventResource = { id: string; name: string };
export type EventResponsible = { profileId: string; name: string };
export type AdminEvent = {
  id: string;
  name: string;
  typeName: string;
  typeColor: string;
  startsAt: string;
  endsAt: string;
  resourceNames: string[];
  responsibleName: string | null;
  publicationStatus: EventStatus;
  visibility: EventVisibility;
  isBlocking: boolean;
};
export type EventDraft = {
  id?: string;
  name: string;
  eventTypeId: string;
  description: string;
  responsibleProfileId: string | null;
  color: string | null;
  startsAt: string;
  endsAt: string;
  resourceIds: string[];
  isBlocking: boolean;
  visibility: EventVisibility;
  publicationStatus: EventStatus;
  maximumCapacity: number | null;
  registrationRequired: boolean;
};

const fail = (error: unknown, fallback: string) => {
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const eventAdminService = {
  async listEvents(): Promise<AdminEvent[]> {
    const { data, error } = await supabase.rpc("admin_list_events");
    if (error) fail(error, "Impossible de charger les évènements.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      typeName: String(row.type_name),
      typeColor: String(row.type_color),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      resourceNames: row.resource_names as string[],
      responsibleName: row.responsible_name as string | null,
      publicationStatus: row.publication_status as EventStatus,
      visibility: row.visibility as EventVisibility,
      isBlocking: Boolean(row.is_blocking),
    }));
  },
  async listEventTypes(): Promise<EventType[]> {
    const { data, error } = await supabase.rpc("admin_list_event_types");
    if (error) fail(error, "Impossible de charger les types d’évènements.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      icon: row.icon as string | null,
      displayOrder: Number(row.display_order),
      isActive: Boolean(row.is_active),
    }));
  },
  async listResources(): Promise<EventResource[]> {
    const { data, error } = await supabase.rpc("admin_list_event_resources");
    if (error) fail(error, "Impossible de charger les terrains.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));
  },
  async listResponsibles(): Promise<EventResponsible[]> {
    const { data, error } = await supabase.rpc("admin_list_event_responsibles");
    if (error) fail(error, "Impossible de charger les responsables.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      profileId: String(row.profile_id),
      name: String(row.name),
    }));
  },
  async createEventType(
    name: string,
    color: string,
    icon: string | null,
  ): Promise<string> {
    const { data, error } = await supabase.rpc("admin_save_event_type", {
      target_name: name,
      target_color: color,
      target_icon: icon,
    });
    if (error) fail(error, "Impossible de créer le type d’évènement.");
    return String(data);
  },
  async getEvent(id: string): Promise<EventDraft> {
    const { data, error } = await supabase.rpc("admin_get_event", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de charger l’évènement.");
    const row = data as Record<string, unknown> | null;
    if (!row) throw new Error("Évènement introuvable.");
    return {
      id: String(row.id),
      name: String(row.name),
      eventTypeId: String(row.event_type_id),
      description: String(row.description ?? ""),
      responsibleProfileId: row.responsible_profile_id as string | null,
      color: row.color as string | null,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      resourceIds: row.resource_ids as string[],
      isBlocking: Boolean(row.is_blocking),
      visibility: row.visibility as EventVisibility,
      publicationStatus: row.publication_status as EventStatus,
      maximumCapacity:
        row.maximum_capacity === null ? null : Number(row.maximum_capacity),
      registrationRequired: Boolean(row.registration_required),
    };
  },
  async createEvent(event: EventDraft): Promise<string> {
    return this.updateEvent(event);
  },
  async updateEvent(event: EventDraft): Promise<string> {
    const { data, error } = await supabase.rpc("admin_save_event", {
      payload: {
        id: event.id ?? null,
        name: event.name,
        event_type_id: event.eventTypeId,
        description: event.description,
        responsible_profile_id: event.responsibleProfileId,
        color: event.color,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        resource_ids: event.resourceIds,
        is_blocking: event.isBlocking,
        visibility: event.visibility,
        publication_status: event.publicationStatus,
        maximum_capacity: event.maximumCapacity,
        registration_required: event.registrationRequired,
      },
    });
    if (error) fail(error, "Impossible d’enregistrer l’évènement.");
    return String(data);
  },
  async duplicateEvent(id: string): Promise<string> {
    const { data, error } = await supabase.rpc("admin_duplicate_event", {
      target_id: id,
    });
    if (error) fail(error, "Duplication impossible.");
    return String(data);
  },
  async archiveEvent(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_archive_event", {
      target_id: id,
    });
    if (error) fail(error, "Archivage impossible.");
  },
  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_delete_event", {
      target_id: id,
    });
    if (error) fail(error, "Suppression impossible.");
  },
};
````

## `supabase/migrations/20260730000600_add_event_engine.sql`

````sql
-- Generic club event engine. Events are the source of truth; blocking events are
-- projected into the existing calendar occupation engine used by reservations.
create type public.event_publication_status as enum ('draft', 'published', 'archived');
create type public.event_visibility as enum ('public', 'members', 'private');

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  color text not null default '#2563eb' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_type_id uuid not null references public.event_types(id),
  name text not null check (btrim(name) <> ''),
  description text,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_blocking boolean not null default false,
  visibility public.event_visibility not null default 'private',
  publication_status public.event_publication_status not null default 'draft',
  maximum_capacity integer check (maximum_capacity is null or maximum_capacity > 0),
  registration_required boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((publication_status = 'archived') = (archived_at is not null))
);

create table public.event_resources (
  event_id uuid not null references public.events(id) on delete cascade,
  resource_id uuid not null references public.reservable_resources(id) on delete cascade,
  calendar_occupation_id uuid unique references public.calendar_occupations(id) on delete set null,
  primary key (event_id, resource_id)
);

-- Reserved extension point for document management; storage/upload workflows
-- deliberately remain outside this PR.
create table public.event_documents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  storage_path text not null check (btrim(storage_path) <> ''),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index events_club_period_idx on public.events(club_id, starts_at, ends_at);
create index events_club_status_idx on public.events(club_id, publication_status);
create index event_resources_resource_idx on public.event_resources(resource_id);
create index event_documents_event_idx on public.event_documents(event_id);

insert into public.event_types (club_id, name, color, icon, display_order)
select clubs.id, seed.name, seed.color, seed.icon, seed.ord
from public.clubs
cross join (values
 ('Tournoi','#dc2626','trophy',10), ('Championnat','#ea580c','medal',20),
 ('Stage','#2563eb','graduation-cap',30), ('Entraînement','#7c3aed','activity',40),
 ('Réunion','#0891b2','users',50), ('Animation','#db2777','party-popper',60),
 ('Travaux','#6b7280','hammer',70), ('Maintenance','#475569','wrench',80),
 ('Assemblée Générale','#15803d','landmark',90), ('Formation','#0f766e','book-open',100)
) as seed(name,color,icon,ord);

create function public.sync_event_occupations(target_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare current_event public.events;
begin
  select * into current_event from public.events where id = target_event_id;
  delete from public.calendar_occupations where id in (
    select calendar_occupation_id from public.event_resources
    where event_id = target_event_id and calendar_occupation_id is not null
  );
  update public.event_resources set calendar_occupation_id = null where event_id = target_event_id;
  if current_event.is_blocking and current_event.publication_status = 'published' then
    with occupations as (
      insert into public.calendar_occupations
        (resource_id, occupation_type, title, starts_at, ends_at, created_by, updated_by)
      select resource_id, 'club_event'::public.occupation_type,
             case when current_event.visibility = 'public' then current_event.name else 'Indisponible' end,
             current_event.starts_at,
             current_event.ends_at, current_event.updated_by, current_event.updated_by
      from public.event_resources where event_id = target_event_id
      returning id, resource_id
    )
    update public.event_resources er set calendar_occupation_id = occupations.id
    from occupations where er.event_id = target_event_id and er.resource_id = occupations.resource_id;
  end if;
end; $$;

create function public.admin_list_event_types() returns table
  (id uuid, name text, color text, icon text, display_order integer, is_active boolean)
language sql stable security definer set search_path = '' as $$
 select t.id,t.name,t.color,t.icon,t.display_order,t.is_active from public.event_types t
 where t.club_id=public.admin_current_club_id()
   and public.has_club_permission(t.club_id,'events.manage') order by t.display_order,t.name;
$$;
create function public.admin_list_event_resources() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
 select r.id,r.name from public.reservable_resources r
 where r.club_id=public.admin_current_club_id() and r.is_active
   and public.has_club_permission(r.club_id,'events.manage') order by r.name;
$$;
create function public.admin_list_event_responsibles() returns table (profile_id uuid, name text)
language sql stable security definer set search_path = '' as $$
 select profiles.id,
   coalesce(nullif(btrim(concat_ws(' ',members.first_name,members.last_name)),''),
            nullif(btrim(profiles.display_name),''),profiles.email)
 from public.club_members members
 join public.profiles profiles on profiles.member_id=members.id
 where members.club_id=public.admin_current_club_id() and members.is_active
   and public.has_club_permission(members.club_id,'events.manage')
 order by members.last_name,members.first_name;
$$;
create function public.admin_save_event_type(target_name text,target_color text,target_icon text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare club uuid:=public.admin_current_club_id(); saved uuid; begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if btrim(target_name)='' or target_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid event type' using errcode='22023'; end if;
 insert into public.event_types(club_id,name,color,icon,display_order)
 values(club,btrim(target_name),target_color,nullif(btrim(target_icon),''),(select coalesce(max(display_order),0)+10 from public.event_types where club_id=club))
 returning id into saved; return saved; end; $$;
create function public.admin_list_events() returns table
 (id uuid,name text,type_name text,type_color text,starts_at timestamptz,ends_at timestamptz,
  resource_names text[],responsible_name text,publication_status public.event_publication_status,
  visibility public.event_visibility,is_blocking boolean)
language sql stable security definer set search_path = '' as $$
 select e.id,e.name,t.name,coalesce(e.color,t.color),e.starts_at,e.ends_at,
   array_agg(r.name order by r.name),
   coalesce(nullif(btrim(concat_ws(' ',responsible_member.first_name,responsible_member.last_name)),''),
            nullif(btrim(p.display_name),''),p.email),
   e.publication_status,e.visibility,e.is_blocking
 from public.events e join public.event_types t on t.id=e.event_type_id
 join public.event_resources er on er.event_id=e.id join public.reservable_resources r on r.id=er.resource_id
 left join public.profiles p on p.id=e.responsible_profile_id
 left join public.club_members responsible_member on responsible_member.id=p.member_id
 where e.club_id=public.admin_current_club_id()
   and public.has_club_permission(e.club_id,'events.manage') group by e.id,t.id,p.id,responsible_member.id order by e.starts_at desc;
$$;
create function public.admin_get_event(target_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',e.id,'name',e.name,'event_type_id',e.event_type_id,
 'description',e.description,'responsible_profile_id',e.responsible_profile_id,'color',e.color,
 'starts_at',e.starts_at,'ends_at',e.ends_at,'is_blocking',e.is_blocking,'visibility',e.visibility,
 'publication_status',e.publication_status,'maximum_capacity',e.maximum_capacity,
 'registration_required',e.registration_required,'resource_ids',
 (select jsonb_agg(er.resource_id) from public.event_resources er where er.event_id=e.id))
 from public.events e where e.id=target_id and e.club_id=public.admin_current_club_id()
 and public.has_club_permission(e.club_id,'events.manage');
$$;

create function public.admin_save_event(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare club uuid := public.admin_current_club_id(); saved_id uuid; resource uuid; responsible uuid;
begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if jsonb_array_length(coalesce(payload->'resource_ids','[]'))=0 then raise exception 'Au moins un terrain est requis' using errcode='22023'; end if;
 if not exists(select 1 from public.event_types t where t.id=(payload->>'event_type_id')::uuid and t.club_id=club) then raise exception 'Invalid event type' using errcode='22023'; end if;
 responsible := nullif(payload->>'responsible_profile_id','')::uuid;
 if responsible is not null and not exists(
   select 1 from public.profiles p join public.club_members m on m.id=p.member_id
   where p.id=responsible and m.club_id=club and m.is_active
 ) then raise exception 'Le responsable doit être un membre actif du club' using errcode='22023'; end if;
 saved_id := nullif(payload->>'id','')::uuid;
 if saved_id is null then
  insert into public.events(club_id,event_type_id,name,description,responsible_profile_id,color,starts_at,ends_at,is_blocking,visibility,publication_status,maximum_capacity,registration_required,archived_at,created_by,updated_by)
  values(club,(payload->>'event_type_id')::uuid,btrim(payload->>'name'),nullif(payload->>'description',''),responsible,nullif(payload->>'color',''),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,coalesce((payload->>'is_blocking')::boolean,false),coalesce((payload->>'visibility')::public.event_visibility,'private'),coalesce((payload->>'publication_status')::public.event_publication_status,'draft'),nullif(payload->>'maximum_capacity','')::integer,coalesce((payload->>'registration_required')::boolean,false),case when payload->>'publication_status'='archived' then now() end,auth.uid(),auth.uid()) returning id into saved_id;
 else
  update public.events set event_type_id=(payload->>'event_type_id')::uuid,name=btrim(payload->>'name'),description=nullif(payload->>'description',''),responsible_profile_id=responsible,color=nullif(payload->>'color',''),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,is_blocking=coalesce((payload->>'is_blocking')::boolean,false),visibility=(payload->>'visibility')::public.event_visibility,publication_status=(payload->>'publication_status')::public.event_publication_status,maximum_capacity=nullif(payload->>'maximum_capacity','')::integer,registration_required=coalesce((payload->>'registration_required')::boolean,false),archived_at=case when payload->>'publication_status'='archived' then coalesce(archived_at,now()) end,updated_at=now(),updated_by=auth.uid()
  where id=saved_id and club_id=club;
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  delete from public.calendar_occupations where id in (
   select calendar_occupation_id from public.event_resources where event_id=saved_id and calendar_occupation_id is not null
  );
  delete from public.event_resources where event_id=saved_id;
 end if;
 for resource in select jsonb_array_elements_text(payload->'resource_ids')::uuid loop
  if not exists(select 1 from public.reservable_resources r where r.id=resource and r.club_id=club) then raise exception 'Invalid resource' using errcode='22023'; end if;
  insert into public.event_resources(event_id,resource_id) values(saved_id,resource);
 end loop;
 perform public.sync_event_occupations(saved_id); return saved_id;
end; $$;

create function public.admin_duplicate_event(target_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.events; copy_id uuid; club uuid:=public.admin_current_club_id(); begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into source from public.events where id=target_id and club_id=club;
 insert into public.events(club_id,event_type_id,name,description,responsible_profile_id,color,starts_at,ends_at,is_blocking,visibility,publication_status,maximum_capacity,registration_required,created_by,updated_by)
 values(club,source.event_type_id,source.name||' (copie)',source.description,source.responsible_profile_id,source.color,source.starts_at,source.ends_at,false,source.visibility,'draft',source.maximum_capacity,source.registration_required,auth.uid(),auth.uid()) returning id into copy_id;
 insert into public.event_resources(event_id,resource_id) select copy_id,resource_id from public.event_resources where event_id=target_id;
 return copy_id; end; $$;
create function public.admin_archive_event(target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.has_club_permission(public.admin_current_club_id(),'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.events set publication_status='archived',archived_at=now(),updated_at=now(),updated_by=auth.uid() where id=target_id and club_id=public.admin_current_club_id(); perform public.sync_event_occupations(target_id); end; $$;
create function public.admin_delete_event(target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.has_club_permission(public.admin_current_club_id(),'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.events set is_blocking=false where id=target_id and club_id=public.admin_current_club_id();
 perform public.sync_event_occupations(target_id); delete from public.events where id=target_id and club_id=public.admin_current_club_id(); end; $$;

alter table public.event_types enable row level security; alter table public.events enable row level security;
alter table public.event_resources enable row level security; alter table public.event_documents enable row level security;
create policy event_types_club_read on public.event_types for select to authenticated using (public.has_club_permission(club_id,'events.manage'));
create policy events_public_read on public.events for select to anon,authenticated using (publication_status='published' and visibility='public');
revoke all on function public.sync_event_occupations(uuid) from public;
grant execute on function public.admin_list_event_types(),public.admin_list_event_resources(),public.admin_list_event_responsibles(),public.admin_save_event_type(text,text,text),public.admin_list_events(),public.admin_get_event(uuid),public.admin_save_event(jsonb),public.admin_duplicate_event(uuid),public.admin_archive_event(uuid),public.admin_delete_event(uuid) to authenticated;

-- Manual closure administration must never mutate event-owned occupations.
create or replace function public.admin_list_calendar_blocks()
returns table(id uuid, resource_id uuid, resource_name text, title text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  return query select occupation.id,occupation.resource_id,resource.name,occupation.title,occupation.starts_at,occupation.ends_at
  from public.calendar_occupations occupation join public.reservable_resources resource on resource.id=occupation.resource_id
  where occupation.occupation_type='closure' and occupation.cancelled_at is null and occupation.ends_at>=now()
    and resource.club_id=public.admin_current_club_id()
  order by occupation.starts_at;
end $$;
create or replace function public.admin_update_calendar_block(target_id uuid,target_title text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.calendar_occupations; changed public.calendar_occupations; begin
 if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
 if nullif(btrim(target_title),'') is null then raise exception 'Un motif est obligatoire' using errcode='22023'; end if;
 select occupation.* into previous from public.calendar_occupations occupation
 join public.reservable_resources resource on resource.id=occupation.resource_id
 where occupation.id=target_id and occupation.occupation_type='closure' and occupation.cancelled_at is null
 and resource.club_id=public.admin_current_club_id() for update of occupation;
 if previous.id is null then raise exception 'Blocage manuel introuvable' using errcode='P0002'; end if;
 update public.calendar_occupations set title=btrim(target_title),updated_at=now(),updated_by=actor where id=target_id returning * into changed;
 insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,previous_data,new_data) values(target_id,'updated',actor,to_jsonb(previous),to_jsonb(changed));
end $$;
create or replace function public.admin_create_calendar_block(target_resource_id uuid,target_title text,target_starts_at timestamptz,target_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); created public.calendar_occupations; club uuid:=public.admin_current_club_id(); begin
 if not public.has_club_permission(club,'reservations.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.reservable_resources where id=target_resource_id and club_id=club) then raise exception 'Terrain invalide' using errcode='22023'; end if;
 if nullif(btrim(target_title),'') is null or target_ends_at<=target_starts_at then raise exception 'Blocage invalide' using errcode='22023'; end if;
 insert into public.calendar_occupations(resource_id,occupation_type,title,starts_at,ends_at,created_by,updated_by)
 values(target_resource_id,'closure',btrim(target_title),target_starts_at,target_ends_at,actor,actor) returning * into created;
 insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,new_data) values(created.id,'created',actor,to_jsonb(created)); return created.id;
exception when exclusion_violation then raise exception 'Ce créneau est déjà occupé' using errcode='23P01';
end $$;
create or replace function public.admin_delete_calendar_block(target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.calendar_occupations; changed public.calendar_occupations; begin
 if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
 select occupation.* into previous from public.calendar_occupations occupation
 join public.reservable_resources resource on resource.id=occupation.resource_id
 where occupation.id=target_id and occupation.occupation_type='closure' and occupation.cancelled_at is null
 and resource.club_id=public.admin_current_club_id() for update of occupation;
 if previous.id is null then raise exception 'Blocage manuel introuvable' using errcode='P0002'; end if;
 update public.calendar_occupations set cancelled_at=now(),updated_at=now(),updated_by=actor where id=target_id returning * into changed;
 insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,previous_data,new_data) values(target_id,'cancelled',actor,to_jsonb(previous),to_jsonb(changed));
end $$;

create or replace function public.admin_update_calendar_closure(target_id uuid,target_title text,target_starts_at timestamptz,target_ends_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare target_club_id uuid; begin
 select resources.club_id into target_club_id from public.calendar_occupations occupations
 join public.reservable_resources resources on resources.id=occupations.resource_id
 where occupations.id=target_id and occupations.occupation_type='closure' and occupations.cancelled_at is null;
 if target_club_id is null or not public.has_club_permission(target_club_id,'reservations.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if btrim(target_title)='' or target_ends_at<=target_starts_at then raise exception 'Invalid closure' using errcode='22023'; end if;
 update public.calendar_occupations set title=btrim(target_title),starts_at=target_starts_at,ends_at=target_ends_at,updated_at=now(),updated_by=auth.uid() where id=target_id;
end $$;
````

## `supabase/tests/event_engine.sql`

````sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id,email,aud,role) values
 ('10000000-0000-0000-0000-000000000001','event-admin@example.test','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000002','responsible-a@example.test','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000003','responsible-b@example.test','authenticated','authenticated');
update public.profiles set display_name=case id
 when '10000000-0000-0000-0000-000000000001' then 'Administrateur événements'
 when '10000000-0000-0000-0000-000000000002' then 'Fallback A'
 when '10000000-0000-0000-0000-000000000003' then 'Fallback B' end
where id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003');
update public.profiles set role='admin' where id='10000000-0000-0000-0000-000000000001';
insert into public.clubs(id,name,slug) values
 ('20000000-0000-0000-0000-000000000001','Club test A','club-test-a'),
 ('20000000-0000-0000-0000-000000000002','Club test B','club-test-b');
insert into public.club_roles(id,club_id,key,name) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','administrator','Administrateur');
insert into public.club_role_permissions(role_id,permission_key) values
 ('30000000-0000-0000-0000-000000000001','events.manage'),
 ('30000000-0000-0000-0000-000000000001','reservations.manage');
insert into public.club_memberships(club_id,profile_id,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into public.club_members(id,club_id,licence_number,last_name,first_name,season,is_active) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','EVENT-A','Durand','Alice','2026',true),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','EVENT-B','Martin','Bob','2026',true);
update public.profiles set member_id='40000000-0000-0000-0000-000000000001' where id='10000000-0000-0000-0000-000000000002';
update public.profiles set member_id='40000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000003';
insert into public.reservable_resources(id,club_id,name,timezone,is_active) values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Terrain A','Europe/Paris',true),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Terrain B','Europe/Paris',true);
insert into public.event_types(id,club_id,name,color) values
 ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Stage test','#2563eb'),
 ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Stage autre club','#2563eb');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create temporary table event_test_state(id uuid);
select is((select count(*)::integer from public.admin_list_event_responsibles()),1,'le sélecteur isole les membres actifs du club courant');
select is((select name from public.admin_list_event_responsibles()),'Alice Durand','le sélecteur utilise le nom du registre club_members');
insert into event_test_state select public.admin_save_event(jsonb_build_object(
 'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion confidentielle',
 'starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z',
 'resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),
 'responsible_profile_id','10000000-0000-0000-0000-000000000002',
 'is_blocking',true,'visibility','private','publication_status','published'));

select is((select count(*)::integer from public.events where id=(select id from event_test_state)),1,'crée un évènement');
select is((select responsible_profile_id from public.events where id=(select id from event_test_state)),'10000000-0000-0000-0000-000000000002'::uuid,'conserve le responsable du club');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),1,'publier crée une occupation');
select is((select title from public.calendar_occupations where occupation_type='club_event'),'Indisponible','un évènement privé expose uniquement un titre neutre');
set local role anon;
select is((select title from public.list_calendar_occupations('50000000-0000-0000-0000-000000000001','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z')),'Indisponible','un visiteur anonyme ne récupère pas le titre privé');
reset role;
select throws_ok(format('select public.admin_update_calendar_block(%L,%L)',(select calendar_occupation_id from public.event_resources where event_id=(select id from event_test_state)),'Fuite'), 'P0002','Blocage manuel introuvable','ancienne RPC ne modifie pas un club_event');
select throws_ok(format('select public.admin_delete_calendar_block(%L)',(select calendar_occupation_id from public.event_resources where event_id=(select id from event_test_state))), 'P0002','Blocage manuel introuvable','ancienne RPC n’annule pas un club_event');

select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion membres','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','members','publication_status','published'))$sql$,(select id from event_test_state)),'passe en visibilité membres sans libérer le terrain');
set local role anon;
select is((select title from public.list_calendar_occupations('50000000-0000-0000-0000-000000000001','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z')),'Indisponible','un visiteur anonyme ne récupère pas le titre membres');
reset role;
select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion publique','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','public','publication_status','published'))$sql$,(select id from event_test_state)),'modifie la visibilité');
select is((select title from public.calendar_occupations where occupation_type='club_event'),'Réunion publique','un évènement public expose son titre');
select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion publique','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','public','publication_status','draft'))$sql$,(select id from event_test_state)),'dépublie l’évènement');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),0,'dépublier supprime l’occupation');
select throws_ok($sql$select public.admin_save_event(jsonb_build_object('event_type_id','60000000-0000-0000-0000-000000000001','name','Responsable externe','starts_at','2026-07-16T08:00:00Z','ends_at','2026-07-16T10:00:00Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000003'))$sql$,'22023','Le responsable doit être un membre actif du club','refuse le responsable d’un autre club');
select throws_ok($sql$select public.admin_save_event(jsonb_build_object('event_type_id','60000000-0000-0000-0000-000000000002','name','Type externe','starts_at','2026-07-16T08:00:00Z','ends_at','2026-07-16T10:00:00Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001')))$sql$,'22023','Invalid event type','refuse le type d’un autre club');
select lives_ok(format('select public.admin_archive_event(%L)',(select id from event_test_state)),'archive l’évènement');
select is((select publication_status::text from public.events where id=(select id from event_test_state)),'archived','l’archive reste conservée');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),0,'archiver ne recrée pas d’occupation');
select lives_ok(format('select public.admin_delete_event(%L)',(select id from event_test_state)),'supprime un évènement archivé');
select is((select count(*)::integer from public.events where id=(select id from event_test_state)),0,'la suppression nettoie l’évènement et ses relations');

select * from finish();
rollback;
````

## `tests/eventDateTime.test.mjs`

````javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  localInputToStoredDateTime,
  storedDateTimeToLocalInput,
} from "../.test-dist/src/features/admin/events/domain/eventDateTime.js";
import { submitEventDraft } from "../.test-dist/src/features/admin/events/domain/eventFormSubmission.js";

test("convertit une heure d’été Europe/Paris vers timestamptz sans décalage visuel", () => {
  const stored = localInputToStoredDateTime("2026-07-15T10:00");
  assert.equal(stored, "2026-07-15T08:00:00.000Z");
  assert.equal(storedDateTimeToLocalInput(stored), "2026-07-15T10:00");
});

test("convertit une heure d’hiver Europe/Paris vers timestamptz sans décalage visuel", () => {
  const stored = localInputToStoredDateTime("2026-01-15T10:00");
  assert.equal(stored, "2026-01-15T09:00:00.000Z");
  assert.equal(storedDateTimeToLocalInput(stored), "2026-01-15T10:00");
});

test("ouvrir puis réenregistrer conserve exactement l’instant stocké", () => {
  for (const stored of [
    "2026-07-15T08:00:00.000Z",
    "2026-01-15T09:00:00.000Z",
  ]) {
    assert.equal(
      localInputToStoredDateTime(storedDateTimeToLocalInput(stored)),
      stored,
    );
  }
});

test("une erreur de sauvegarde est renvoyée et laisse le brouillon à l’appelant", async () => {
  const draft = {
    name: "Stage",
    startsAt: "2026-07-15T10:00",
    endsAt: "2026-07-15T12:00",
  };
  const result = await submitEventDraft(draft, async () => {
    throw new Error("Ce créneau est déjà occupé");
  });
  assert.deepEqual(result, {
    ok: false,
    message: "Ce créneau est déjà occupé",
  });
  assert.equal(draft.startsAt, "2026-07-15T10:00");
});
````

## `tests/eventEngine.test.mjs`

````javascript
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260730000600_add_event_engine.sql",
  "utf8",
);
const service = await readFile(
  "src/features/admin/services/eventAdminService.ts",
  "utf8",
);

test("event engine is generic, normalized and club scoped", () => {
  for (const table of [
    "event_types",
    "events",
    "event_resources",
    "event_documents",
  ])
    assert.match(migration, new RegExp(`create table public.${table}`));
  assert.match(migration, /club_id uuid not null/);
  assert.match(migration, /references public\.reservable_resources/);
});

test("blocking published events use the shared occupation calendar", () => {
  assert.match(
    migration,
    /is_blocking and current_event\.publication_status = 'published'/,
  );
  assert.match(migration, /insert into public\.calendar_occupations/);
  assert.match(migration, /'club_event'/);
  assert.match(migration, /then current_event\.name else 'Indisponible'/);
});

test("legacy block RPCs accept manual closures only", () => {
  assert.match(migration, /occupation\.occupation_type='closure'/);
  assert.match(migration, /Blocage manuel introuvable/);
});

test("administration service exposes the complete event lifecycle", () => {
  for (const method of [
    "listEvents",
    "getEvent",
    "createEvent",
    "updateEvent",
    "duplicateEvent",
    "archiveEvent",
    "deleteEvent",
  ])
    assert.match(service, new RegExp(`async ${method}`));
});
````

## `tsconfig.test.json`

````json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "ignoreDeprecations": "6.0",
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "rootDir": ".",
    "outDir": ".test-dist",
    "baseUrl": ".",
    "paths": {
      "@/shared/config": ["src/shared/config/roles.ts"],
      "@/*": ["src/*"]
    }
  },
  "include": [
    "src/app/router/protectedRouteAccess.ts",
    "src/features/admin/utils/adminUsers.ts",
    "src/features/admin/reservations/domain/adminReservations.ts",
    "src/features/admin/events/domain/eventDateTime.ts",
    "src/features/admin/events/domain/eventFormSubmission.ts",
    "src/features/auth/domain/accountProfileFinalization.ts",
    "src/features/members/domain/memberRegistration.ts",
    "supabase/functions/_shared/memberRegistrationCleanup.ts",
    "src/features/reservations/domain/booking.ts",
    "src/features/reservations/domain/calendar.ts",
    "src/features/reservations/domain/reservationBenefits.ts",
    "src/features/user-space/domain/userSpace.ts",
    "src/shared/config/roles.ts",
    "src/shared/types/profile.ts"
  ]
}
````

