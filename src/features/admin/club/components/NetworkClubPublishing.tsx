import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type PublicProfile = {
  is_published: boolean;
  public_address: string;
  public_email: string;
  public_phone: string;
  public_website: string;
  public_description: string;
};
const blank: PublicProfile = {
  is_published: false,
  public_address: "",
  public_email: "",
  public_phone: "",
  public_website: "",
  public_description: "",
};

export function NetworkClubPublishing({ clubId }: { clubId: string }) {
  const [profile, setProfile] = useState<PublicProfile>(blank);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    supabase.from("network_club_profiles").select("is_published,public_address,public_email,public_phone,public_website,public_description")
      .eq("club_id", clubId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setStatus("La fiche réseau n'est pas encore disponible. Vérifiez la migration.");
        else if (data) setProfile(data);
        setBusy(false);
      });
    return () => { active = false; };
  }, [clubId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const { error } = await supabase.from("network_club_profiles")
      .upsert({ club_id: clubId, ...profile }, { onConflict: "club_id" });
    setBusy(false);
    setStatus(error ? "Enregistrement impossible : " + error.message : "Fiche publique mise à jour.");
  };

  const fields: { key: keyof Omit<PublicProfile, "is_published">; label: string }[] = [
    { key: "public_address", label: "Adresse à publier" },
    { key: "public_email", label: "E-mail public" },
    { key: "public_phone", label: "Téléphone public" },
    { key: "public_website", label: "Site internet public" },
    { key: "public_description", label: "Présentation du club" },
  ];

  return (
    <form className="admin-card" onSubmit={(event) => void save(event)} style={{ padding: 22, display: "grid", gap: 12 }}>
      <h2>Pilotoki Network — Fiche publique du club</h2>
      <p>Ces informations sont indépendantes de la fiche administrative interne. Rien n'est publié tant que vous n'activez pas la publication.</p>
      {fields.map(({ key, label }) => (
        <label key={key} style={{ display: "grid", gap: 5 }}>
          {label}
          {key === "public_description" ? (
            <textarea value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} />
          ) : (
            <input type={key === "public_email" ? "email" : key === "public_website" ? "url" : "text"}
              value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} />
          )}
        </label>
      ))}
      <label><input type="checkbox" checked={profile.is_published}
        onChange={(event) => setProfile({ ...profile, is_published: event.target.checked })} /> Autoriser la publication de ces coordonnées sur Pilotoki Network</label>
      <button type="submit" disabled={busy}>{busy ? "Chargement…" : "Enregistrer la fiche réseau"}</button>
      <span role="status">{status}</span>
    </form>
  );
}
