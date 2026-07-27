# Architecture officielle

Statut : Accepté
Version : 2.1
Date : 2026-07-27
Remplace : l'organisation Feature First plaçant le métier dans les features

## Dépendances

```text
Presentation / Features
↓
Application
↓
Domain
↑
Infrastructure
```

Le Domain est pur. Application orchestre ses cas d'usage. Infrastructure implémente les interfaces du Domain ou d'Application. Les Features portent les écrans, composants, hooks, routes et view-models ; elles ne contiennent ni règles métier, ni repositories abstraits, ni moteurs.

## Structure cible

```text
src/
├── app/ # composition et routeur central
├── application/ # cas d'usage et DTO
├── domain/ # huit domaines de la Domain Map
├── features/ # présentation par fonctionnalité
├── infrastructure/ # Supabase, auth, stockage, repositories, logger
├── shared/
├── assets/
├── styles/
└── types/
```

## Building Blocks

Entity, Aggregate Root, Value Object, Policy, Domain Service, Domain Event, Repository interface, Factory, Specification et DTO applicatif.

Les modèles de persistance sont convertis par des mappers. Les opérations cohérentes multi-objets sont atomiques. Les événements de domaine expriment un fait passé et restent indépendants de la technique.
