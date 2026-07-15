# AI_INSTRUCTIONS.md

# Pelote Manager V2
## Règles de développement pour les assistants IA (Copilot, ChatGPT, Codex...)

---

# Objectif

Pelote Manager est un logiciel professionnel destiné à gérer l'activité complète du Trinquet du PCL Lourdais.

L'objectif n'est pas simplement de développer une application React.

L'objectif est de produire un logiciel robuste, maintenable, évolutif et documenté.

Toutes les décisions doivent privilégier :

- la simplicité
- la lisibilité
- la stabilité
- l'évolutivité

---

# Lecture obligatoire

Avant toute modification du code, l'assistant DOIT lire :

docs/

et comprendre :

- l'architecture
- les règles métier
- les parcours utilisateurs
- le modèle de données

Aucun développement ne doit être réalisé sans respecter ces documents.

---

# Philosophie du projet

Le logiciel est construit autour du CLUB.

Le tournoi n'est qu'un module du logiciel.

Toutes les fonctionnalités doivent être pensées pour fonctionner plusieurs années.

Aucune donnée ne doit être supprimée.

Les tournois sont archivés.

---

# Développement par étapes

Il est STRICTEMENT interdit de développer plusieurs fonctionnalités en même temps.

Chaque fonctionnalité suit obligatoirement le cycle suivant :

1.
Analyse

↓

2.
Proposition d'architecture

↓

3.
Validation utilisateur

↓

4.
Développement

↓

5.
Tests

↓

6.
Validation finale

↓

7.
Commit Git

Seulement ensuite on passe à la fonctionnalité suivante.

---

# Interdictions

Ne jamais :

- modifier plusieurs modules simultanément

- corriger plusieurs bugs dans le même commit

- créer du code dupliqué

- contourner un bug

- masquer une erreur

- ajouter du code "temporaire"

- laisser du code mort

- utiliser any

- utiliser ts-ignore

- désactiver TypeScript

- désactiver ESLint

- désactiver les tests

---

# Documentation

Toute nouvelle fonctionnalité importante doit mettre à jour :

docs/

si nécessaire.

Le code ne doit jamais devenir la seule documentation.

---

# Architecture

Respecter strictement l'architecture définie dans :

01-Architecture-generale.md

Ne jamais déplacer des fichiers sans justification.

Ne jamais casser la séparation :

UI

Services

Repositories

Algorithmes

Infrastructure

---

# React

Les composants React :

ne contiennent AUCUNE logique métier.

Ils :

affichent

déclenchent des actions

rendent des composants

Toute la logique métier est située dans :

services/

engine/

repositories/

---

# Base de données

Toute modification de structure passe par :

une migration Supabase.

Interdiction :

de modifier une table manuellement.

Interdiction :

de créer des colonnes depuis SQL Editor.

Toute évolution doit être versionnée.

---

# SQL

Les migrations doivent être :

idempotentes lorsque c'est possible.

Toutes les contraintes doivent être explicites.

Les clés étrangères sont obligatoires.

Les index doivent être justifiés.

---

# Algorithmes

Les algorithmes doivent être indépendants de React.

Ils doivent pouvoir être exécutés :

sans navigateur

sans interface

sans Supabase

Ils doivent être testables.

---

# Planning

Le moteur de planning est indépendant.

Il reçoit :

des équipes

des disponibilités

des terrains

des paramètres

Il retourne :

une planification.

Il ne connaît pas React.

---

# Génération des poules

Même principe.

Le moteur reçoit uniquement :

des données.

Il ne lit jamais directement Supabase.

---

# Résultats

Les classements sont calculés.

Ils ne sont jamais stockés.

Le stockage concerne uniquement :

les résultats des matchs.

Les classements sont toujours recalculés.

---

# Réservations

Les réservations utilisent le moteur calendrier.

Le tournoi utilise le même moteur.

Le calendrier est unique.

---

# Tests

Avant de considérer une fonctionnalité terminée :

les tests doivent réussir.

Les cas limites doivent être vérifiés.

Les erreurs doivent être gérées.

---

# Communication

Avant toute génération de code :

l'assistant explique :

- ce qu'il a compris

- ce qu'il va faire

- les fichiers concernés

- les impacts

Puis attend la validation.

---

# Qualité attendue

Le logiciel doit être développé comme un produit professionnel.

Le but n'est pas d'écrire rapidement du code.

Le but est de construire un logiciel qui pourra évoluer pendant plusieurs années.

Chaque décision doit privilégier :

la simplicité

la robustesse

la maintenance

la lisibilité.

---

# Principe fondamental

Si une fonctionnalité n'est pas complètement comprise :

NE PAS CODER.

Poser des questions.

Valider.

Puis seulement développer.

Il vaut mieux perdre une heure de conception qu'une semaine de corrections.
