begin;

-- Les inscriptions en ligne n'ont plus besoin d'une validation manuelle.
-- Elles deviennent immédiatement actives tout en restant modifiables/retirables
-- depuis le back-office tant que les équipes ne sont pas verrouillées.

create or replace function public.auto_accept_tournament_registration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.submitted_by is not null and new.status = 'pending' then
    new.status := 'accepted';
    new.validated_by := null;
    new.validated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_teams_auto_accept_registration
on public.tournament_teams;

create trigger tournament_teams_auto_accept_registration
before insert or update of status, submitted_by
on public.tournament_teams
for each row
execute function public.auto_accept_tournament_registration();

-- Aligner les inscriptions déjà en attente sur la nouvelle règle métier.
update public.tournament_teams
set
  status = 'accepted',
  validated_by = null,
  validated_at = coalesce(validated_at, now()),
  updated_at = now()
where submitted_by is not null
  and status = 'pending';

revoke all on function public.auto_accept_tournament_registration() from public, anon, authenticated;

commit;
