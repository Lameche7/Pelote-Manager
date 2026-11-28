import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { platformSupabase } from "@/infrastructure/platform/platformClient";
import { ROUTES } from "@/shared/config";
import { supabase } from "@/infrastructure/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { verifyPlatformBusinessIdentity } from "../services/platformBusinessIdentityService";

type Club = { id: string; name: string; slug: string };

function SuperAdminClubSwitcher() {
  const location = useLocation();
  const [clubs, setClubs] = useState<Club[]>([]);
  const selectedSlug = new URLSearchParams(location.search).get("club") || "";
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [error, setError] = useState("");
  const [identityLinked, setIdentityLinked] = useState(false);

  useEffect(() => {
    const client = platformSupabase;
    if (!client) {
      return;
    }
    let active = true;
    const refresh = async () => {
      setIsVerifiedAdmin(false);
      setClubs([]);
      setError("");
      setIdentityLinked(false);
      const { data: identity, error: identityError } =
        await client.auth.getUser();
      if (!active) return;
      if (identityError || !identity.user) {
        return;
      }

      const { data: allowed, error: roleError } =
        await client.rpc("platform_is_admin");
      if (!active) return;
      if (roleError || allowed !== true) {
        return;
      }
      setIsVerifiedAdmin(true);
      const proof = await verifyPlatformBusinessIdentity();
      if (!active) return;
      setIdentityLinked(proof.linked);

      const { data, error: catalogueError } = await client.functions.invoke(
        "platform-business-clubs",
        {
          method: "GET",
        },
      );
      if (!active) return;
      if (catalogueError || !Array.isArray(data?.clubs)) {
        setError("Catalogue des clubs indisponible.");
        return;
      }
      setClubs(
        data.clubs.filter(
          (club: Club) =>
            typeof club.id === "string" &&
            typeof club.name === "string" &&
            typeof club.slug === "string",
        ),
      );
    };

    void refresh();
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED"
      ) {
        // Supabase may emit TOKEN_REFRESHED during catalogue requests.
        // Avoid recursive catalogue calls on token refresh.
        void refresh();
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!isVerifiedAdmin) {
    return null;
  }

  return (
    <div className="app-club-selection">
      <small>
        {identityLinked
          ? "Identité vérifiée · accès sécurisé depuis Administration"
          : "Liaison des deux sessions non vérifiée"}
      </small>
      {identityLinked && clubs.some((club) => club.slug === selectedSlug) && (
        <Link
          to={`${ROUTES.platform}?club=${encodeURIComponent(selectedSlug)}#business-club`}
        >
          Administrer le club sélectionné
        </Link>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

type PublicClub = { name: string; slug: string };

export function PlatformClubSwitcher() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [publicClubs, setPublicClubs] = useState<PublicClub[]>([]);
  const [defaultSlug, setDefaultSlug] = useState("");
  const activeSlug = new URLSearchParams(location.search).get("club") || "";
  const preferenceKey = user ? `pilotoki-selected-club:${user.id}` : null;

  useEffect(() => {
    let active = true;
    setDefaultSlug("");
    const load = async () => {
      const catalogue = await supabase.rpc("list_network_clubs_v3");
      if (!active || catalogue.error || !Array.isArray(catalogue.data)) return;
      const available = catalogue.data.filter(
        (club: PublicClub) =>
          typeof club.name === "string" &&
          typeof club.slug === "string" &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(club.slug),
      ) as PublicClub[];
      setPublicClubs(available);
      if (!user || !isAuthenticated || isLoading) return;
      const remembered = preferenceKey
        ? window.localStorage.getItem(preferenceKey)
        : null;
      if (available.some((club) => club.slug === remembered)) {
        setDefaultSlug(remembered || "");
        return;
      }
      if (remembered && preferenceKey) {
        window.localStorage.removeItem(preferenceKey);
      }
      const [members, admins] = await Promise.all([
        supabase.rpc("list_my_member_clubs"),
        supabase.rpc("get_my_club_access"),
      ]);
      if (!active) return;
      const affiliations = Array.isArray(members.data) ? members.data : [];
      const grants = Array.isArray(admins.data) ? admins.data : [];
      const primaryAffiliation = affiliations.find(
        (member) => member.is_active && member.affiliation_type === "primary",
      );
      const defaultAffiliation = affiliations.find(
        (member) => member.is_active && member.is_default,
      );
      const primary = primaryAffiliation ?? defaultAffiliation;
      const adminClubName = grants.length === 1 ? grants[0].club_name : null;
      const name = primary?.club_name ?? adminClubName;
      const preferred = available.find((club) => club.name === name);
      setDefaultSlug(preferred?.slug || "");
    };
    void load();
    return () => {
      active = false;
    };
  }, [user, isAuthenticated, isLoading, preferenceKey]);

  useEffect(() => {
    if (!isAuthenticated || isLoading || location.pathname !== ROUTES.home) {
      return;
    }
    const next = new URLSearchParams(location.search);
    if (activeSlug) {
      if (!next.has("adminClubId")) return;
    } else {
      if (!defaultSlug) return;
      next.set("club", defaultSlug);
    }
    next.delete("adminClubId");
    navigate(
      {
        pathname: location.pathname,
        search: next.toString(),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    activeSlug,
    defaultSlug,
    isAuthenticated,
    isLoading,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  return (
    <>
      {publicClubs.length > 1 && (
        <label className="app-club-selection">
          <span>Club</span>
          <select
            aria-label="Choisir un club"
            value={activeSlug}
            onChange={(event) => {
              const slug = event.target.value;
              if (!publicClubs.some((club) => club.slug === slug)) return;
              if (preferenceKey) {
                window.localStorage.setItem(preferenceKey, slug);
              }
              setDefaultSlug(slug);
              // Start a new public context; never carry adminClubId across clubs.
              navigate(`${ROUTES.home}?club=${encodeURIComponent(slug)}`);
            }}
          >
            {!activeSlug && <option value="">Club par défaut</option>}
            {publicClubs.map((club) => (
              <option key={club.slug} value={club.slug}>
                {club.name}
              </option>
            ))}
          </select>
          <small>
            Le club sélectionné ne modifie pas vos habilitations.
          </small>
        </label>
      )}
      <SuperAdminClubSwitcher />
    </>
  );
}
