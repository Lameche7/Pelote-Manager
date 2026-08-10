begin;

-- PR67 — Générateur de données synthétiques pour préparer les tests du Pool Engine.
--
-- Les données fictives sont rattachées à des batches privés afin de pouvoir
-- les supprimer sans toucher aux vraies inscriptions.
-- Les fonctions ne sont pas exposées au navigateur : elles sont réservées au
-- SQL Editor / service_role.

create table if not exists public.tournament_test_data_batches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  teams_per_series integer not null check (teams_per_series between 1 and 64),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_test_data_teams (
  batch_id uuid not null
    references public.tournament_test_data_batches (id)
    on delete cascade,
  team_id uuid not null
    references public.tournament_teams (id)
    on delete cascade,
  primary key (batch_id, team_id),
  unique (team_id)
);

create index if not exists tournament_test_data_batches_tournament_idx
on public.tournament_test_data_batches (tournament_id, created_at desc);

alter table public.tournament_test_data_batches enable row level security;
alter table public.tournament_test_data_teams enable row level security;

revoke all on table public.tournament_test_data_batches
from public, anon, authenticated;
revoke all on table public.tournament_test_data_teams
from public, anon, authenticated;

create or replace function public.generate_tournament_test_data(
  target_tournament_id uuid,
  target_teams_per_series integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  target_batch_id uuid := gen_random_uuid();
  series_row record;
  team_index integer;
  global_index integer := 0;
  existing_active_count integer;
  series_created_count integer;
  total_created_count integer := 0;
  available_slot_count integer;
  available_weekend_slot_count integer;
  target_availability_count integer;
  selected_availability_count integer;
  additional_availability_count integer;
  availability_ratio numeric;
  availability_profile text;
  slot_interval interval;
  target_team_id uuid;
  front_first_name text;
  front_last_name text;
  back_first_name text;
  back_last_name text;
  generated_email text;
  generated_phone text;
  series_summary jsonb := '[]'::jsonb;
  first_names text[] := array[
    'Antton', 'Baptiste', 'Beñat', 'Clément', 'Dorian', 'Eneko',
    'Fabien', 'Gaël', 'Iban', 'Jon', 'Julien', 'Kévin',
    'Léo', 'Mathieu', 'Mikel', 'Nicolas', 'Oier', 'Paul',
    'Peio', 'Pierre', 'Rémi', 'Thomas', 'Txomin', 'Xabi'
  ];
  last_names text[] := array[
    'Aguirre', 'Aramburu', 'Bidegain', 'Carricart', 'Darrieutort',
    'Duhalde', 'Etcheber', 'Etcheverry', 'Garcia', 'Harguindeguy',
    'Hiriart', 'Irigoyen', 'Lacoste', 'Larralde', 'Larrieu',
    'Maitia', 'Olçomendy', 'Oyhenart', 'Sallaberry', 'Urrutia'
  ];
begin
  if target_tournament_id is null then
    raise exception 'Tournament id is required' using errcode = '22023';
  end if;

  if target_teams_per_series is null
    or target_teams_per_series < 1
    or target_teams_per_series > 64 then
    raise exception 'Test teams per series must be between 1 and 64'
      using errcode = '22023';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament test data are locked at this stage'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.enabled
      and series.capacity > 0
  ) then
    raise exception 'Tournament has no active series'
      using errcode = 'P0001';
  end if;

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

  with generated_slots as (
    select distinct
      date_series.play_timestamp::date as play_date,
      slot_series.starts_at::time as starts_at,
      (slot_series.starts_at + slot_interval)::time as ends_at
    from generate_series(
      target_tournament.starts_on::timestamp,
      target_tournament.ends_on::timestamp,
      interval '1 day'
    ) as date_series(play_timestamp)
    join public.tournament_play_windows as play_window
      on play_window.tournament_id = target_tournament.id
     and play_window.weekday =
       extract(dow from date_series.play_timestamp)::integer
    cross join lateral generate_series(
      date_series.play_timestamp::date + play_window.opens_at,
      date_series.play_timestamp::date + play_window.closes_at - slot_interval,
      slot_interval
    ) as slot_series(starts_at)
  )
  select
    count(*)::integer,
    count(*) filter (
      where extract(dow from generated_slots.play_date)::integer in (0, 6)
    )::integer
  into available_slot_count, available_weekend_slot_count
  from generated_slots;

  if available_slot_count = 0 then
    raise exception 'Tournament has no generated play slots'
      using errcode = 'P0001';
  end if;

  if available_slot_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament does not contain enough slots for test registrations'
      using errcode = 'P0001';
  end if;

  if available_weekend_slot_count
    < target_tournament.minimum_weekend_availability_slots then
    raise exception 'Tournament does not contain enough weekend slots for test registrations'
      using errcode = 'P0001';
  end if;

  insert into public.tournament_test_data_batches (
    id,
    tournament_id,
    teams_per_series,
    created_by
  )
  values (
    target_batch_id,
    target_tournament.id,
    target_teams_per_series,
    auth.uid()
  );

  for series_row in
    select
      series.id,
      series.name,
      series.capacity,
      series.display_order
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.enabled
      and series.capacity > 0
    order by series.display_order, series.name
  loop
    select count(*)::integer
    into existing_active_count
    from public.tournament_teams as team
    where team.series_id = series_row.id
      and team.status in ('pending', 'accepted');

    series_created_count := least(
      target_teams_per_series,
      greatest(series_row.capacity - existing_active_count, 0)
    );

    if series_created_count > 0 then
      for team_index in 1..series_created_count
      loop
        global_index := global_index + 1;

        front_first_name := first_names[
          1 + floor(random() * array_length(first_names, 1))::integer
        ];
        back_first_name := first_names[
          1 + floor(random() * array_length(first_names, 1))::integer
        ];
        front_last_name := concat(
          last_names[
            1 + floor(random() * array_length(last_names, 1))::integer
          ],
          ' TEST',
          lpad(global_index::text, 3, '0')
        );
        back_last_name := concat(
          last_names[
            1 + floor(random() * array_length(last_names, 1))::integer
          ],
          ' TEST',
          lpad(global_index::text, 3, '0')
        );

        generated_email := format(
          'tournoi-test-%s-%s@example.test',
          substring(replace(target_batch_id::text, '-', '') from 1 for 8),
          global_index
        );
        generated_phone := concat(
          '0600',
          lpad((global_index % 1000000)::text, 6, '0')
        );

        case global_index % 4
          when 0 then
            availability_profile := 'minimum';
            availability_ratio := 0;
          when 1 then
            availability_profile := 'contraint';
            availability_ratio := 0.65;
          when 2 then
            availability_profile := 'standard';
            availability_ratio := 0.80;
          else
            availability_profile := 'large';
            availability_ratio := 0.95;
        end case;

        target_availability_count := least(
          available_slot_count,
          greatest(
            target_tournament.minimum_availability_slots,
            ceil(available_slot_count * availability_ratio)::integer
          )
        );

        insert into public.tournament_teams (
          tournament_id,
          series_id,
          status,
          contact_email,
          contact_phone,
          comments,
          submitted_by,
          created_by,
          validated_by,
          validated_at
        )
        values (
          target_tournament.id,
          series_row.id,
          'accepted',
          generated_email,
          generated_phone,
          concat(
            'DONNÉES DE TEST · profil de disponibilité ',
            availability_profile,
            ' · batch ',
            substring(target_batch_id::text from 1 for 8)
          ),
          null,
          null,
          null,
          now()
        )
        returning id into target_team_id;

        insert into public.tournament_team_players (
          team_id,
          tournament_id,
          member_id,
          role,
          first_name,
          last_name,
          email,
          phone,
          display_order
        )
        values
          (
            target_team_id,
            target_tournament.id,
            null,
            'front',
            front_first_name,
            front_last_name,
            generated_email,
            generated_phone,
            0
          ),
          (
            target_team_id,
            target_tournament.id,
            null,
            'back',
            back_first_name,
            back_last_name,
            generated_email,
            generated_phone,
            1
          );

        insert into public.tournament_test_data_teams (batch_id, team_id)
        values (target_batch_id, target_team_id);

        if target_tournament.minimum_weekend_availability_slots > 0 then
          insert into public.tournament_team_availability_slots (
            team_id,
            tournament_id,
            play_date,
            starts_at,
            ends_at
          )
          with generated_slots as (
            select distinct
              date_series.play_timestamp::date as play_date,
              slot_series.starts_at::time as starts_at,
              (slot_series.starts_at + slot_interval)::time as ends_at
            from generate_series(
              target_tournament.starts_on::timestamp,
              target_tournament.ends_on::timestamp,
              interval '1 day'
            ) as date_series(play_timestamp)
            join public.tournament_play_windows as play_window
              on play_window.tournament_id = target_tournament.id
             and play_window.weekday =
               extract(dow from date_series.play_timestamp)::integer
            cross join lateral generate_series(
              date_series.play_timestamp::date + play_window.opens_at,
              date_series.play_timestamp::date + play_window.closes_at - slot_interval,
              slot_interval
            ) as slot_series(starts_at)
          )
          select
            target_team_id,
            target_tournament.id,
            generated_slots.play_date,
            generated_slots.starts_at,
            generated_slots.ends_at
          from generated_slots
          where extract(dow from generated_slots.play_date)::integer in (0, 6)
          order by random()
          limit target_tournament.minimum_weekend_availability_slots;
        end if;

        select count(*)::integer
        into selected_availability_count
        from public.tournament_team_availability_slots as availability
        where availability.team_id = target_team_id;

        additional_availability_count := greatest(
          target_availability_count - selected_availability_count,
          0
        );

        if additional_availability_count > 0 then
          insert into public.tournament_team_availability_slots (
            team_id,
            tournament_id,
            play_date,
            starts_at,
            ends_at
          )
          with generated_slots as (
            select distinct
              date_series.play_timestamp::date as play_date,
              slot_series.starts_at::time as starts_at,
              (slot_series.starts_at + slot_interval)::time as ends_at
            from generate_series(
              target_tournament.starts_on::timestamp,
              target_tournament.ends_on::timestamp,
              interval '1 day'
            ) as date_series(play_timestamp)
            join public.tournament_play_windows as play_window
              on play_window.tournament_id = target_tournament.id
             and play_window.weekday =
               extract(dow from date_series.play_timestamp)::integer
            cross join lateral generate_series(
              date_series.play_timestamp::date + play_window.opens_at,
              date_series.play_timestamp::date + play_window.closes_at - slot_interval,
              slot_interval
            ) as slot_series(starts_at)
          )
          select
            target_team_id,
            target_tournament.id,
            generated_slots.play_date,
            generated_slots.starts_at,
            generated_slots.ends_at
          from generated_slots
          where not exists (
            select 1
            from public.tournament_team_availability_slots as selected
            where selected.team_id = target_team_id
              and selected.play_date = generated_slots.play_date
              and selected.starts_at = generated_slots.starts_at
              and selected.ends_at = generated_slots.ends_at
          )
          order by random()
          limit additional_availability_count;
        end if;

        total_created_count := total_created_count + 1;
      end loop;
    end if;

    series_summary := series_summary || jsonb_build_array(
      jsonb_build_object(
        'series_id', series_row.id,
        'series_name', series_row.name,
        'capacity', series_row.capacity,
        'existing_active_teams', existing_active_count,
        'created_teams', series_created_count
      )
    );
  end loop;

  if total_created_count = 0 then
    raise exception 'Tournament series have no remaining capacity'
      using errcode = 'P0001';
  end if;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'test_data_generated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'batch_id', target_batch_id,
      'created_teams', total_created_count,
      'teams_per_series', target_teams_per_series,
      'available_slots', available_slot_count,
      'available_weekend_slots', available_weekend_slot_count,
      'series', series_summary
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'batch_id', target_batch_id,
    'created_teams', total_created_count,
    'teams_per_series', target_teams_per_series,
    'available_slots', available_slot_count,
    'available_weekend_slots', available_weekend_slot_count,
    'series', series_summary
  );
end;
$$;

create or replace function public.clear_tournament_test_data(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  removed_team_count integer := 0;
  removed_batch_count integer := 0;
begin
  if target_tournament_id is null then
    raise exception 'Tournament id is required' using errcode = '22023';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament test data are locked at this stage'
      using errcode = 'P0001';
  end if;

  delete from public.tournament_teams as team
  using
    public.tournament_test_data_teams as test_team,
    public.tournament_test_data_batches as batch
  where team.id = test_team.team_id
    and test_team.batch_id = batch.id
    and batch.tournament_id = target_tournament.id;

  get diagnostics removed_team_count = row_count;

  delete from public.tournament_test_data_batches as batch
  where batch.tournament_id = target_tournament.id;

  get diagnostics removed_batch_count = row_count;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'test_data_cleared',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'removed_teams', removed_team_count,
      'removed_batches', removed_batch_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'removed_teams', removed_team_count,
    'removed_batches', removed_batch_count
  );
end;
$$;

revoke all on function public.generate_tournament_test_data(uuid, integer)
from public, anon, authenticated;
revoke all on function public.clear_tournament_test_data(uuid)
from public, anon, authenticated;

grant execute on function public.generate_tournament_test_data(uuid, integer)
to service_role;
grant execute on function public.clear_tournament_test_data(uuid)
to service_role;

commit;
