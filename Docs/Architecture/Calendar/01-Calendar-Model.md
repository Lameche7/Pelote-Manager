# Calendar Model

Statut : Accepté
Version : 2.1
Date : 2026-07-27
Remplace : le modèle de calendrier fondé sur un événement générique

Le Calendrier est l'autorité unique sur la coexistence physique des usages de ressources. Il connaît `Resource`, `TimeRange`, `Occupation`, `OccupationStatus`, `Visibility` et `Conflict`.

Il ne connaît pas le client, le paiement, les règles de réservation, les contraintes sportives, le score ou le contenu complet d'un Match. Les domaines d'origine demandent la création, le déplacement ou l'annulation d'une Occupation et conservent leurs propres agrégats.

Une projection filtre les Occupations publiables pour le calendrier public. Elle ne révèle aucune donnée privée.
