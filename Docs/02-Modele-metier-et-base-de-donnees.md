# 02 - Modèle métier et base de données

Version : 2.0

Ce document définit le modèle métier officiel de Pelote Manager.

Aucune table SQL ne doit être créée avant validation de ce document.

Le schéma SQL sera une conséquence de ce modèle.

Jamais l'inverse.

---

# 1. Philosophie

La base de données ne représente pas l'interface.

Elle représente le fonctionnement réel du club.

Chaque table correspond à un concept métier.

Chaque relation représente une règle métier.

Aucune table technique ne doit exister sans justification métier.

---

# 2. Les grands domaines

1. Club et ressources
2. Personnes et adhésions
3. Calendrier
4. Réservations
5. Tournois
6. Planification sportive
7. Résultats et classements
8. Communication et publication

---

# 3. Domaine Club

Le club est la racine du logiciel.

Il possède :

- des installations
- des utilisateurs
- des paramètres
- des saisons
- des tournois
- des réservations
- des évènements

Un seul club est prévu aujourd'hui.

L'architecture permettra cependant d'en gérer plusieurs.

---

# 4. Domaine Saison

Une saison représente une année sportive.

Exemple :

2026

Elle regroupe :

- les tournois
- les statistiques
- les archives

Une saison possède :

Nom

Date début

Date fin

Etat

---

# 5. Domaine Tournoi

Le tournoi est indépendant.

Chaque tournoi possède :

Nom

Description

Affiche

Date ouverture inscriptions

Date fermeture inscriptions

Début

Fin

Etat

Règlement

Terrains utilisés

Horaires

Séries

Equipes

Poules

Planning

Résultats

Classements

---

Etat possible :

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

# 6. Domaine Série

Une série appartient à un tournoi.

Une série possède :

Nom

Ordre


Couleur

Capacité maximale

Visible

Archivée

Exemples :

1ère Série

2ème Série

3ème Série

4ème Série

Féminine

Mixte

Loisirs

Jeunes

---

Une série ne contient aucune logique.

Elle ne fait que classifier les équipes.

---

# 7. Domaine Joueur

## Personne
Personne connue du club, avec ou sans compte.

## Compte utilisateur
Identité d'accès permettant l'authentification.

## Adhésion / Licence
Relation entre une personne et le club pour une période donnée.

## Joueur
Rôle sportif d'une personne dans une compétition.

- une personne peut exister sans compte ;
- un compte peut être lié à une personne ;
- une licence appartient à une personne et à une saison ;
- un joueur de tournoi référence une personne ;
- les cycles de vie sont indépendants.

---

# 8. Domaine Equipe

Une équipe est créée pour un tournoi.

Elle appartient :

à une série

d'un tournoi.

Elle contient :

le nombre de joueurs imposé par le format de compétition configuré

Pour la pala par équipes utilisée actuellement, ce nombre est égal à deux

mais l'architecture permettra demain :

1 joueur

3 joueurs

4 joueurs

sans modification majeure.

Une équipe possède :

date d'inscription

validation

commentaires

disponibilités

---

# 9. Domaine Disponibilités

Les disponibilités ne sont pas des créneaux.

Elles sont des règles.

Exemple :

Tous les mardis

17h30 →22h30

Tous les jeudis

19h30 →22h30

Jamais le vendredi

Le moteur génère ensuite les créneaux utilisables.

Cela évite de stocker des milliers de lignes.

---

# 10. Domaine Poules

Une poule appartient :

à une série

d'un tournoi.

Elle contient :

des équipes.

Une poule ne connaît pas le planning.

---

# 11. Domaine Match

Un match appartient :

à une poule.

Il possède :

Equipe A

Equipe B

Etat

Score

Arbitre (plus tard)

Terrain

Horaire

---

Etat :

A programmer

Programmé

En cours

Terminé

Validé

Annulé

Archivé

---

# 12. Domaine Classement

Le classement n'est jamais stocké.

Il est toujours calculé.

Les seules données persistées sont :

les résultats.

---

# 13. Domaine Installation

Une installation représente un lieu.

Exemple :

Trinquet

Petit fronton

Salle

Chaque installation possède :

des terrains.

---

# 14. Domaine Terrain

Un terrain appartient à une installation.

Il possède :

Nom

Type

Etat

Visible

---

# 15. Domaine Calendrier

Le Calendrier est l'autorité unique sur l'occupation des ressources.

Il manipule : Resource, TimeRange, Occupation et Conflict.

---

# 16. Domaine Evènement

Une Occupation possède au minimum : identifiant, ressource, période, type, état, visibilité, référence vers le domaine d'origine, date de création et date de modification.

Types possibles : Reservation, TournamentMatch, Training, ClubEvent, Maintenance, Closure et PrivateUse.

Le type informe sur l'origine de l'Occupation mais ne transfère aucune règle métier au Calendrier.

---

# 17. Domaine Réservation

Une réservation est un agrégat métier autonome.
Lorsqu'elle est confirmée, elle demande la création d'une Occupation dans le domaine Calendrier.
La réservation reste propriétaire du client, des règles de réservation, du paiement, des commentaires et de son état métier.
Le Calendrier reste propriétaire de l'occupation physique et des conflits.

---

# 18. Domaine Résultat

Un résultat appartient à un match.

Il contient :

les sets

le score

la validation

Le classement est recalculé automatiquement.

---

# 19. Domaine Communication

Actualités

Evènements

Photos

Affiches

Documents

---

# 20. Domaine Notifications

Prévu pour V3.

SMS

Emails

Push

WhatsApp

---

# 21. Domaine Paiement

Prévu pour V3.

Stripe

HelloAsso

Paiement club

Facturation

---

# Conclusion

Le logiciel ne repose pas sur des tables.

Il repose sur un modèle métier.

Les tables SQL seront créées uniquement pour représenter ce modèle.

---

# Value Objects

- TimeRange
- Duration
- AvailabilityRule
- Visibility
- Capacity
- CompetitionFormat
- Score
- TournamentPeriod
- ReservationWindow

Les modèles de persistance ne sont jamais utilisés directement par le domaine. Des mappers assurent la conversion entre lignes Supabase et modèles métier.
