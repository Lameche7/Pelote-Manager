# Base centrale Pelote Manager

Ce dossier décrit la base réservée au propriétaire de la plateforme.

Elle doit utiliser un projet Supabase distinct de toutes les instances de clubs.
Elle contient uniquement :

- les comptes des super administrateurs ;
- le registre commercial et technique des clubs clients ;
- les statuts d’abonnement et de déploiement ;
- les versions installées et attendues ;
- les demandes et étapes de provisionnement ;
- les plans publics de coût et leurs approbations ;
- un journal d’audit des opérations de plateforme.

Elle ne contient jamais :

- les comptes des joueurs ou dirigeants d’un club ;
- les licenciés ;
- les réservations ;
- les paiements des pratiquants ;
- les événements et tournois d’un club ;
- les documents métier d’un club.

Le futur réseau de tournois et le passeport joueur ne seront pas stockés dans ce registre commercial. Leur frontière est décrite dans `docs/architecture/PLATFORM_PROVISIONING_AND_NETWORK.md`.

## Installation

1. Créer un projet Supabase dédié à la plateforme centrale.
2. Exécuter les fichiers de `migrations` dans l’ordre.
3. Créer manuellement le compte Auth du propriétaire de Pelote Manager.
4. Remplacer l’adresse dans `bootstrap/01_attach_first_platform_admin.sql`.
5. Exécuter ce bootstrap dans le projet central.
6. Configurer `VITE_PLATFORM_SUPABASE_URL` et `VITE_PLATFORM_SUPABASE_ANON_KEY` dans le déploiement Vercel.

## Provisionnement

Le navigateur du super administrateur peut :

- enregistrer un club ;
- demander la préparation de son instance ;
- suivre l’étape et le statut de la demande ;
- consulter les plans publics de coût ;
- approuver un plan facturable pendant une heure ;
- révoquer une approbation ;
- activer le club une fois l’installation technique terminée.

Il ne peut pas créer directement les projets Supabase ou Vercel.

La fonction `platform_request_provisioning` crée une demande idempotente. Une seule demande ouverte est autorisée par club.

Le worker serveur utilise les commandes réservées au rôle `service_role` :

- `platform_worker_claim_next_provisioning` revendique une demande avec un bail temporaire ;
- `platform_worker_heartbeat_provisioning` prolonge le bail du worker actif ;
- `platform_worker_store_cost_plan` enregistre un plan public et chiffré ;
- `platform_worker_update_provisioning` enregistre l’étape suivante et les références publiques obtenues.

Les verrous PostgreSQL empêchent deux workers de prendre la même demande. Une tâche interrompue redevient disponible après expiration de son bail. Toute réponse utilisant un jeton de bail expiré ou remplacé est refusée.

Le worker peut enregistrer uniquement :

- la référence et l’URL Supabase ;
- le nom du projet Vercel ;
- l’URL du déploiement ;
- la version installée ;
- le fournisseur, l’étape et l’action d’un plan ;
- la devise et les montants estimés en centimes ;
- un résumé public du plan.

Il ne reçoit et ne stocke aucun mot de passe, jeton d’accès ou secret fournisseur. Les erreurs sont nettoyées avant journalisation.

## Plans de coût

Un seul plan courant est autorisé pour une étape d’une demande de provisionnement. Une nouvelle estimation remplace l’ancienne et révoque automatiquement son approbation active.

Les plans sont consultables uniquement par les super administrateurs actifs. Une approbation :

- vise un plan précis ;
- est liée au compte central de son auteur ;
- expire automatiquement après une heure ;
- peut être révoquée ;
- est enregistrée dans le journal d’audit.

Les états possibles sont `pending`, `approved`, `expired`, `revoked` et `superseded`.

L’approbation ne permet pas au navigateur d’exécuter une création. Le mode réel reste désactivé dans la PR43.

La fin du provisionnement place automatiquement le club en période d’essai. Le passage au statut actif reste une décision explicite du super administrateur.

L’implémentation serveur se trouve dans `workers/platform-provisioner`. Le fournisseur actuel est volontairement manuel et s’arrête en `waiting_external` avant tout appel réel à Supabase ou Vercel.

## Secrets

Les clés `service_role`, mots de passe, jetons fournisseurs et secrets de provisionnement ne doivent jamais être ajoutés :

- aux variables `VITE_*` ;
- au dépôt GitHub ;
- au navigateur ;
- aux tables du registre ;
- aux journaux d’audit ;
- aux messages d’erreur visibles.

Ils devront être configurés uniquement dans l’environnement serveur sécurisé chargé du provisionnement.

## Isolation

Les migrations de ce dossier ne sont volontairement pas rangées dans `supabase/migrations`.
Elles ne sont donc pas destinées aux bases de clubs et ne doivent jamais être appliquées à la Production PCL ou au projet de test d’un club.
