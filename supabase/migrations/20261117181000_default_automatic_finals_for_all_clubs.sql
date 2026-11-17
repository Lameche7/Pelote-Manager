-- Pilotoki standard behavior: every new club tournament advances independent
-- final-stage branches automatically after validated results.
-- Keep finals_auto_advance_enabled as a server-side emergency kill switch.
-- No results, fixtures, schedules, or notifications are created by this migration.
begin;

alter table public.tournaments
  alter column finals_auto_advance_enabled set default true;

-- Existing tournaments still capable of playing matches adopt the new standard.
-- Finished or cancelled competitions remain untouched for historical integrity.
update public.tournaments
set finals_auto_advance_enabled = true
where finals_auto_advance_enabled = false
  and status not in ('completed', 'archived', 'cancelled');

commit;
