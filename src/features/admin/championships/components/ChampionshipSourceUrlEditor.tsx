import { useEffect, useState } from "react";
import { championshipSourceUrlService } from "@/features/admin/championships/services/championshipSourceUrlService";
import "./ChampionshipSourceUrlEditor.css";

type Props = {
  championshipId: string;
  sourceUrl: string | null;
  onSaved: (sourceUrl: string | null) => void;
};

export function ChampionshipSourceUrlEditor({
  championshipId,
  sourceUrl,
  onSaved,
}: Props) {
  const [value, setValue] = useState(sourceUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValue(sourceUrl ?? "");
    setError("");
    setMessage("");
  }, [championshipId, sourceUrl]);

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextSourceUrl = await championshipSourceUrlService.update(
        championshipId,
        value.trim(),
      );
      setValue(nextSourceUrl ?? "");
      onSaved(nextSourceUrl);
      setMessage("Source officielle enregistrée.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer la source officielle.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changed = value.trim() !== (sourceUrl ?? "").trim();

  return (
    <div className="admin-championship-results__source-editor">
      <label>
        <span>URL officielle FFPB du championnat</span>
        <input
          type="url"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
            setMessage("");
          }}
          placeholder="https://lbpb.competition.ffpb.net?id_competition=…"
          disabled={saving}
        />
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !changed || !value.trim()}
      >
        {saving ? "Enregistrement…" : "Enregistrer l’URL"}
      </button>
      {error && <p className="admin-championship-results__error">{error}</p>}
      {message && (
        <p className="admin-championship-results__official-success">{message}</p>
      )}
      <small>
        Une seule URL suffit : PILOTOKI parcourt ensuite les différentes séries
        présentes sur cette page FFPB.
      </small>
    </div>
  );
}
