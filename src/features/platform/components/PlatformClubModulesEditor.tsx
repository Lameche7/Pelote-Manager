import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";
import {
  CLUB_MODULES,
  FULL_CLUB_MODULES,
  TOURNAMENT_CLUB_MODULES,
  parseClubModules,
  type ClubModules,
} from "@/features/admin/config/clubModules";

const labels = [
  "Tournois",
  "Planning global des tournois",
  "Inscriptions en ligne",
  "Arbitrage des tournois",
  "Paiements",
  "Communications et notifications",
  "Réservations classiques",
  "Championnats",
  "Gestion des licences",
  "Mode TV",
  "Pilotoki Live",
];

export function PlatformClubModulesEditor({ clubId }: { clubId: string }) {
  return <ClubModulesEditor key={clubId} clubId={clubId} />;
}

// Remount on club changes so a pending read or write cannot reuse another club’s profile.
function ClubModulesEditor({ clubId }: { clubId: string }) {
  const [profile, setProfile] = useState<ClubModules | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setProfile(null);
    setMessage("");
    void (async () => {
      try {
        const { data, error } = await supabase.rpc(
          "platform_admin_get_club_modules",
          { target_club_id: clubId },
        );
        if (error) throw error;
        const parsed = data === null ? { ...FULL_CLUB_MODULES } : parseClubModules(data);
        if (!parsed) throw new Error("Invalid profile");
        if (active) setProfile(parsed);
      } catch {
        if (active) setMessage("Configuration inaccessible.");
      }
    })();
    return () => { active = false; };
  }, [clubId]);

  const save = async () => {
    if (!profile || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.rpc("platform_admin_set_club_modules", {
        target_club_id: clubId,
        profile,
      });
      if (error) throw error;
      setMessage("Configuration enregistrée.");
    } catch {
      setMessage("Enregistrement refusé ou autorisation expirée.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="platform-card" aria-label="Fonctionnalités du club">
      <h3>Fonctionnalités du club</h3>
      <p>Préparation des modules : les restrictions métier ne sont pas encore actives.</p>
      {profile && (
        <>
          <button type="button" disabled={busy} onClick={() => setProfile({ ...FULL_CLUB_MODULES })}>
            Club complet
          </button>
          <button type="button" disabled={busy} onClick={() => setProfile({ ...TOURNAMENT_CLUB_MODULES })}>
            Club organisateur de tournois
          </button>
          {CLUB_MODULES.map((key, index) => (
            <label key={key} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <input type="checkbox" checked={profile[key]} disabled={busy}
                onChange={(event) => setProfile({ ...profile, [key]: event.target.checked })} />
              {labels[index]}
            </label>
          ))}
          <button type="button" disabled={busy} onClick={() => void save()}>
            Enregistrer les fonctionnalités
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
