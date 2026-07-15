# Pelote Manager

Pelote Manager est une application dédiée à la gestion des activités d'un club de pelote. Ce projet est structuré de manière à faciliter le développement, la maintenance et l'évolutivité de l'application. 

## Structure du projet

Le projet est organisé en plusieurs dossiers, chacun ayant un rôle spécifique :

- **src/app** : Contient la configuration principale de l'application React, y compris les paramètres globaux et les initialisations nécessaires.
- **src/assets** : Destiné à contenir les ressources statiques telles que les images, les polices et les fichiers de style.
- **src/components** : Réservé aux composants réutilisables de l'interface utilisateur, qui peuvent être utilisés dans différentes parties de l'application.
- **src/features** : Regroupe les fonctionnalités principales de l'application, organisées par domaine fonctionnel.
  - **src/features/admin** : Dédicacé aux fonctionnalités et composants liés à la gestion administrative de l'application.
  - **src/features/public** : Contient les fonctionnalités accessibles au grand public, sans nécessiter d'authentification.
  - **src/features/tournament** : Consacré aux fonctionnalités relatives à la gestion des tournois.
  - **src/features/reservation** : Contient les fonctionnalités liées à la gestion des réservations.
  - **src/features/planning** : Dédicacé aux fonctionnalités de planification des événements et des activités.
  - **src/features/ranking** : Réservé aux fonctionnalités de gestion des classements.
- **src/hooks** : Contient des hooks personnalisés pour gérer l'état et les effets dans l'application.
- **src/layouts** : Destiné aux mises en page de l'application, définissant la structure générale des pages.
- **src/lib** : Contient des bibliothèques et des utilitaires partagés entre différentes parties de l'application.
- **src/pages** : Réservé aux composants de page, représentant les différentes vues de l'application.
- **src/routes** : Contient la configuration des routes de l'application, définissant la navigation entre les pages.
- **src/services** : Dédicacé aux services d'API et aux appels réseau pour interagir avec les données.
- **src/stores** : Contient la gestion de l'état global de l'application, potentiellement avec des outils comme Redux.
- **src/styles** : Réservé aux fichiers de style globaux et aux thèmes de l'application.
- **src/types** : Contient les définitions de types TypeScript pour assurer la typage statique dans l'application.
- **src/utils** : Dédicacé aux fonctions utilitaires et aux helpers qui peuvent être utilisés dans toute l'application.

Cette structure vise à garantir une organisation claire et efficace du code, facilitant ainsi le travail des développeurs et la compréhension du projet.