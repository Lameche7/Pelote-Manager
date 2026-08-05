# Worker de provisionnement Pelote Manager

Ce dossier contient le traitement serveur chargé de faire progresser les demandes enregistrées dans la base centrale.

## Sécurité

Le worker ne doit jamais être compilé dans l’application Vite ni exécuté dans le navigateur.

Il utilise uniquement des variables serveur :

- `PLATFORM_SUPABASE_URL` ;
- `PLATFORM_SUPABASE_SERVICE_ROLE_KEY` ;
- `PLATFORM_PROVISIONER_WORKER_ID` ;
- `PLATFORM_PROVISIONER_LEASE_SECONDS` ;
- `PLATFORM_PROVISIONER_MODE`.

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

## Modes disponibles

### Mode manuel par défaut

Sans configuration particulière, `PLATFORM_PROVISIONER_MODE` vaut `manual`.

Le fournisseur manuel place la demande en `waiting_external` à la première opération nécessitant Supabase ou Vercel. Aucun appel fournisseur n’est effectué.

### Mode simulation

Le mode `simulation` valide le parcours complet sans créer aucune ressource et sans utiliser de secret fournisseur.

Il exige simultanément :

- `PLATFORM_PROVISIONER_MODE=simulation` ;
- `PLATFORM_PROVISIONER_SIMULATION_ACK=I_UNDERSTAND_NO_RESOURCES_ARE_CREATED` ;
- un club dont le slug commence par `simulation-` par défaut.

Le préfixe peut être rendu encore plus restrictif avec `PLATFORM_PROVISIONER_SIMULATION_SLUG_PREFIX`.

La version simulée est définie par `PLATFORM_PROVISIONER_APPLICATION_VERSION`. Sa valeur par défaut est `0.0.0-simulation`.

Les adaptateurs produisent uniquement des références déterministes et clairement fictives :

- une URL Supabase terminée par `.supabase.invalid` ;
- une URL de déploiement terminée par `.pelote-manager.invalid` ;
- des noms préfixés par `sim`.

Les domaines `.invalid` sont réservés à la documentation et ne représentent aucune ressource réelle.

Le mode simulation refuse tout club dont le slug ne commence pas par le préfixe réservé. Cette protection évite d’attacher des références fictives à un vrai client.

### Mode réel indisponible

Le mode `live` est explicitement refusé dans la PR43.

Aucun adaptateur n’appelle actuellement Supabase Management API ou Vercel. Aucun jeton fournisseur n’est lu par le code de simulation.

## Contrat des futurs adaptateurs réels

Les fichiers de `providers/live` définissent uniquement un contrat de planification. Ils ne créent aucune ressource.

Chaque futur adaptateur devra exposer :

- `name`, égal à `supabase` ou `vercel` ;
- `planStep`, qui décrit l’opération avant toute mutation ;
- `applyStep`, qui restera inutilisable tant que le mode réel n’est pas activé dans une décision distincte.

Avant toute création ou modification, `planStep` devra produire un plan contenant :

- l’étape et l’action fournisseur ;
- la clé d’idempotence ;
- un résumé public sans secret ;
- l’indication qu’une ressource facturable sera ou non créée ;
- la devise ;
- le coût ponctuel estimé en centimes ;
- le coût mensuel estimé en centimes.

Le plan reçoit un identifiant déterministe. Une modification du fournisseur, de l’étape, de l’action ou du coût produit un nouvel identifiant et invalide automatiquement l’ancienne approbation.

## Garde-fous de coût

Aucun tarif Supabase ou Vercel n’est inscrit en dur dans le dépôt. Le futur adaptateur devra récupérer ou déclarer l’estimation applicable au moment du plan.

La politique budgétaire restera configurée côté serveur et précisera :

- la devise autorisée ;
- le plafond ponctuel ;
- le plafond mensuel.

Une ressource facturable ne pourra être créée que lorsque :

1. le plan est chiffré ;
2. sa devise correspond à la politique serveur ;
3. ses coûts restent sous les deux plafonds ;
4. une approbation explicite vise exactement l’identifiant du plan ;
5. l’approbation indique son auteur et n’est pas expirée.

Une ancienne approbation ne peut donc pas autoriser un plan dont le prix ou le contenu a changé.

Même lorsqu’un plan satisfait toutes ces règles, `applyPlan` lève volontairement une erreur dans la PR43. Le contrat et les contrôles peuvent être testés, mais aucune opération réelle ne peut partir.

## Lancement ultérieur

Depuis un environnement serveur sécurisé :

```bash
node workers/platform-provisioner/runOnce.mjs
```

Cette commande ne doit pas être utilisée tant que les migrations de la plateforme centrale n’ont pas été appliquées sur son propre projet Supabase.
