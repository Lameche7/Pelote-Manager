# Créneaux permanents

Statut : conception validée
Version : 1.0
Date : 2026-09-12

## Objectif

Un créneau permanent représente un usage récurrent d'une ressource du club attribué pour une période donnée à un titulaire et, éventuellement, à plusieurs gestionnaires autorisés.

Exemples :

- créneau réservé à l'année ;
- entraînement récurrent ;
- groupe loisir ;
- usage associatif régulier.

Le créneau est occupé par défaut. L'absence d'action du titulaire ne le libère jamais.

## Principes métier

- le titulaire doit posséder un compte PILOTOKI mais n'a pas besoin d'être licencié ;
- un créneau possède un titulaire principal et peut avoir plusieurs gestionnaires ;
- le délai d'ouverture de la gestion est paramétrable par créneau, par défaut à 48 heures ;
- dans cette fenêtre, un gestionnaire peut confirmer le créneau ou le libérer ponctuellement ;
- une libération concerne uniquement l'occurrence concernée, jamais la récurrence complète ;
- un créneau libéré réapparaît dans le moteur normal de réservation ;
- le gestionnaire peut reprendre le créneau tant qu'aucune autre occupation n'a été créée dessus ;
- si un autre utilisateur l'a réservé, la reprise est refusée ;
- toutes les actions importantes sont historisées.

## Modèle

### PermanentSlot

Décrit la récurrence :

- club ;
- ressource ;
- libellé ;
- jour de semaine ;
- heure de début et de fin ;
- période de validité ;
- délai d'ouverture de gestion ;
- état actif/inactif.

### PermanentSlotManager

Relie un compte PILOTOKI au créneau permanent. Un gestionnaire est désigné comme titulaire principal.

### PermanentSlotOccurrence

Matérialise une occurrence future de la récurrence. Etats :

- `scheduled` : occupée par défaut ;
- `confirmed` : maintien explicitement confirmé ;
- `released` : libérée ponctuellement ;
- `cancelled` : occurrence annulée par l'administration.

Chaque occurrence possède une Occupation Calendrier de type `private_use`.

### Historique

`permanent_slot_audit_log` conserve les créations, désactivations et changements d'état des occurrences.

## Intégration Calendrier

Les occurrences futures sont matérialisées en Occupations afin que le Calendrier reste l'autorité unique sur les conflits physiques.

Une occurrence `scheduled` ou `confirmed` possède une Occupation active et bloque la ressource.

Lors d'une libération ponctuelle, l'Occupation est annulée mais conservée. Cela libère physiquement la ressource tout en préservant l'historique et le lien avec l'occurrence.

Lors d'une reprise par le titulaire, l'Occupation est réactivée uniquement si aucune autre Occupation incompatible n'existe.

## Intégration Réservations

Un créneau permanent actif n'est pas affiché dans le calendrier public de réservation.

Une occurrence libérée devient un créneau disponible, y compris si l'horaire avait été volontairement retiré des horaires publics de réservation.

La réservation d'une occurrence libérée applique les règles normales du club : compte obligatoire, quota, tarif, délai minimum et contrôle des conflits. L'ouverture effective du créneau ne peut toutefois pas être postérieure à sa libération : dès qu'un titulaire le libère dans sa fenêtre autorisée, il peut être repris.

La première version impose que la durée d'un créneau permanent corresponde à la durée de réservation configurée par le club. Cette contrainte garantit qu'une occurrence libérée est reprise comme un créneau normal sans découpage ambigu.

## Parcours administrateur prévu

Administration → Réservations → Créneaux permanents :

- créer un créneau permanent ;
- choisir la ressource, le jour, l'horaire et la période ;
- choisir le titulaire principal ;
- ajouter éventuellement des gestionnaires ;
- définir le délai de gestion ;
- consulter les créneaux actifs ;
- désactiver un créneau permanent.

## Parcours utilisateur prévu

Le menu `Mes créneaux permanents` n'est visible que si le compte est gestionnaire d'au moins un créneau actif.

Pour chaque occurrence à venir :

- avant l'ouverture de la fenêtre : information uniquement ;
- dans la fenêtre : `Maintenir` ou `Libérer` ;
- après libération et avant reprise : `Reprendre mon créneau` ;
- après réservation par un tiers : état verrouillé, sans possibilité de reprise.

## Notifications prévues

Une évolution dédiée ajoutera les rappels automatiques, par exemple 48 h puis 24 h avant le créneau si aucune action explicite n'a été réalisée. Les notifications ne modifient jamais automatiquement l'état de l'occurrence.
