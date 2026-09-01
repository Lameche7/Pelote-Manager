begin;

-- PR125 — La recherche manuelle d'un licencié Errebot doit rester indépendante
-- du téléphone. Le téléphone reste un signal de prudence pour le rapprochement
-- automatique, mais l'administrateur doit pouvoir retrouver un licencié par
-- prénom, nom (dans n'importe quel ordre) ou numéro de licence.

create or replace function public.admin_search_errebot_identity_candidates(
  search_text text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  raw_search text := btrim(coalesce(search_text, ''));
  normalized_search text := public.normalize_member_identity(
    btrim(coalesce(search_text, ''))
  );
  normalized_licence text := public.normalize_member_licence(
    btrim(coalesce(search_text, ''))
  );
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if length(raw_search) < 2 then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'displayName', candidate.first_name || ' ' || candidate.last_name,
          'licenceNumber', candidate.licence_number,
          'clubName', candidate.club_name,
          'linkedAccount', candidate.linked_account,
          'memberActive', candidate.is_active
        )
        order by candidate.relevance, candidate.last_name, candidate.first_name, candidate.club_name
      ),
      '[]'::jsonb
    )
    from (
      select
        member.id,
        member.first_name,
        member.last_name,
        member.licence_number,
        member.is_active,
        club.name as club_name,
        exists (
          select 1
          from public.profiles as profile
          where profile.member_id = member.id
        ) as linked_account,
        case
          when member.licence_number_normalized = normalized_licence then 0
          when member.first_name_normalized || member.last_name_normalized = normalized_search then 1
          when member.last_name_normalized || member.first_name_normalized = normalized_search then 1
          else 2
        end as relevance
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.is_active
        and (
          member.licence_number_normalized like '%' || normalized_licence || '%'
          or member.first_name_normalized || member.last_name_normalized
            like '%' || normalized_search || '%'
          or member.last_name_normalized || member.first_name_normalized
            like '%' || normalized_search || '%'
          or not exists (
            select 1
            from unnest(regexp_split_to_array(raw_search, '[[:space:]]+')) as part(value)
            where public.normalize_member_identity(part.value) <> ''
              and member.first_name_normalized not like
                '%' || public.normalize_member_identity(part.value) || '%'
              and member.last_name_normalized not like
                '%' || public.normalize_member_identity(part.value) || '%'
          )
        )
      order by relevance, member.last_name_normalized, member.first_name_normalized, club.name
      limit 12
    ) as candidate
  );
end;
$$;

revoke all on function public.admin_search_errebot_identity_candidates(text)
from public, anon;
grant execute on function public.admin_search_errebot_identity_candidates(text)
to authenticated;

commit;
