# Calendar Policies

Statut : Accepté
Version : 2.1
Date : 2026-07-27
Remplace : les contrôles de conflit dispersés

- `CanOccupyTimeRangePolicy` décide si une Occupation peut coexister avec celles d'une même ressource.
- `CanMoveOccupationPolicy` applique la même validation lors d'un changement de ressource ou de période.

Les Policies Calendrier ne décident pas si un utilisateur peut réserver, si une équipe est disponible ou si le repos sportif est suffisant. Ces règles appartiennent respectivement aux Réservations et à la Planification sportive.

La publication d'un planning soumet toutes les Occupations ; elle réussit entièrement ou échoue sans création partielle.
