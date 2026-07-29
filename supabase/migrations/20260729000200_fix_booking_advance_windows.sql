-- Corrige les fenêtres d'ouverture des réservations.
-- Public : J-2 à 08:00 (48 h de configuration).
-- Licencié actif : J-3 à 08:00 (72 h de configuration).

update public.reservation_settings
set public_advance_hours = 48,
    licensee_advance_hours = 72,
    updated_at = now()
where id;
