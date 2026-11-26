import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { platformSupabase } from "@/infrastructure/platform/platformClient";
import { supabase } from "@/infrastructure/supabase/client";
import { PlatformTournamentsPage } from "@/features/admin/tournaments/pages/AdminTournamentsPage";
import { PlatformClubInformationEditor } from "@/features/admin/club/pages/PlatformClubInformationEditor";
import { platformAdminLeaseService } from "../services/platformAdminLeaseService";
import {
  FULL_CLUB_MODULES,
  parseClubModules,
  type ClubModules,
} from "@/features/admin/config/clubModules";
import { ROUTES } from "@/shared/config";
import { PlatformScopedDashboard } from "./PlatformScopedDashboard";
import { AdminTournamentAccountsPage } from "@/features/admin/tournaments/pages/AdminTournamentAccountsPage";
import { AdminTournamentTeamsPage } from "@/features/admin/tournaments/pages/AdminTournamentTeamsPage";
import { AdminTournamentResultsPage } from "@/features/admin/tournaments/pages/AdminTournamentResultsPage";
import { AdminTournamentReschedulePage } from "@/features/admin/tournaments/pages/AdminTournamentReschedulePage";

type Club = { id: string; name: string; slug: string };

// One server lease per business identity: serialize lifecycle operations.
let leaseQueue: Promise<void> = Promise.resolve();
function queueLease(operation: () => Promise<void>) {
  leaseQueue = leaseQueue.then(operation, operation).catch(() => undefined);
  return leaseQueue;
}

export function PlatformScopedAdmin({ slug }: { slug: string }) {
  const location = useLocation();
  const [club, setClub] = useState<Club | null>(null);
  const [modules, setModules] = useState<ClubModules | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let issued = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (renewal) clearTimeout(renewal);
      if (expiry) clearTimeout(expiry);
      if (active) {
        setClub(null);
        setModules(null);
        setError("Autorisation expirée ou accès inter-clubs refusé.");
      }
      active = false;
      void queueLease(async () => {
        if (issued) await platformAdminLeaseService.revoke();
      });
    };
    const platform = platformSupabase;
    const listeners = [platform, supabase].map((client) =>
      client?.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") close();
      }),
    );
    const authorize = (selected: Club) =>
      queueLease(async () => {
        if (!active) return;
        try {
          const lease = await platformAdminLeaseService.issue(selected.id);
          issued = true;
          if (!active) return;
          const remaining =
            lease.remainingMs - (performance.now() - lease.receivedAt);
          if (!lease.enabled || remaining <= 0 || !Number.isFinite(remaining))
            throw new Error("Invalid lease");
          if (expiry) clearTimeout(expiry);
          expiry = setTimeout(close, remaining);
          const { data, error } = await supabase.rpc(
            "platform_admin_get_club_modules",
            { target_club_id: selected.id },
          );
          if (error) throw error;
          const profile = parseClubModules(data ?? FULL_CLUB_MODULES);
          if (!profile) throw new Error("Invalid modules");
          if (!active) return;
          setClub(selected);
          setModules(profile);
          renewal = setTimeout(
            () => void authorize(selected),
            Math.max(1_000, remaining - 60_000),
          );
        } catch {
          close();
        }
      });
    void (async () => {
      try {
        if (!platform) throw new Error("Platform unavailable");
        const { data, error } = await platform.functions.invoke(
          "platform-business-clubs",
          { method: "GET" },
        );
        if (error || !Array.isArray(data?.clubs))
          throw new Error("Catalogue unavailable");
        const matches = (data.clubs as Club[]).filter(
          (entry) => entry.slug === slug && typeof entry.id === "string",
        );
        if (matches.length !== 1) throw new Error("Unknown club");
        if (active) await authorize(matches[0]);
      } catch {
        close();
      }
    })();
    return () => {
      close();
      listeners.forEach((listener) =>
        listener?.data.subscription.unsubscribe(),
      );
    };
  }, [slug]);

  if (error)
    return (
      <section className="simple-page" role="alert">
        <h1>Administration inter-clubs</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </section>
    );
  if (!club || club.slug !== slug || !modules)
    return <p role="status">Vérification de votre accès Super Admin…</p>;

  const links = [
    { to: ROUTES.admin, label: "Tableau de bord" },
    { to: ROUTES.adminClubInformation, label: "Informations du club" },
    ...(modules.tournaments
      ? [
          { to: ROUTES.adminTournaments, label: "Tournois" },
          { to: ROUTES.adminTournamentTeams, label: "Équipes & inscriptions" },
          { to: ROUTES.adminTournamentAccounts, label: "Comptes joueurs" },
          { to: ROUTES.adminTournamentReschedules, label: "Reports" },
          { to: ROUTES.adminTournamentResults, label: "Résultats" },
        ]
      : []),
  ];
  const path = location.pathname;
  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <header>
          <span>Back Office · Super Admin</span>
          <strong>Administration</strong>
          <small>{club.name}</small>
        </header>
        <nav aria-label="Navigation de l’administration">
          {links.map((link) => (
            <NavLink
              key={link.to}
              end
              className="admin-shell__link"
              to={`${link.to}?club=${encodeURIComponent(slug)}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="admin-shell__content">
        {path === ROUTES.admin ? (
          <PlatformScopedDashboard
            key={club.id}
            clubId={club.id}
            clubName={club.name}
            modules={modules}
          />
        ) : path === ROUTES.adminTournamentAccounts && modules.tournaments ? (
          <AdminTournamentAccountsPage key={club.id} scopedClubId={club.id} />
        ) : path === ROUTES.adminTournamentTeams && modules.tournaments ? (
          <AdminTournamentTeamsPage key={club.id} scopedClubId={club.id} />
        ) : path === ROUTES.adminTournamentReschedules &&
          modules.tournaments ? (
          <AdminTournamentReschedulePage key={club.id} scopedClubId={club.id} />
        ) : path === ROUTES.adminTournamentResults && modules.tournaments ? (
          <AdminTournamentResultsPage key={club.id} scopedClubId={club.id} />
        ) : path === ROUTES.adminTournaments && modules.tournaments ? (
          <PlatformTournamentsPage clubId={club.id} />
        ) : path === ROUTES.adminClubInformation ? (
          <PlatformClubInformationEditor clubId={club.id} />
        ) : (
          <section className="simple-page">
            <h1>Administration de {club.name}</h1>
            <p>
              Accès Super Administrateur vérifié. Les écrans non encore isolés
              restent indisponibles dans cet espace.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
