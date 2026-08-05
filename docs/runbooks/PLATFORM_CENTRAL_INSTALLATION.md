# Protocole d’installation de la plateforme centrale

Ce document prépare l’installation future du registre propriétaire de Pelote Manager.

Il ne constitue pas une autorisation de créer un projet Supabase, de modifier un abonnement ou d’exécuter une migration. La Production PCL et le projet Test restent exclus de toute manipulation.

## Objectif

Installer, sur un projet Supabase entièrement dédié, la plateforme centrale qui contient uniquement :

- les comptes des super administrateurs ;
- le registre commercial et technique des clubs ;
- les demandes de provisionnement ;
- les plans de coût et leurs approbations ;
- les confirmations renforcées ;
- le journal d’audit.

Cette base ne doit jamais contenir les licenciés, comptes de clubs, réservations, paiements, tournois ou documents métier.

## Règles d’arrêt immédiat

L’installation est interrompue sans exception lorsque :

- le projet ciblé est la Production PCL ou le projet Test ;
- le projet contient déjà des tables ou comptes métier d’un club ;
- le projet n’est pas clairement identifié comme plateforme centrale ;
- le nombre d’emplacements Supabase disponibles ou le coût du projet n’a pas été explicitement validé ;
- une migration manque, a changé après validation ou n’est pas répertoriée dans le manifeste ;
- un secret, un jeton fournisseur ou une clé `service_role` apparaît dans un fichier, une capture ou un journal partagé ;
- le mode réel du worker est activé ;
- l’identité du propriétaire ou l’adresse du compte central n’est pas certaine.

## Phase 0 — Autorisation préalable

Avant toute action chez Supabase, consigner :

- la décision explicite de créer un projet central supplémentaire ;
- le compte ou l’organisation qui en sera propriétaire ;
- la région choisie ;
- la formule et le coût mensuel annoncés ;
- le nom prévu du projet ;
- la personne autorisée à créer le projet ;
- la date de l’intervention.

Aucune création n’est réalisée dans la PR43.

## Phase 1 — Vérification locale du lot

Depuis une copie propre du dépôt placée sur la branche validée :

```bash
npm run platform:validate-installation-bundle
```

Cette commande :

- ne contacte aucun service extérieur ;
- n’exécute aucun SQL ;
- vérifie l’ordre exact des migrations ;
- refuse une migration centrale non répertoriée ;
- vérifie les garde-fous des fichiers ;
- affiche l’empreinte SHA-256 de chaque migration et du bootstrap.

Conserver dans le compte rendu :

- le SHA du commit Git utilisé ;
- la version du lot ;
- l’ordre des migrations ;
- les empreintes SHA-256 affichées ;
- la date et l’auteur de la vérification.

Toute modification ultérieure d’un fichier impose une nouvelle vérification complète.

## Phase 2 — Création future du projet central

Cette phase ne sera exécutée qu’après autorisation explicite.

Le projet devra :

- être nouveau et vide ;
- porter un nom indiquant clairement sa fonction centrale ;
- être distinct de tous les projets de clubs ;
- ne recevoir aucune migration provenant de `supabase/migrations` ;
- ne contenir aucune donnée de démonstration ou donnée métier ;
- disposer d’un accès limité aux seules personnes nécessaires.

À la création, consigner sans publier de secret :

- le nom du projet ;
- sa référence publique ;
- sa région ;
- sa formule ;
- son URL publique ;
- la date de création ;
- le compte propriétaire.

Ne jamais consigner la clé `service_role`, un mot de passe de base ou un jeton fournisseur dans GitHub, un document partagé ou une capture d’écran.

## Phase 3 — Contrôle avant migrations

Avant le premier SQL :

1. vérifier une nouvelle fois que le projet ciblé n’est ni Production ni Test ;
2. vérifier que la base ne contient aucune table métier de club ;
3. vérifier que le compte connecté est celui prévu pour la plateforme centrale ;
4. comparer le SHA du commit avec celui du compte rendu de phase 1 ;
5. comparer les empreintes SHA-256 avec celles validées en phase 1 ;
6. fermer tout autre onglet Supabase pouvant prêter à confusion.

Au moindre doute, arrêter l’installation.

## Phase 4 — Exécution des migrations

Exécuter exclusivement les migrations listées par :

`supabase/platform/installation/platformInstallationManifest.mjs`

Respecter strictement l’ordre affiché par le validateur. Pour chaque migration, consigner :

- son numéro d’ordre ;
- son chemin ;
- son empreinte SHA-256 ;
- l’heure de début ;
- le résultat ;
- l’heure de fin ;
- l’identité de l’opérateur.

Ne jamais poursuivre après une erreur. Ne jamais relancer une partie de fichier isolée sans analyse préalable.

## Phase 5 — Premier super administrateur

Après réussite de toutes les migrations :

1. créer manuellement le compte Auth central du propriétaire ;
2. copier localement `supabase/platform/bootstrap/01_attach_first_platform_admin.sql` ;
3. remplacer le placeholder par l’adresse exacte du compte central dans cette copie locale ;
4. ne jamais commiter cette adresse dans le dépôt ;
5. exécuter le bootstrap uniquement dans le projet central ;
6. vérifier qu’un seul super administrateur actif a été rattaché.

Le bootstrap conserve volontairement un blocage lorsqu’aucune adresse n’a été renseignée.

## Phase 6 — Configuration du déploiement propriétaire

Le navigateur peut recevoir uniquement :

- `VITE_PLATFORM_SUPABASE_URL` ;
- `VITE_PLATFORM_SUPABASE_ANON_KEY`.

Aucune variable `VITE_*` ne doit contenir :

- une clé `service_role` ;
- un mot de passe ;
- un jeton Supabase Management API ;
- un jeton Vercel ;
- un secret de provisionnement.

Les variables serveur du worker ne seront configurées que lors d’une décision ultérieure distincte. Le mode `live` reste interdit.

## Phase 7 — Validation fonctionnelle sans dépense

Le premier contrôle fonctionnel doit rester sans création fournisseur :

1. ouvrir `/super-admin/connexion` ;
2. vérifier que seul le compte central autorisé accède à `/super-admin` ;
3. enregistrer un club jetable dont le slug commence par `simulation-` ;
4. demander son provisionnement ;
5. lancer uniquement le worker en mode simulation avec l’acquittement prévu ;
6. vérifier les étapes, plans, approbations, prévision budgétaire et confirmation renforcée ;
7. vérifier que les références générées utilisent exclusivement les domaines `.invalid` ;
8. vérifier qu’aucun projet Supabase ou Vercel réel n’a été créé ;
9. révoquer les approbations et confirmations de test ;
10. conserver le journal d’audit comme preuve.

La simulation ne doit jamais utiliser le nom ou le slug d’un vrai club client.

## Phase 8 — Critères d’acceptation

La plateforme centrale est considérée validée uniquement lorsque :

- toutes les migrations ont été appliquées dans l’ordre et sans erreur ;
- les empreintes correspondent au lot validé ;
- le premier super administrateur peut se connecter ;
- un utilisateur non autorisé est refusé ;
- les tables centrales sont protégées par RLS ;
- aucune table ou donnée métier de club n’est présente ;
- le parcours de simulation aboutit sans aucun appel fournisseur ;
- les reprises du worker sont idempotentes ;
- les plans, approbations et confirmations sont audités ;
- le mode réel demeure bloqué ;
- Production et Test n’ont subi aucune modification.

## Compte rendu obligatoire

Le compte rendu final doit contenir :

- le commit et la version du lot ;
- les empreintes des fichiers ;
- l’identification publique du projet central ;
- la liste des migrations exécutées ;
- le résultat de chaque critère d’acceptation ;
- les anomalies rencontrées et leur résolution ;
- la confirmation qu’aucun secret n’est joint ;
- la confirmation que Production et Test n’ont pas été modifiés ;
- la décision finale : validé, à corriger ou abandonné.

La PR43 reste en brouillon tant que ce protocole n’a pas été exécuté avec succès sur un véritable projet central dédié.
