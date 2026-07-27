# Occupation

Statut : Accepté
Version : 2.1
Date : 2026-07-27
Remplace : l’ancien modèle générique du Calendrier

Une Occupation bloque exactement une `Resource` pendant un `TimeRange`. Elle possède un identifiant, un type, un état, une visibilité, une référence vers son domaine d'origine et ses dates de création et de modification.

Types reconnus : `Reservation`, `TournamentMatch`, `Training`, `ClubEvent`, `Maintenance`, `Closure` et `PrivateUse`. Le type renseigne l'origine sans transférer ses règles au Calendrier.

Une Occupation active ne chevauche aucune Occupation incompatible. Une annulation conserve l'objet et son historique. Tout déplacement modifiant ressource ou période exige une revalidation complète.
