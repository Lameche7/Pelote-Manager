import { useCallback, useEffect, useState } from "react";
import { requirePlatformSupabase } from "@/infrastructure/platform/platformClient";
import type { PlatformClub } from "../services/platformRegistryService";

type Preparation = {
  club_id: string;
  candidate_email: string;
  prepared_at: string;
};

export function PlatformFirstAdminDryRunPanel({
  clubs,
}: {
  clubs: PlatformClub[];
}) {
  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [emailByClub, setEmailByClub] = useState<Record<string, string>>({});
  const [busyClub, setBusyClub] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const { data, error: failure } = await requirePlatformSupabase().rpc(
      "platform_list_first_admin_dry_runs",
    );
    if (failure) {
      setError(failure.message);
      return;
    }
    setPreparations((data ?? []) as Preparation[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const testClubs = clubs.filter(
    (club) =>
      club.slug.startsWith("test-") &&
      club.status === "provisioning" &&
      !club.supabaseProjectRef &&
      !club.deploymentUrl &&
      !club.vercelProjectName,
  );

  const prepare = async (club: PlatformClub) => {
    setBusyClub(club.id);
    setError("");
    setMessage("");
    const email = (emailByClub[club.id] ?? club.contactEmail).trim();
    try {
      const { error: failure } = await requirePlatformSupabase().rpc(
        "platform_prepare_first_admin_dry_run",
        {
          target_club_id: club.id,
          target_candidate_email: email,
        },
      );
      if (failure) throw failure;
      await refresh();
      setMessage(
        `Préparation enregistrée pour ${club.name}. Aucun compte ou accès n'a été créé.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Préparation impossible.",
      );
    } finally {
      setBusyClub("");
    }
  };

  return (
    <section
      className="platform-card platform-card--wide"
      id="premier-admin-test"
    >
      <p className="platform-kicker">Avant l'activation</p>
      <h2>Premier administrateur — simulation</h2>
      <p>
        Préparez l'identité du premier administrateur d'un club fictif. Cette
        simulation n'envoie aucune invitation et ne crée aucun compte, aucun
        droit d'administration ni aucune ressource technique.
      </p>
      <p>
        Pour les clubs réels, le rattachement de l'administrateur nécessitera
        une instance isolée, un compte Auth confirmé et un contrôle des droits
        propres au club.
      </p>
      {error && (
        <p className="platform-message platform-message--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="platform-message platform-message--success" role="status">
          {message}
        </p>
      )}
      {testClubs.length === 0 ? (
        <p>Aucun club fictif éligible à la préparation.</p>
      ) : (
        <div className="platform-club-list">
          {testClubs.map((club) => {
            const prepared = preparations.find(
              (item) => item.club_id === club.id,
            );
            return (
              <div className="platform-club" key={club.id}>
                <h3>{club.name}</h3>
                <p>Formule : {club.subscriptionPlan}</p>
                <label>
                  Email fictif du futur administrateur
                  <input
                    type="email"
                    required
                    placeholder="admin@example.invalid"
                    value={emailByClub[club.id] ?? club.contactEmail}
                    onChange={(event) =>
                      setEmailByClub((previous) => ({
                        ...previous,
                        [club.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <p>
                  {prepared
                    ? `Simulation préparée pour ${prepared.candidate_email}.`
                    : "Aucune simulation enregistrée."}
                </p>
                <button
                  className="button button--small button--primary"
                  type="button"
                  disabled={busyClub !== ""}
                  onClick={() => void prepare(club)}
                >
                  {busyClub === club.id
                    ? "Préparation…"
                    : "Préparer le premier admin (sans activation)"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
