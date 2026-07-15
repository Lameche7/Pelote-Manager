# 16 - Glossaire métier

Version : 2.0

Ce document définit le vocabulaire officiel de Pelote Manager.

Chaque terme possède une seule définition.

L'ensemble du logiciel, de la documentation et du code doit utiliser ces définitions.

---

# A

## Administrateur

Utilisateur disposant de tous les droits sur l'application.

Il peut créer, modifier et supprimer toutes les données.

---

## Affectation

Association entre une équipe et une poule.

Une équipe ne peut être affectée qu'à une seule poule dans un même tournoi.

---

## Algorithme de planification

Moteur chargé de construire automatiquement le planning du tournoi.

Il respecte les contraintes métier définies par le logiciel.

---

# C

## Calendrier

Le calendrier est le cœur du logiciel.

Il regroupe tous les événements.

Il est utilisé aussi bien pour :

- les réservations
- les matchs
- les entraînements
- les fermetures
- les animations

Le calendrier est unique.

---

## Capacité

Nombre maximal d'équipes autorisées dans une série.

Une capacité égale à zéro signifie que la série est désactivée pour le tournoi.

---

## Club

Organisation utilisant le logiciel.

Dans la V2 un seul club est prévu.

L'architecture permettra cependant d'en gérer plusieurs.

---

## Créneau

Intervalle de temps disponible.

Un créneau possède :

- une date
- une heure de début
- une heure de fin

Le logiciel ne manipule jamais de simple heure.

Toujours un intervalle.

---

# D

## Disponibilité

Période pendant laquelle une équipe accepte de jouer.

Les disponibilités servent au moteur de génération des poules et du planning.

---

## Domaine

Grand ensemble fonctionnel du logiciel.

Les domaines sont :

- Club
- Tournoi
- Communication
- Administration

---

# E

## Édition

Instance d'un tournoi pour une année donnée.

Exemple :

Tournoi interne 2026

Tournoi interne 2027

Chaque édition possède ses propres données.

---

## Équipe

Groupe de joueurs inscrit dans une série d'un tournoi.

Une équipe appartient toujours à un tournoi.

Une équipe peut changer d'effectif d'une édition à l'autre.

---

## Événement

Objet représentant une occupation du calendrier.

Les principaux types sont :

- Match
- Réservation
- Fermeture
- Entraînement
- Animation
- Maintenance

Tous les événements utilisent le même moteur de calendrier.

---

# I

## Installation

Lieu appartenant au club.

Une installation contient un ou plusieurs terrains.

Exemple :

Trinquet

Fronton

Salle polyvalente

---

# J

## Joueur

Personne participant aux compétitions.

Un joueur peut participer à plusieurs éditions de tournoi.

Un joueur peut être licencié ou non.

---

# L

## Licencié

Utilisateur reconnu par le club.

Il bénéficie de règles particulières définies par l'administrateur.

---

# M

## Match

Rencontre entre deux équipes.

Un match appartient à une poule.

Il possède un état.

---

## Moteur

Composant métier indépendant.

Un moteur reçoit des données en entrée.

Il retourne un résultat.

Il ne dépend ni de React ni de Supabase.

Exemples :

Pool Engine

Planning Engine

Ranking Engine

Calendar Engine

---

# P

## Paramètres du club

Configuration permanente.

Elle concerne notamment :

- les horaires
- les terrains
- les règles de réservation

---

## Paramètres du tournoi

Configuration spécifique à une édition.

Elle définit notamment :

- les dates
- les séries
- les horaires du tournoi
- les terrains utilisés

---

## Planning

Organisation chronologique des matchs.

Le planning est généré automatiquement.

Il peut ensuite être ajusté manuellement.

---

## Poule

Groupe d'équipes appartenant à une même série.

Toutes les équipes d'une poule se rencontrent.

---

# R

## Réservation

Occupation d'un terrain hors tournoi.

Une réservation est représentée par un événement du calendrier.

---

## Ressource

Élément pouvant être réservé.

Aujourd'hui :

- un terrain

Demain :

- une salle
- un espace de réunion

---

## Résultat

Score officiel d'un match.

Les résultats servent au calcul des classements.

---

# S

## Saison

Période sportive regroupant plusieurs tournois.

Une saison couvre généralement une année.

---

## Série

Catégorie de compétition.

Exemples :

- 1ère Série
- 2ème Série
- Féminine
- Mixte

Une série appartient toujours à une édition de tournoi.

---

# T

## Terrain

Surface de jeu.

Un terrain appartient à une installation.

Il peut être utilisé :

- pour un match
- pour une réservation
- pour un entraînement

---

## Tournoi

Compétition organisée par le club.

Un tournoi possède :

- ses équipes
- ses séries
- ses poules
- son planning
- ses résultats

---

# U

## Utilisateur

Personne possédant un compte.

Les principaux rôles sont :

- Visiteur
- Utilisateur
- Licencié
- Administrateur

---

# V

## Validation

Action consistant à rendre définitive une étape.

Exemples :

Validation des poules

Validation du planning

Validation des résultats

---

# Règle fondamentale

Tout nouveau terme introduit dans le logiciel doit être ajouté à ce glossaire.

Le vocabulaire utilisé dans :

- le code
- la documentation
- les interfaces

doit toujours respecter les définitions de ce document.

Le glossaire constitue la référence officielle du langage métier de Pelote Manager.