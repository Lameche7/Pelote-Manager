import { useEffect, useState } from "react";
import { PlatformClubInformationEditor } from "@/features/admin/club/pages/PlatformClubInformationEditor";
import { platformSupabase } from "@/infrastructure/platform/platformClient";
import { platformAdminLeaseService } from "../services/platformAdminLeaseService";

type BusinessClub = { id: string; name: string; slug: string };

export function PlatformBusinessClubAccessPanel() {
  const [clubs, setClubs] = useState<BusinessClub[]>([]);
  const [clubId, setClubId] = useState("");
  const [authorizedClubId, setAuthorizedClubId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const client = platformSupabase;
        if (!client) throw new Error("Plateforme indisponible.");
        const { data, error: catalogueError } = await client.functions.invoke(
          "platform-business-clubs",
          { method: "GET" },
        );
        if (catalogueError || !Array.isArray(data?.clubs)) {
          throw new Error("Catalogue métier indisponible.");
        }
        if (!active) return;
        setClubs(
          data.clubs.filter(
            (club: BusinessClub) =>
              typeof club.id === "string" &&
              /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(club.id) &&
              typeof club.name === "string" &&
              typeof club.slug === "string",
          ),
        );
      } catch {
        if (active) setError("Impossible de vérifier les clubs métier.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      void platformAdminLeaseService.revoke().catch(() => undefined);
    };
  }, []);

  const revoke = async () => {
    setAuthorizedClubId("");
    setBusy(true);
    try {
      await platformAdminLeaseService.revoke();
    } catch {
      setError("Révocation non confirmée. Accès local fermé.");
    } finally {
      setBusy(false);
    }
  };

  const authorize = async () => {
    if (!clubs.some((club) => club.id === clubId)) return;
    setBusy(true);
    setAuthorizedClubId("");
    setError("");
    try {
      // A lease is scoped to the verified business user, not the visual URL.
      // Every subsequent read/write is independently checked by business SQL.
      const lease = await platformAdminLeaseService.issue();
      if (!lease.enabled) throw new Error("Autorisation refusée.");
      setAuthorizedClubId(clubId);
    } catch {
      setError("Accès métier refusé ou fonctionnalité non activée.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="platform-card"
      aria-label="Accès sécurisé aux clubs métier"
    >
      <h2>Administration métier sécurisée</h2>
      <p>
        Sélection indépendante du registre commercial. Une autorisation
        temporaire vérifiée côté serveur est obligatoire.
      </p>
      {loading ? (
        <p role="status">Chargement des clubs métier…</p>
      ) : (
        <>
          <label className="platform-form">
            Club métier
            <select
              value={clubId}
              disabled={busy || Boolean(authorizedClubId)}
              onChange={(event) => setClubId(event.target.value)}
            >
              <option value="">Choisir un club</option>
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          {authorizedClubId ? (
            <button type="button" disabled={busy} onClick={() => void revoke()}>
              Fermer l'accès métier
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !clubs.some((club) => club.id === clubId)}
              onClick={() => void authorize()}
            >
              Vérifier et ouvrir la fiche
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {authorizedClubId && (
            <PlatformClubInformationEditor clubId={authorizedClubId} />
          )}
        </>
      )}
    </section>
  );
}
