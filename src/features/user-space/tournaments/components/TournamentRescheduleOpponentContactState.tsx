import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type Props = {
  matchId: string;
  teamId: string;
};

type ContactState = {
  opponentLabel: string;
  opponentAppActorCount: number;
  requiresOfflineOpponentContact: boolean;
};

type Row = Record<string, unknown>;

export function TournamentRescheduleOpponentContactState({
  matchId,
  teamId,
}: Props) {
  const [state, setState] = useState<ContactState | null>(null);

  useEffect(() => {
    let active = true;

    void supabase
      .rpc("get_my_tournament_reschedule_contact_state", {
        target_match_id: matchId,
        requester_team_id: teamId,
      })
      .then(({ data, error }) => {
        if (!active || error) return;
        const row = (data ?? {}) as Row;
        setState({
          opponentLabel: String(row.opponent_label ?? "Équipe adverse"),
          opponentAppActorCount: Number(row.opponent_app_actor_count ?? 0),
          requiresOfflineOpponentContact: Boolean(
            row.requires_offline_opponent_contact,
          ),
        });
      });

    return () => {
      active = false;
    };
  }, [matchId, teamId]);

  if (!state?.requiresOfflineOpponentContact) return null;

  return (
    <p className="tournament-reschedule__policy" role="status">
      <strong>{state.opponentLabel}</strong> n’a actuellement aucun compte Pelote
      Manager relié à cette équipe. Cela n’empêche pas la demande de report :
      l’organisation devra simplement recueillir son accord hors application
      avant que le changement puisse être appliqué.
    </p>
  );
}
