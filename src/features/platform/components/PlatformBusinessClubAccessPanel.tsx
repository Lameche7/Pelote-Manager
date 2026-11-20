import { useEffect, useRef, useState } from "react";
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
  const mounted = useRef(true);
  const leaseRequest = useRef(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedClubId = useRef("");

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const client = platformSupabase;
    const authListener = client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        leaseRequest.current += 1;
        if (expiryTimer.current) clearTimeout(expiryTimer.current);
        setAuthorizedClubId("");
        setClubId("");
        setClubs([]);
        setError("Session plateforme fermée. Reconnectez-vous.");
      }
    });
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
      authListener?.data.subscription.unsubscribe();
      mounted.current = false;
      leaseRequest.current += 1;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      void platformAdminLeaseService.revoke().catch(() => undefined);
    };
  }, []);

  const revoke = async () => {
    leaseRequest.current += 1;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
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
    const requestId = ++leaseRequest.current;
    selectedClubId.current = clubId;
    setBusy(true);
    setAuthorizedClubId("");
    setError("");
    try {
      // A lease is scoped to the verified business user, not the visual URL.
      // Every subsequent read/write is independently checked by business SQL.
      const lease = await platformAdminLeaseService.issue();
      if (!lease.enabled) throw new Error("Autorisation refusée.");
      if (
        !mounted.current ||
        requestId !== leaseRequest.current ||
        selectedClubId.current !== clubId
      ) {
        await platformAdminLeaseService.revoke().catch(() => undefined);
        return;
      }
      const remaining = Date.parse(lease.expiresAt ?? "") - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw new Error("Autorisation expirée.");
      }
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        leaseRequest.current += 1;
        setAuthorizedClubId("");
        void platformAdminLeaseService.revoke().catch(() => undefined);
      }, remaining);
      setAuthorizedClubId(clubId);
    } catch {
      if (mounted.current && requestId === leaseRequest.current) {
        setError("Accès métier refusé ou fonctionnalité non activée.");
      }
    } finally {
      if (mounted.current && requestId === leaseRequest.current) {
        setBusy(false);
      }
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
              onChange={(event) => {
                selectedClubId.current = event.target.value;
                setClubId(event.target.value);
              }}
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
