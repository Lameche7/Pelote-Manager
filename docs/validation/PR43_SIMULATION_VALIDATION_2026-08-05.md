# PR43 — Compte rendu de validation de la plateforme centrale et du provisionnement simulé

Date de validation : 5 août 2026  
Pull request : #43 — `feat(platform): préparer des instances de clubs totalement isolées`  
Branche : `feat/platform-multiclub-foundations`  
Commit applicatif validé : `ed32f57ed5540485529ec8097e4980b5c938988d`

## Décision

La plateforme centrale et le parcours complet de provisionnement ont été validés fonctionnellement en **mode simulation uniquement**.

La PR doit rester en **brouillon** et ne doit pas être fusionnée à ce stade. Le mode réel demeure désactivé et aucun adaptateur fournisseur réel n'a été exécuté.

## Environnement central installé

Un projet Supabase central distinct a été créé pour le registre commercial et technique :

- nom : `PeloteManager-Platform` ;
- référence publique : `ihgsxsnaidxioqbmmawb` ;
- région : `eu-west-1` ;
- statut constaté : actif.

Les six migrations centrales ont été appliquées dans l'ordre prévu :

1. `20260804010000_create_platform_registry.sql` ;
2. `20260804020000_add_platform_provisioning_jobs.sql` ;
3. `20260804030000_add_provisioning_worker_leases.sql` ;
4. `20260805010000_add_platform_cost_plans.sql` ;
5. `20260805020000_add_live_execution_confirmations.sql` ;
6. `20260805030000_add_simulation_worker_claim.sql`.

Un seul compte central actif a été rattaché comme super administrateur.

## Configuration de la Preview

La Preview Vercel de la branche PR43 a été configurée avec les variables suivantes, sans consigner leurs valeurs dans ce rapport :

- navigateur : `VITE_PLATFORM_SUPABASE_URL` ;
- navigateur : `VITE_PLATFORM_SUPABASE_ANON_KEY` ;
- serveur uniquement : `PLATFORM_SUPABASE_URL` ;
- serveur uniquement et sensible : `PLATFORM_SUPABASE_SERVICE_ROLE_KEY`.

Les variables étaient limitées à l'environnement Preview de la branche concernée. Le déploiement Vercel associé au commit applicatif validé était en statut `success`.

## Club fictif utilisé

- nom : `Club Démonstration pelote` ;
- slug : `simulation-club-demo` ;
- formule : `Standard` ;
- statut commercial final : `Essai`.

Le préfixe réservé `simulation-` a bien empêché l'utilisation du parcours pour un club réel.

## Parcours exécuté

Chaque étape a été exécutée séparément depuis l'endpoint Preview `/api/platform-provisioner-simulation` :

1. `requested` → `supabase_project` ;
2. `supabase_project` → `database_migrations` ;
3. `database_migrations` → `club_bootstrap` ;
4. `club_bootstrap` → `first_admin` ;
5. `first_admin` → `vercel_project` ;
6. `vercel_project` → `environment_variables` ;
7. `environment_variables` → `deployment` ;
8. `deployment` → `verification` ;
9. `verification` → `completed`.

Résultat final retourné par l'interface :

```text
Étape terminée : completed (completed).
```

## Références fictives obtenues

Le tableau de bord central a affiché :

- provisionnement : `Terminé` ;
- message : `Instance prête pour essai` ;
- référence Supabase simulée : `sim3661c8c75fe435f6c` ;
- URL de déploiement simulée : `https://sim-simulation-club-demo.pelote-manager.invalid` ;
- version simulée : `0.0.0-pr43-simulation`.

Les domaines `.invalid` et les références commençant par `sim` confirment qu'il s'agit uniquement de données fictives.

## Contrôle des ressources Supabase réelles

La liste des projets Supabase a été contrôlée après la simulation :

- `PeloteManager` — actif — référence `kuvwagoshhxibhwxknij` ;
- `PeloteManager-Platform` — actif — référence `ihgsxsnaidxioqbmmawb` ;
- `PeloteManager-Test-PR41` — en pause — référence `eecdqzsfiycdipbtybnh`.

Aucun projet Supabase supplémentaire n'a été créé par le worker simulé. Le projet de production est resté actif et le projet de test est resté en pause.

## Contrôles de sécurité validés

- aucune valeur secrète n'est enregistrée dans ce rapport ;
- aucun appel de création réel Supabase ou Vercel n'a été effectué ;
- aucune donnée métier de club n'a été ajoutée au registre commercial central ;
- aucune donnée de licencié ou de membre n'a été partagée entre clubs ;
- le traitement nécessitait une session centrale authentifiée avec un compte super administrateur ;
- le worker simulé n'acceptait que les slugs réservés commençant par `simulation-` ;
- les références produites étaient exclusivement fictives ;
- la Production PCL n'a pas été modifiée ;
- le projet de test PR41 n'a pas été réactivé.

## Conclusion

Le socle central de la PR43 est fonctionnel pour :

- enregistrer un club client dans le registre central ;
- demander son provisionnement ;
- traiter le workflow de manière progressive et reprenable ;
- enregistrer des références techniques simulées ;
- afficher l'état final dans le tableau de bord super administrateur ;
- conserver l'isolation absolue des données métier de chaque club.

Cette validation ne constitue pas une autorisation d'activer le mode réel. Les adaptateurs Supabase Management API et Vercel réels restent à concevoir, sécuriser et valider séparément avant toute création facturable ou toute fusion de la PR.
