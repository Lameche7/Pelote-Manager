# 13 - Architecture technique

Version : 2.0

Ce document décrit l'architecture technique de Pelote Manager.

Il définit les principes de développement du projet.

Il constitue la référence pour toute évolution technique.

---

# Objectif

L'architecture doit permettre :

- une maintenance simple ;
- une évolution progressive ;
- une forte séparation des responsabilités ;
- une excellente testabilité.

Le projet privilégie la simplicité.

---

# Philosophie

Le logiciel est découpé en couches indépendantes.

Chaque couche possède une responsabilité unique.

Une couche ne doit jamais connaître les détails d'une autre couche.

---

# Architecture générale

Le projet est organisé autour des composants suivants.

Interface utilisateur

↓

Services

↓

Moteurs métier

↓

Accès aux données

↓

Supabase

Chaque couche communique uniquement avec la couche immédiatement inférieure.

---

# Frontend

Le frontend est développé avec :

- React
- TypeScript
- Vite

L'interface est composée de composants réutilisables.

Chaque composant possède une responsabilité clairement définie.

---

# Backend

Le backend repose sur Supabase.

Il fournit notamment :

- l'authentification ;
- la base de données PostgreSQL ;
- le stockage ;
- les fonctions SQL ;
- les politiques de sécurité.


Le frontend ne dialogue jamais directement avec PostgreSQL.

Toutes les opérations passent par Supabase.

---

# Moteurs métier

La logique métier est isolée dans plusieurs moteurs indépendants.

Notamment :

- Pool Engine
- Planning Engine
- Ranking Engine
- Reservation Engine (à venir)

Ces moteurs :

- ne connaissent pas React ;
- ne connaissent pas Supabase ;
- ne connaissent pas l'interface.

Ils manipulent uniquement des objets métier.

---

# Services

Les services constituent l'interface entre :

- le frontend ;
- les moteurs ;
- Supabase.

Ils centralisent :

- les appels réseau ;
- les transformations de données ;
- les traitements communs.

---

# Modèle de données

Les objets manipulés par le logiciel sont représentés sous forme de modèles TypeScript.

Chaque modèle possède une définition unique.

Les modèles doivent rester cohérents avec le schéma SQL.

---

# Gestion de l'état

L'état de l'application est limité au strict nécessaire.

Les données persistantes proviennent toujours de Supabase.

Le frontend ne conserve que les informations utiles à l'affichage.

---

# Structure du projet

Le projet est organisé par domaines fonctionnels.

Exemple :

src/

components/

pages/

features/

services/

engines/

hooks/

types/

utils/

Chaque dossier possède une responsabilité clairement identifiée.

---

# Réutilisation

Toute logique utilisée à plusieurs endroits doit être factorisée.

Le copier-coller est interdit.

Une fonctionnalité ne doit exister qu'à un seul endroit.

---

# Dépendances

Chaque nouvelle dépendance doit être justifiée.

Le projet privilégie les bibliothèques :

- largement utilisées ;
- maintenues ;
- documentées.

Une dépendance inutile ne doit jamais être ajoutée.

---

# Configuration

Toutes les informations sensibles sont stockées dans des variables d'environnement.

Aucune clé secrète ne doit apparaître dans le code source.

---

# Journalisation

Le logiciel distingue :

- les informations ;
- les avertissements ;
- les erreurs.

Les messages de développement ne doivent jamais être visibles par les utilisateurs.

---

# Performances

L'application doit rester fluide.

Les calculs importants sont réalisés dans les moteurs métier.

L'interface utilisateur ne doit jamais contenir de logique complexe.

---

# Sécurité

Toutes les validations importantes sont réalisées côté serveur.

Le frontend améliore l'expérience utilisateur.

Il ne constitue jamais un mécanisme de sécurité.

---

# Tests

Les moteurs métier doivent pouvoir être testés indépendamment.

L'architecture doit permettre :

- les tests unitaires ;
- les tests d'intégration ;
- les tests fonctionnels.

---

# Évolutivité

L'ajout d'une nouvelle fonctionnalité doit avoir un impact limité.

Une évolution ne doit jamais nécessiter une réécriture complète du projet.

---

# Documentation

Toute évolution importante doit être accompagnée d'une mise à jour de la documentation.

Le code et la documentation doivent toujours rester synchronisés.

---

# Principe fondamental

L'architecture technique est au service du métier.

Le code doit rester simple, lisible et évolutif.

La priorité n'est jamais la technologie.

La priorité est la pérennité du logiciel.

---

# Architecture cible V2.1

```text
Presentation / Features
↓
Application
↓
Domain
↑
Infrastructure
```

L'Application dépend du Domain. L'Infrastructure implémente les interfaces définies par le Domain ou l'Application. Le Domain ne dépend d'aucune couche. Les Features ne dialoguent pas directement avec Supabase.

```text
src/
├── app/
├── application/
│ ├── club/
│ ├── reservations/
│ ├── tournaments/
│ └── shared/
├── domain/
│ ├── club/
│ ├── people/
│ ├── calendar/
│ ├── reservations/
│ ├── tournaments/
│ ├── planning/
│ ├── ranking/
│ └── communication/
├── features/
├── infrastructure/
│ ├── supabase/
│ ├── repositories/
│ ├── auth/
│ ├── storage/
│ └── logger/
└── shared/
```

Application Services / Use Cases orchestrent ; Domain Services portent la logique sans entité naturelle ; Infrastructure Services portent les détails techniques. Les entrées et sorties des cas d'usage sont des DTO, ni entités ni lignes SQL.

Les cas d'usage créant plusieurs objets cohérents sont atomiques, notamment la publication du planning et de toutes ses Occupations.

Événements de domaine : TournamentRegistrationsOpened, PoolsValidated, PlanningPublished, ReservationConfirmed, ReservationCancelled et MatchResultValidated. Ils expriment un fait passé sans dépendance technique.
