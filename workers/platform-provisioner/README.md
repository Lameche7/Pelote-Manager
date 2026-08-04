# Worker de provisionnement Pelote Manager

Ce dossier contient le traitement serveur chargé de faire progresser les demandes enregistrées dans la base centrale.

## Sécurité

Le worker ne doit jamais être compilé dans l’application Vite ni exécuté dans le navigateur.

Il utilise uniquement des variables serveur :

- `PLATFORM_SUPABASE_URL` ;
- `PLATFORM_SUPABASE_SERVICE_ROLE_KEY` ;
- `PLATFORM_PROVISIONER_WORKER_ID` ;
- `PLATFORM_PROVISIONER_LEASE_SECONDS`.

Aucune de ces variables ne doit commencer par `VITE_`.

Les futurs jetons Supabase Management API et Vercel devront également rester dans l’environnement serveur. Ils ne devront jamais être enregistrés dans `platform_clubs`, `platform_provisioning_jobs`, les journaux ou le dépôt GitHub.

## Fonctionnement

Une exécution de `runOnce.mjs` :

1. revendique une demande disponible avec un bail temporaire ;
2. prolonge le bail avant le traitement ;
3. exécute une seule étape ;
4. enregistre les références techniques publiques obtenues ;
5. remet la demande en attente pour l’étape suivante, ou la classe en attente extérieure, terminée ou échouée.

Chaque étape reçoit une clé d’idempotence stable composée de l’identifiant de la demande et de l’étape. Une reprise ne doit donc jamais créer une deuxième ressource chez un fournisseur.

Un worker interrompu perd son bail après expiration. Une nouvelle exécution peut alors reprendre la demande. Un ancien worker ne peut plus enregistrer de résultat avec un bail remplacé.

## État actuel

Le fournisseur inclus est volontairement manuel. Il place la demande en `waiting_external` à la première opération nécessitant Supabase ou Vercel.

Les appels réels aux fournisseurs ne seront ajoutés qu’après :

- création d’un projet central dédié ;
- choix des comptes et formules fournisseurs ;
- configuration de secrets serveur ;
- validation sur une instance de club jetable.

## Lancement ultérieur

Depuis un environnement serveur sécurisé :

```bash
node workers/platform-provisioner/runOnce.mjs
```

Cette commande ne doit pas être utilisée tant que les migrations de la plateforme centrale n’ont pas été appliquées sur son propre projet Supabase.
