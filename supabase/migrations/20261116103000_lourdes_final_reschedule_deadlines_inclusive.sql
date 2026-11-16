-- Clarification: deadlines are the final permitted playing day, inclusive.
-- Lourdes 2026 only; all other tournaments keep their own settings.
insert into public.tournament_final_reschedule_deadlines
  (tournament_id,final_round,last_play_date)
values
  ('3de17177-a915-404f-8a6e-14bf42158982','preliminary','2026-11-27'),
  ('3de17177-a915-404f-8a6e-14bf42158982','round_of_16','2026-11-27'),
  ('3de17177-a915-404f-8a6e-14bf42158982','quarterfinal','2026-12-04'),
  ('3de17177-a915-404f-8a6e-14bf42158982','semifinal','2026-12-11')
on conflict (tournament_id,final_round)
do update set last_play_date=excluded.last_play_date;
