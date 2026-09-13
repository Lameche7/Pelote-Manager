# Créneaux permanents

Statut : implémenté — socle métier, interfaces V1, rappels et diffusion des créneaux libérés
Version : 1.3
Date : 2026-09-13

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

`permanent_slot_audit_log` conserve les créations, modifications, désactivations et changements d'état des occurrences.

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

## Parcours administrateur V1

Administration → Réservations → Créneaux permanents :

- créer un créneau permanent ;
- choisir la ressource, le jour, l'horaire et la période ;
- choisir le titulaire principal parmi les comptes PILOTOKI, licenciés ou non ;
- ajouter éventuellement des gestionnaires ;
- définir le délai de gestion ;
- modifier les paramètres d'un créneau existant ;
- consulter les créneaux actifs et inactifs ;
- désactiver un créneau permanent et ses occurrences futures.

La durée de fin est calculée depuis la durée standard de réservation configurée par le club afin que toute occurrence libérée puisse entrer directement dans le moteur de réservation normal.

## Parcours utilisateur V1

Le menu `Mes créneaux permanents` n'est visible dans `Mon espace` que si le compte est gestionnaire d'au moins un créneau actif encore valide.

Pour chaque occurrence à venir :

- avant l'ouverture de la fenêtre : information uniquement avec la date d'ouverture de la gestion ;
- dans la fenêtre : `Maintenir` ou `Libérer ce créneau` ;
- après libération et avant reprise par un tiers : `Reprendre mon créneau` ;
- après réservation par un tiers : état `Libéré · repris par un autre joueur`, sans possibilité de reprise.

L'absence d'action ne change jamais l'état physique du créneau : l'occupation reste active et la ressource reste bloquée.

## API d'interface

Les interfaces utilisent uniquement des RPC dédiées ; elles n'accèdent jamais directement aux tables de créneaux permanents.

- `admin_list_permanent_slots()` : liste d'administration ;
- `admin_create_permanent_slot(...)` : création et matérialisation des occurrences ;
- `admin_update_permanent_slot(...)` : modification des paramètres et resynchronisation des occurrences futures ;
- `admin_deactivate_permanent_slot(...)` : désactivation ;
- `admin_list_permanent_slot_candidates()` : comptes pouvant être désignés titulaires ou gestionnaires ;
- `has_my_permanent_slots()` : détermine si le menu personnel doit être affiché ;
- `list_my_permanent_slot_occurrences(...)` : occurrences accessibles au gestionnaire connecté ;
- `set_my_permanent_slot_occurrence_status(...)` : maintien, libération et reprise.

## Rappels automatiques

Les rappels utilisent exclusivement le moteur central de notifications :

`club_communications → communication_deliveries → Mon espace / Notifications → Web Push`.

Pour une occurrence encore `scheduled` :

- un premier rappel est publié à l'ouverture de la fenêtre de gestion configurée pour le créneau ;
- si cette fenêtre est supérieure à 24 heures et qu'aucune décision n'a été prise, un second rappel est publié 24 heures avant le début ;
- une fenêtre de 24 heures ne génère qu'un seul rappel ;
- les rappels sont adressés au titulaire principal et à tous les gestionnaires autorisés ;
- une action `Maintenir`, `Libérer` ou une annulation administrative archive les rappels encore actifs et empêche tout nouveau rappel pour l'occurrence ;
- l'absence de réponse ne libère jamais le créneau.

Le traitement est relancé toutes les 15 minutes. La table `permanent_slot_reminder_events` garantit l'idempotence par occurrence et type de rappel.

Le centre de notifications ouvre directement `/mon-espace/creneaux-permanents` pour ces rappels.

## Notification d'un créneau libéré

Lorsqu'une occurrence passe réellement à l'état `released`, PILOTOKI publie immédiatement une communication de disponibilité dans le moteur central de notifications.

- destinataires : tous les membres actifs du club disposant d'un compte PILOTOKI ;
- le gestionnaire qui vient de libérer le créneau est exclu de cette diffusion générale ;
- les autres gestionnaires du créneau peuvent recevoir l'information comme les autres membres ;
- la notification indique la ressource, la date et l'heure du créneau sans exposer le libellé privé du groupe ;
- le bouton `Réserver ce créneau` ouvre l'espace normal de réservation ;
- une répétition de l'action `Libérer` sur une occurrence déjà libérée ne produit pas de doublon ;
- si l'occurrence est reprise par son gestionnaire puis libérée à nouveau, une nouvelle notification est publiée, car le créneau redevient réellement disponible.

Cette diffusion réutilise `club_communications` et `communication_deliveries` afin de bénéficier du centre de notifications et du Web Push existants.
