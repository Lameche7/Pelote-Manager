# Calendar Value Objects

Statut : Accepté
Version : 2.1
Date : 2026-07-27
Remplace : les dates et chaînes libres utilisées comme modèle métier

- `TimeRange` : début inclus, fin exclue, début strictement antérieur à la fin.
- `Duration` : durée positive exprimée sans ambiguïté.
- `AvailabilityRule` : règle de disponibilité ou préférence, non créneau persisté.
- `Visibility` : exposition publique, membre ou administration.
- `Capacity` : quantité valide selon le contexte métier.
- `CompetitionFormat` : effectif et règles d'une compétition.
- `Score` : résultat conforme au règlement configuré.
- `TournamentPeriod` : limites temporelles d'un tournoi.
- `ReservationWindow` : fenêtre pendant laquelle une réservation est autorisée.

Ces Value Objects valident leurs invariants à la création et ne dépendent ni de Supabase ni de React.
