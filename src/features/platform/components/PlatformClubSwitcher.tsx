import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { platformSupabase } from "@/infrastructure/platform/platformClient";

type Club = { id: string; name: string; slug: string };

export function PlatformClubSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const client = platformSupabase;
    if (!client) return;
    let active = true;
    const refresh = async () => {
      setIsVerifiedAdmin(false);
      setClubs([]);
      setError("");
      const { data: identity, error: identityError } =
        await client.auth.getUser();
      if (identityError || !identity.user || !active) return;

      const { data: allowed, error: roleError } =
        await client.rpc("platform_is_admin");
      if (!active || roleError || allowed !== true) return;
      setIsVerifiedAdmin(true);

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

  if (!isVerifiedAdmin) return null;

  const params = new URLSearchParams(location.search);
  const activeSlug = params.get("club") || "";

  return (
    <label className="app-club-selection">
      <span>Club à consulter (super-admin)</span>
      <select
        aria-label="Club à consulter"
        value={clubs.some((club) => club.slug === activeSlug) ? activeSlug : ""}
        disabled={!clubs.length}
        onChange={(event) => {
          const slug = event.target.value;
          if (slug && !clubs.some((club) => club.slug === slug)) return;
          const next = new URLSearchParams(location.search);
          if (slug) next.set("club", slug);
          else next.delete("club");
          navigate({ pathname: location.pathname, search: next.toString() });
        }}
      >
        <option value="">Club par défaut</option>
        {clubs.map((club) => (
          <option key={club.id} value={club.slug}>
            {club.name}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
