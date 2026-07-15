# 01 - Architecture générale

# Pelote Manager V2

Version : 2.0

Statut : Référence d'architecture

---

# 1. Objectif

Ce document définit l'architecture officielle de Pelote Manager.

Aucune fonctionnalité ne doit être développée sans respecter cette architecture.

Toute évolution importante devra être documentée dans `DECISIONS.md`.

L'objectif est de construire un logiciel :

- évolutif
- maintenable
- testable
- découplé
- indépendant des technologies utilisées

Le logiciel doit pouvoir évoluer pendant plusieurs années sans remise en question de ses fondations.

---

# 2. Principes fondamentaux

L'ensemble du projet repose sur les principes suivants.

## 2.1 Une seule source de vérité

Chaque information ne doit exister qu'à un seul endroit.

Exemples :

- un tournoi est stocké une seule fois
- une réservation est stockée une seule fois
- un utilisateur est stocké une seule fois

Les autres parties du logiciel utilisent uniquement cette référence.

---

## 2.2 Le métier est indépendant

La logique métier ne dépend jamais :

- de React
- de Supabase
- du navigateur
- d'une API
- d'un framework

Le métier doit pouvoir être exécuté :

- dans Node.js
- dans un Worker
- dans un test unitaire

sans modification.

---

## 2.3 Les composants React sont passifs

Les composants React ne contiennent jamais de logique métier.

Ils :

- affichent des données
- collectent des informations
- déclenchent des actions

Ils ne prennent jamais de décision métier.

---

## 2.4 Les moteurs sont purs

Un moteur est une fonction déterministe.

Même entrée

↓

Même sortie

Toujours.

Les moteurs ne lisent jamais directement la base de données.

Ils ne réalisent jamais de requête HTTP.

Ils ne connaissent pas Supabase.

---

## 2.5 Les données circulent dans un seul sens

Infrastructure

↓

Repositories

↓

Services

↓

Interface

Jamais l'inverse.

---

# 3. Les domaines métier

Le logiciel est organisé autour de quatre domaines.

Ils représentent la structure fonctionnelle du club.

---

## Domaine Club

Le domaine Club regroupe tout ce qui existe toute l'année.

Il contient notamment :

- informations générales
- horaires
- terrains
- réservations
- actualités
- restauration
- évènements
- utilisateurs
- licenciés

---

## Domaine Tournoi

Le domaine Tournoi gère toutes les compétitions.

Il contient :

- éditions
- inscriptions
- équipes
- disponibilités
- séries
- poules
- planning
- matchs
- résultats
- classements

Chaque tournoi est indépendant.

Le logiciel peut gérer plusieurs tournois simultanément ou successivement.

---

## Domaine Communication

Le domaine Communication diffuse les informations.

Il comprend :

- affichage TV
- site public
- actualités
- résultats publics
- calendrier public
- galerie photos

---

## Domaine Administration

Le domaine Administration permet de configurer le logiciel.

Il comprend :

- paramètres
- sécurité
- rôles
- utilisateurs
- configuration générale

---

# 4. Les couches techniques

Le logiciel est organisé en quatre couches.

```
Interface

↓

Application

↓

Domaine

↓

Infrastructure
```

---

## Interface

Responsabilités :

- affichage
- navigation
- formulaires
- composants

Elle ne connaît jamais directement la base de données.

---

## Application

Cette couche orchestre les actions.

Elle :

- appelle les services
- gère les cas d'usage
- prépare les réponses

Elle ne contient pas les règles métier.

---

## Domaine

Le domaine contient toute l'intelligence du logiciel.

C'est la couche la plus importante.

Elle contient :

- moteurs
- modèles métier
- validations
- règles métier

Cette couche ne dépend d'aucune technologie.

---

## Infrastructure

Elle contient :

- Supabase
- Authentification
- Storage
- API externes
- Paiement (plus tard)
- Notifications

Cette couche peut être remplacée sans modifier le domaine.

---

# 5. Architecture Feature First

Le projet est organisé par domaine fonctionnel.

Chaque fonctionnalité possède son propre espace.

Structure cible :

```
src/

app/

routes/

features/

shared/

core/

infrastructure/

assets/

styles/

types/
```

---

# 6. Structure interne d'une fonctionnalité

Chaque fonctionnalité possède sa propre organisation.

Exemple :

```
features/

reservation/

components/

routes/

hooks/

services/

repositories/

engine/

types/

validators/

constants/
```

Chaque fonctionnalité est autonome.

---

# 7. Le noyau métier

Le dossier core contient les moteurs.

Ils représentent le cœur du logiciel.

```
core/

calendar/

planning/

pool/

ranking/

availability/

```

Ces moteurs ne connaissent jamais React.

Ils manipulent uniquement des objets métier.

---

# 8. Infrastructure

Le dossier infrastructure contient uniquement les dépendances techniques.

Exemple :

```
infrastructure/

supabase/

auth/

storage/

logger/

config/

```

Le domaine ne dépend jamais de ce dossier.

---

# 9. Les repositories

Les repositories sont responsables de l'accès aux données.

Ils savent :

- lire
- écrire
- modifier
- supprimer

Ils ne réalisent aucun calcul.

---

# 10. Les services

Les services orchestrent les cas d'utilisation.

Exemple :

GenerateTournamentPlanning()

↓

lit les équipes

↓

lit les disponibilités

↓

appelle Planning Engine

↓

sauvegarde le résultat

Le calcul est toujours effectué par un moteur.

---

# 11. Le calendrier

Le calendrier constitue le cœur du logiciel.

Tout est représenté sous forme d'évènement.

Exemples :

- réservation
- match
- entraînement
- fermeture
- animation
- restauration
- maintenance

Le moteur calendrier est l'unique responsable de la gestion des conflits.

---

# 12. Les tournois

Le logiciel ne gère pas un tournoi.

Il gère une collection de tournois.

Chaque tournoi possède :

- ses paramètres
- ses équipes
- ses poules
- son planning
- ses résultats

Les anciennes éditions sont archivées.

Aucune donnée n'est supprimée.

---

# 13. Les modèles

Deux types de modèles existent.

## Modèles métier

Ils représentent le fonctionnement du logiciel.

Exemple :

Tournament

Reservation

Pool

Match

---

## Modèles de persistance

Ils représentent la base de données.

Exemple :

TournamentRow

ReservationRow

MatchRow

Ils ne doivent jamais être utilisés directement dans le domaine.

---

# 14. Gestion des erreurs

Les erreurs métier sont typées.

Exemples :

ValidationError

ReservationError

PlanningError

PoolGenerationError

ConfigurationError

Les erreurs techniques sont gérées séparément.

---

# 15. Journalisation

Le logiciel utilise un service de journalisation unique.

Aucun console.log dans le domaine métier.

Toutes les traces passent par Logger.

---

# 16. Tests

Les moteurs doivent être testables indépendamment.

Chaque moteur possède :

- tests unitaires
- cas limites
- jeux de données

Une fonctionnalité n'est jamais considérée comme terminée sans tests.

---

# 17. Documentation

Toute évolution importante entraîne la mise à jour :

- du DSFT
- de DECISIONS.md

La documentation fait partie intégrante du logiciel.

---

# 18. Evolutivité

L'architecture doit permettre, sans réécriture majeure :

- plusieurs tournois
- plusieurs saisons
- plusieurs terrains
- plusieurs types de réservations
- paiement en ligne
- application mobile
- affichage TV
- statistiques avancées
- exports PDF et Excel
- API publique

---

# Conclusion

Cette architecture constitue la référence officielle de Pelote Manager.

Aucune fonctionnalité ne doit être développée en contradiction avec ces principes.