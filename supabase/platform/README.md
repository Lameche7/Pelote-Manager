# Base centrale Pelote Manager

Ce dossier décrit la base réservée au propriétaire de la plateforme.

Elle doit utiliser un projet Supabase distinct de toutes les instances de clubs.
Elle contient uniquement :

- les comptes des super administrateurs ;
- le registre commercial et technique des clubs clients ;
- les statuts d’abonnement et de déploiement ;
- les versions installées et attendues ;
- un journal d’audit des opérations de plateforme.

Elle ne contient jamais :

- les comptes des joueurs ou dirigeants d’un club ;
- les licenciés ;
- les réservations ;
- les paiements des pratiquants ;
- les événements et tournois d’un club ;
- les documents métier d’un club.

## Installation

1. Créer un projet Supabase dédié à la plateforme centrale.
2. Exécuter les fichiers de `migrations` dans l’ordre.
3. Créer manuellement le compte Auth du propriétaire de Pelote Manager.
4. Remplacer l’adresse dans `bootstrap/01_attach_first_platform_admin.sql`.
5. Exécuter ce bootstrap dans le projet central.
6. Configurer `VITE_PLATFORM_SUPABASE_URL` et `VITE_PLATFORM_SUPABASE_ANON_KEY` dans le déploiement Vercel.

Les clés `service_role`, mots de passe et secrets de provisionnement ne doivent jamais être ajoutés aux variables `VITE_*`, au dépôt GitHub ou au navigateur.

## Isolation

Les migrations de ce dossier ne sont volontairement pas rangées dans `supabase/migrations`.
Elles ne sont donc pas destinées aux bases de clubs et ne doivent jamais être appliquées à la Production PCL ou au projet de test d’un club.
