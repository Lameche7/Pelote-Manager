begin;

-- Allow users to book until the exact start of the slot.
-- The existing reservation rules already enforce that a slot cannot be booked
-- once its start time is in the past. Keeping the setting at 0 preserves the
-- administration switch if the club later wants to restore a notice period.

update public.reservation_settings
set minimum_notice_minutes = 0,
    updated_at = now(),
    updated_by = auth.uid()
where id;

commit;
