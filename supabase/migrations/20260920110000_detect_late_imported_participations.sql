begin;

-- Un compte peut exister avant l'import d'un tournoi. Dans ce cas, aucune
-- metadata d'inscription ne peut pointer vers l'identité externe créée plus
-- tard. Cette RPC authentifiée dérive l'identité directement du profil courant
-- et expose uniquement les participations encore confirmables.
create or replace function public.get_my_unclaimed_external_participations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile public.profiles%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into actor_profile
  from public.profiles as profile
  where profile.id = actor_id;

  if actor_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  if btrim(coalesce(actor_profile.first_name, '')) = ''
    or btrim(coalesce(actor_profile.last_name, '')) = ''
  then
    return '[]'::jsonb;
  end if;

  -- Le moteur de recherche ne renvoie déjà que des identités importées,
  -- unmatched, sans compte/licence, sur des équipes et tournois actifs.
  -- La confirmation finale repasse ensuite par claim_external_participation(),
  -- qui revalide le nom et les conflits au moment de l'écriture.
  return public.find_external_participation_candidates(
    actor_profile.first_name,
    actor_profile.last_name
  );
end;
$$;

revoke all on function public.get_my_unclaimed_external_participations()
from public, anon, authenticated;
grant execute on function public.get_my_unclaimed_external_participations()
to authenticated;

comment on function public.get_my_unclaimed_external_participations() is
  'Détecte pour le profil connecté les participations importées après la création du compte, sans les rattacher silencieusement.';

commit;
