# 06 - Gestion des tournois

Version : 2.0

Ce document décrit le cycle de vie complet d'un tournoi.

Il définit les différentes étapes de son organisation ainsi que les règles métier associées.

---

# Objectif

Le module Tournoi permet d'organiser une compétition complète.

Depuis sa création.

Jusqu'à son archivage.

Le logiciel accompagne l'administrateur à chaque étape.

---

# Cycle de vie d'un tournoi

Un tournoi suit le cycle officiel :

Préparation

↓

Configuration

↓

Inscriptions ouvertes

↓

Inscriptions fermées

↓

Poules générées

↓

Poules validées

↓

Planning généré

↓

Planning publié

↓

En cours

↓

Terminé

↓

Archivé


`Annulé` est un état terminal distinct.

---

# Création

Lors de la création.

L'administrateur définit :

- nom
- saison
- description
- règlement
- date de début
- date de fin

Le tournoi est alors à l'état :

Préparation.

---

# Configuration

L'administrateur configure ensuite :

- les terrains utilisés
- les horaires du tournoi
- les séries
- les capacités
- les dates d'inscription

Le tournoi devient alors :

Configuré.

---

# Gestion des séries

Chaque tournoi possède sa propre liste de séries.

Pour chacune.

L'administrateur choisit :

- nom
- ordre
- couleur (future évolution)
- capacité maximale

Si capacité = 0

La série est désactivée.

Elle n'apparaît pas dans les inscriptions.

---

# Ouverture des inscriptions

À la date prévue.

Les inscriptions deviennent accessibles.

Le portail public affiche automatiquement :

"Les inscriptions sont ouvertes."

Les équipes peuvent alors s'inscrire.

---

# Gestion des inscriptions

Une équipe choisit :

- une série
- les membres exigés par le format de compétition configuré
- ses coordonnées
- ses disponibilités

Le logiciel vérifie immédiatement :

- que la série est ouverte
- qu'il reste de la place
- que les données sont valides

---

# Clôture

À la date prévue.

Les inscriptions sont fermées.

Aucune nouvelle équipe ne peut s'inscrire.

L'administrateur conserve néanmoins la possibilité :

- d'ajouter une équipe
- de modifier une équipe
- de supprimer une équipe

---

# Génération des poules

Les poules sont générées.

Série par série.

Le moteur prend en compte :

- les disponibilités
- les contraintes
- les capacités

Le logiciel produit :

- les poules
- les diagnostics

L'administrateur peut :

- accepter
- modifier
- regénérer

---

# Validation des poules

Une fois validées.

Les équipes ne peuvent plus changer de série.

Les poules deviennent définitives.

---

# Génération du planning

Le moteur vérifie :

que toutes les séries possèdent des poules.

Puis.

Il construit le planning complet.

Toutes les séries sont générées simultanément.

---

Le planning respecte :

- les terrains
- les horaires
- les disponibilités
- les conflits

---

# Validation du planning

Le calendrier est présenté.

L'administrateur peut :

- déplacer un match
- changer un terrain
- modifier un horaire

Le logiciel contrôle immédiatement les conflits.

---

# Publication

Une fois validé.

Le planning devient public.

Les matchs apparaissent automatiquement.

Les réservations sont bloquées sur les créneaux concernés.

---

# Déroulement du tournoi

Pendant la compétition.

L'administrateur saisit les résultats.

Les classements sont recalculés.

Les prochains matchs sont mis à jour.

Le portail public est actualisé.

---

# Clôture

Lorsque tous les matchs sont terminés.

Le tournoi passe à l'état :

Terminé.

Toutes les statistiques sont conservées.

---

# Archivage

Le tournoi devient consultable.

Mais plus modifiable.

Toutes les données restent disponibles.

Le logiciel ne supprime jamais un tournoi.

---

# Annulation

Un tournoi peut être annulé.

Les réservations redeviennent disponibles.

Les inscriptions sont conservées à titre historique.

---

# Contrôles automatiques

Le logiciel vérifie notamment :

✓ Le tournoi possède au moins une série.

✓ Les dates sont cohérentes.

✓ Les capacités sont valides.

✓ Les inscriptions sont ouvertes.

✓ Les poules existent.

✓ Le planning est valide.

✓ Aucun conflit de terrain.

✓ Aucun conflit d'horaire.

---

# Tableau de progression

Le logiciel affiche en permanence l'état d'avancement.

Exemple :

Configuration

✓

Inscriptions

✓

Poules

✓

Planning

⏳

Résultats

🔒

Archivage

🔒

---

# Principe fondamental

Le logiciel guide toujours l'organisateur.

Il empêche les erreurs.

Il vérifie les prérequis.

Il accompagne chaque étape jusqu'à la fin du tournoi.

---

# Règles consolidées V2.1

Cycle : Préparation → Configuration → Inscriptions ouvertes → Inscriptions fermées → Poules générées → Poules validées → Planning généré → Planning publié → En cours → Terminé → Archivé. `Annulé` est un état terminal parallèle.

## Transitions contrôlées
CanConfigureTournamentPolicy, CanOpenRegistrationsPolicy, CanCloseRegistrationsPolicy, CanGeneratePoolsPolicy, CanValidatePoolsPolicy, CanGeneratePlanningPolicy, CanPublishPlanningPolicy, CanStartTournamentPolicy, CanFinishTournamentPolicy, CanArchiveTournamentPolicy et CanCancelTournamentPolicy.

## Séries
Une série possède `enabled` et `capacity`. `enabled = false` signifie indisponible ; avec `enabled = true`, la capacité est strictement positive et ne peut être inférieure au nombre d'équipes déjà acceptées.

## Génération des poules
Le moteur distingue contraintes obligatoires, préférences, diagnostics et score de qualité.

## Annulation
L'annulation du tournoi annule les Occupations futures créées par le tournoi. Elle ne supprime ni les inscriptions, ni les poules, ni les résultats conservés à titre historique.
