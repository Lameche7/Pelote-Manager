import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  tournamentFinalStageAdminService,
  type TournamentFinalFullPlanningWorkspace,
} from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";

type FinalDraft = {
  seriesId: string;
  name: string;
  color: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  opponents: string;
  published: boolean;
  completed: boolean;
};

function initialDrafts(
  workspace: TournamentFinalFullPlanningWorkspace,
): FinalDraft[] {
  return workspace.nodes
    .filter((node) => node.round === "final")
    .map((node) => {
      const series = workspace.series.find((item) => item.id === node.seriesId);
      return {
        seriesId: node.seriesId,
        name: series?.name ?? "Série",
        color: series?.color ?? "#64748b",
        resourceId: node.resourceId ?? workspace.resources[0]?.id ?? "",
        startsAt: node.startsAt?.slice(0, 5) ?? "",
        endsAt: node.endsAt?.slice(0, 5) ?? "",
        opponents:
          node.teamALabel && node.teamBLabel
            ? `${node.teamALabel} — ${node.teamBLabel}`
            : "Adversaires à déterminer",
        published: node.published,
        completed: node.resultStatus === "validated",
      };
    })
    .sort(
      (a, b) =>
        (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99") ||
        a.name.localeCompare(b.name),
    );
}

export function AdminTournamentFinalDayLineup({
  tournamentId,
  workspace,
  onChanged,
}: {
  tournamentId: string;
  workspace: TournamentFinalFullPlanningWorkspace;
  onChanged: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<FinalDraft[]>(() =>
    initialDrafts(workspace),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDrafts(initialDrafts(workspace));
  }, [workspace]);

  const scheduled = drafts.filter((entry) => entry.startsAt && entry.endsAt);
  // Send only changed finals: previously played or already-started untouched
  // fixtures must not block changes to future finals on the same day.
  const changed = scheduled.filter((entry) => {
    const previous = workspace.nodes.find(
      (node) => node.seriesId === entry.seriesId && node.round === "final",
    );
    return (
      !previous ||
      previous.resourceId !== entry.resourceId ||
      previous.playDate !== workspace.tournament.finalsEndsOn ||
      previous.startsAt?.slice(0, 5) !== entry.startsAt ||
      previous.endsAt?.slice(0, 5) !== entry.endsAt
    );
  });
  const validation = useMemo(() => {
    for (const entry of drafts) {
      if (Boolean(entry.startsAt) !== Boolean(entry.endsAt)) {
        return `Complétez le début et la fin de la finale ${entry.name}.`;
      }
      if (
        entry.startsAt &&
        (entry.endsAt <= entry.startsAt || !entry.resourceId)
      ) {
        return `Horaires ou terrain invalides pour ${entry.name}.`;
      }
    }
    for (let i = 0; i < scheduled.length; i += 1) {
      for (let j = i + 1; j < scheduled.length; j += 1) {
        const a = scheduled[i];
        const b = scheduled[j];
        if (
          a.resourceId === b.resourceId &&
          a.startsAt < b.endsAt &&
          a.endsAt > b.startsAt
        ) {
          return `Chevauchement de deux finales : ${a.name} et ${b.name}.`;
        }
      }
    }
    return "";
  }, [drafts]);

  const changeDraft = (seriesId: string, patch: Partial<FinalDraft>) => {
    setDrafts((current) =>
      current.map((item) =>
        item.seriesId === seriesId ? { ...item, ...patch } : item,
      ),
    );
    setError("");
    setMessage("");
  };

  const exchange = (index: number, direction: -1 | 1) => {
    const other = index + direction;
    if (other < 0 || other >= drafts.length) return;
    if (
      !drafts[index].startsAt ||
      !drafts[other].startsAt ||
      drafts[index].completed ||
      drafts[other].completed
    )
      return;
    setDrafts((current) => {
      const next = [...current];
      const a = next[index];
      const b = next[other];
      next[index] = {
        ...b,
        ...{
          seriesId: a.seriesId,
          name: a.name,
          color: a.color,
          opponents: a.opponents,
          published: a.published,
          completed: a.completed,
        },
      };
      next[other] = {
        ...a,
        ...{
          seriesId: b.seriesId,
          name: b.name,
          color: b.color,
          opponents: b.opponents,
          published: b.published,
          completed: b.completed,
        },
      };
      return next;
    });
    setError("");
    setMessage("");
  };

  const save = async () => {
    if (busy || validation || changed.length === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const count = await tournamentFinalStageAdminService.saveFinalDayLineup(
        tournamentId,
        changed.map(({ seriesId, resourceId, startsAt, endsAt }) => ({
          seriesId,
          resourceId,
          startsAt,
          endsAt,
        })),
      );
      await onChanged();
      setMessage(
        `${count} finale(s) enregistrée(s). Le calendrier affiche les horaires et les noms dès qu'ils sont connus.`,
      );
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="final-day-lineup"
      aria-label="Ordre et horaires des finales"
    >
      <h4>Ordre de passage des finales</h4>
      <p>
        Définissez les horaires dès maintenant, même si les finalistes ne sont
        pas connus. Le programme apparaît dans les réservations. Vous pouvez le
        réorganiser jusqu'au début de chaque rencontre, y compris le jour des
        finales.
      </p>
      <div className="final-day-lineup__rows">
        {drafts.map((entry, index) => (
          <div
            className="final-day-lineup__row"
            key={entry.seriesId}
            style={{ "--series-color": entry.color } as CSSProperties}
          >
            <div className="final-day-lineup__identity">
              <strong>Finale {entry.name}</strong>
              <small>{entry.opponents}</small>
              <small>
                {entry.completed
                  ? "Résultat validé · verrouillée"
                  : entry.published
                    ? "Publiée · déplacement notifié"
                    : "Programme prévisionnel"}
              </small>
            </div>
            <div className="final-day-lineup__hours">
              <label>
                Début
                <input
                  type="time"
                  value={entry.startsAt}
                  disabled={busy || entry.completed}
                  onChange={(event) =>
                    changeDraft(entry.seriesId, {
                      startsAt: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Fin
                <input
                  type="time"
                  value={entry.endsAt}
                  disabled={busy || entry.completed}
                  onChange={(event) =>
                    changeDraft(entry.seriesId, { endsAt: event.target.value })
                  }
                />
              </label>
              <label>
                Terrain
                <select
                  value={entry.resourceId}
                  disabled={busy || entry.completed}
                  onChange={(event) =>
                    changeDraft(entry.seriesId, {
                      resourceId: event.target.value,
                    })
                  }
                >
                  {workspace.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="final-day-lineup__move">
              <button
                type="button"
                disabled={
                  busy ||
                  index === 0 ||
                  entry.completed ||
                  !entry.startsAt ||
                  !drafts[index - 1].startsAt ||
                  drafts[index - 1].completed
                }
                onClick={() => exchange(index, -1)}
                title="Échanger avec la finale précédente"
              >
                ↑ Monter
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  index === drafts.length - 1 ||
                  entry.completed ||
                  !entry.startsAt ||
                  !drafts[index + 1].startsAt ||
                  drafts[index + 1].completed
                }
                onClick={() => exchange(index, 1)}
                title="Échanger avec la finale suivante"
              >
                ↓ Descendre
              </button>
            </div>
          </div>
        ))}
      </div>
      {validation && (
        <p
          className="qualification-alert qualification-alert--error"
          role="alert"
        >
          {validation}
        </p>
      )}
      {error && (
        <p
          className="qualification-alert qualification-alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        disabled={busy || Boolean(validation) || changed.length === 0}
        onClick={() => void save()}
      >
        {busy ? "Enregistrement…" : "Enregistrer le programme des finales"}
      </button>
      <small>
        Les créneaux non renseignés restent libres dans ce programme. Les
        rencontres publiées déplacées sont actualisées et les joueurs sont
        informés. Les finales déjà jouées restent protégées.
      </small>
    </section>
  );
}
