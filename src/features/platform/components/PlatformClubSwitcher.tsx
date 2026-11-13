import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { platformSupabase } from "@/infrastructure/platform/platformClient";
import { ROUTES } from "@/shared/config";
import { verifyPlatformBusinessIdentity } from "../services/platformBusinessIdentityService";

type Club = { id: string; name: string; slug: string };
const CLUB_PREFERENCE_KEY = "pilotoki-superadmin-selected-club";

export function PlatformClubSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("club") ??
        window.sessionStorage.getItem(CLUB_PREFERENCE_KEY) ?? "",
  );
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [error, setError] = useState("");
  const [identityLinked, setIdentityLinked] = useState(false);
  const [status, setStatus] = useState<
    "checking" | "ready" | "session" | "role" | "configuration"
  >("checking");

  useEffect(() => {
    const client = platformSupabase;
    if (!client) {
      window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
      setSelectedSlug("");
      setStatus("configuration");
      return;
    }
    let active = true;
    const refresh = async () => {
      setStatus("checking");
      setIsVerifiedAdmin(false);
      setClubs([]);
      setError("");
      setIdentityLinked(false);
      const { data: identity, error: identityError } =
        await client.auth.getUser();
      if (!active) return;
      if (identityError || !identity.user) {
        window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
        setSelectedSlug("");
        setStatus("session");
        return;
      }

      const { data: allowed, error: roleError } =
        await client.rpc("platform_is_admin");
      if (!active) return;
      if (roleError || allowed !== true) {
        window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
        setSelectedSlug("");
        setStatus("role");
        return;
      }
      setStatus("ready");
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
        window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
        setSelectedSlug("");
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

  const params = new URLSearchParams(location.search);
  const activeSlug = params.get("club") || "";

  // A persisted preference is not an authorization: validate against server catalogue.
  useEffect(() => {
    if (!isVerifiedAdmin || !clubs.length) return;
    const valid = clubs.some((club) => club.slug === selectedSlug);
    if (!valid && selectedSlug) {
      window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
      setSelectedSlug("");
    }
    const desired = valid ? selectedSlug : "";
    if (valid) window.sessionStorage.setItem(CLUB_PREFERENCE_KEY, selectedSlug);
    if (activeSlug === desired) return;
    const next = new URLSearchParams(location.search);
    if (desired) next.set("club", desired);
    else next.delete("club");
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }, [isVerifiedAdmin, clubs, selectedSlug, activeSlug, location.pathname, location.search, location.hash, navigate]);


  if (!isVerifiedAdmin) {
    if (status === "checking") return null;
    const message =
      status === "configuration"
        ? "Sélection des clubs indisponible : configuration de la plateforme manquante."
        : status === "session"
          ? "Sélection des clubs indisponible : session de la plateforme centrale absente ou expirée."
          : "Sélection des clubs indisponible : droits super-administrateur non confirmés sur la plateforme centrale.";
    return (
      <span className="app-club-selection" role="status">
        <small>{message}</small>
        {status === "session" && (
          <Link to={ROUTES.platformLogin}>Connexion à la plateforme centrale</Link>
        )}
      </span>
    );
  }


  return (
    <label className="app-club-selection">
      <span>Aperçu visuel du club (super-admin)</span>
      <select
        aria-label="Aperçu visuel du club"
        value={clubs.some((club) => club.slug === selectedSlug) ? selectedSlug : ""}
        disabled={!clubs.length}
        onChange={(event) => {
          const slug = event.target.value;
          if (slug && !clubs.some((club) => club.slug === slug)) return;
          if (slug) window.sessionStorage.setItem(CLUB_PREFERENCE_KEY, slug);
          else window.sessionStorage.removeItem(CLUB_PREFERENCE_KEY);
          setSelectedSlug(slug);
          const next = new URLSearchParams(location.search);
          if (slug) next.set("club", slug);
          else next.delete("club");
          navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash });
        }}
      >
        <option value="">Club par défaut</option>
        {clubs.map((club) => (
          <option key={club.id} value={club.slug}>
            {club.name}
          </option>
        ))}
      </select>
      <small>Aperçu uniquement : aucune donnée ni permission modifiée.</small>
      <small>
        {identityLinked
          ? "Identité vérifiée · administration inter-clubs non activée"
          : "Liaison des deux sessions non vérifiée"}
      </small>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
