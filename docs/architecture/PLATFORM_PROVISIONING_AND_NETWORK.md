# Plateforme, provisionnement et réseau Pelote Manager

## 1. Trois périmètres qui ne doivent jamais être confondus

Pelote Manager distingue trois services indépendants.

### Instance privée d’un club

Chaque club possède son propre projet Supabase, sa propre authentification, sa base, son stockage et son déploiement.

Cette instance contient notamment :

- les comptes du club ;
- les licenciés ;
- les dirigeants ;
- les réservations ;
- les paiements ;
- les tournois et leurs inscriptions ;
- les documents et données métier.

Aucune de ces données n’est accessible à une autre instance de club.

### Plateforme propriétaire

La plateforme propriétaire est réservée au super administrateur de Pelote Manager.

Elle conserve uniquement :

- les clubs clients ;
- les contacts commerciaux ;
- les formules et statuts d’abonnement ;
- les références techniques des projets Supabase et Vercel ;
- les versions installées ;
- les demandes et états de provisionnement ;
- le journal d’audit.

Elle ne contient aucun licencié, compte de club, réservation, paiement ou inscription à un tournoi.

### Réseau Pelote Manager futur

Le réseau Pelote Manager sera un service séparé du registre commercial. Il permettra la diffusion des tournois ouverts et l’utilisation d’un passeport joueur minimal.

Il ne sera pas développé dans la PR43, mais sa frontière est fixée dès maintenant afin de ne jamais transformer le registre commercial en annuaire de licenciés.

## 2. Provisionnement d’un nouveau club

L’enregistrement d’un club dans le registre ne crée aucune donnée métier.

Le super administrateur déclenche ensuite une demande de provisionnement. Cette demande suit les étapes suivantes :

1. création d’un projet Supabase propre au club ;
2. application des migrations de l’application ;
3. exécution du bootstrap d’instance vierge ;
4. rattachement du premier administrateur dans cette seule instance ;
5. création d’un projet Vercel propre au club ;
6. configuration des variables d’environnement du club ;
7. déploiement ;
8. vérifications fonctionnelles et de sécurité ;
9. passage de l’instance en période d’essai.

Le navigateur du super administrateur peut créer et suivre la demande, mais il ne réalise pas directement ces opérations.

## 3. Gestion des secrets

Les secrets de provisionnement sont réservés à un service serveur sécurisé ou à une fonction Edge de la plateforme.

Ils ne doivent jamais être stockés :

- dans GitHub ;
- dans les variables `VITE_*` ;
- dans le navigateur ;
- dans les tables consultables par le super administrateur ;
- dans le journal d’audit ;
- dans les messages d’erreur visibles.

Le registre peut stocker les références publiques nécessaires au suivi : référence du projet Supabase, URL publique, nom du projet Vercel, URL de déploiement et version installée.

La fonction serveur de provisionnement utilise ses secrets pour agir auprès des fournisseurs, puis renvoie uniquement ces références publiques et l’état de chaque étape.

## 4. États de provisionnement

Une demande peut être :

- `pending` : demande enregistrée ;
- `running` : traitement serveur en cours ;
- `waiting_external` : action manuelle ou validation d’un fournisseur requise ;
- `completed` : instance créée et vérifiée ;
- `failed` : échec à corriger ;
- `cancelled` : demande abandonnée.

Une seule demande ouverte est autorisée par club.

Un club ne peut pas passer au statut actif tant que sa référence Supabase, son URL de déploiement et sa version installée ne sont pas renseignées.

La fin du provisionnement place le club en période d’essai. L’activation commerciale reste une décision explicite du super administrateur.

## 5. Worker serveur reprenable

Le worker est séparé de l’application Vite et ne peut utiliser que des variables d’environnement serveur.

Chaque exécution :

1. revendique une seule demande disponible ;
2. reçoit un bail temporaire et un jeton de bail unique ;
3. prolonge ce bail avant le traitement ;
4. exécute une seule étape ;
5. libère la demande pour l’étape suivante ou la classe en attente extérieure, terminée ou échouée.

La sélection utilise un verrou PostgreSQL `FOR UPDATE SKIP LOCKED`. Deux workers ne peuvent donc pas prendre simultanément la même demande.

Si un worker s’arrête, le bail expire et une nouvelle exécution peut reprendre la demande. L’ancien worker ne peut plus enregistrer sa réponse avec un jeton remplacé ou expiré.

Chaque étape utilise une clé d’idempotence stable fondée sur l’identifiant de la demande et le nom de l’étape. Une reprise ne devra jamais créer une deuxième ressource Supabase ou Vercel.

Les erreurs sont nettoyées avant journalisation et seules les références publiques autorisées peuvent être renvoyées au registre.

## 6. Adaptateurs et mode simulation

Le worker reste en mode `manual` par défaut. Ce mode s’arrête en `waiting_external` avant toute opération nécessitant Supabase ou Vercel.

La PR43 ajoute des adaptateurs Supabase et Vercel en mode `simulation` pour valider le parcours complet sans réseau, sans ressource réelle et sans jeton fournisseur.

La simulation exige une confirmation explicite dans l’environnement serveur. Elle est réservée aux clubs dont le slug commence par `simulation-` par défaut.

Elle produit uniquement des références déterministes et fictives :

- références Supabase préfixées par `sim` ;
- URL terminées par `.supabase.invalid` ;
- projets Vercel préfixés par `sim-` ;
- déploiements terminés par `.pelote-manager.invalid`.

Les domaines `.invalid` ne peuvent pas représenter un service réel. Le préfixe de slug empêche également d’attacher ces références fictives à un véritable club client.

Le mode `live` est explicitement refusé. Aucun code de la PR43 n’appelle Supabase Management API ou Vercel et aucun jeton fournisseur n’est lu par les adaptateurs de simulation.

## 7. Contrat réel et maîtrise des coûts

Les futurs adaptateurs réels devront séparer strictement la planification de l’exécution.

La planification produit un document public et sans secret indiquant :

- le fournisseur responsable ;
- l’étape et l’action envisagée ;
- la clé d’idempotence ;
- la création éventuelle d’une ressource facturable ;
- le coût ponctuel estimé ;
- le coût mensuel estimé ;
- la devise ;
- un résumé compréhensible par le propriétaire de la plateforme.

Ce document reçoit un identifiant déterministe. Toute modification du coût ou de l’opération produit un autre identifiant.

La politique budgétaire est configurée côté serveur. Elle définit une devise, un plafond ponctuel et un plafond mensuel. Aucun prix fournisseur n’est figé dans le dépôt.

Une création facturable exige une approbation :

- visant exactement l’identifiant du plan courant ;
- contenant la confirmation explicite attendue ;
- identifiant son auteur ;
- possédant une date d’expiration future.

L’approbation devient automatiquement inutilisable lorsque le fournisseur, l’action ou le prix change. Un plan dépassant un plafond ou utilisant une autre devise est refusé avant toute mutation.

Le planificateur de la PR43 peut vérifier ces règles, mais sa méthode d’application lève toujours une erreur. Il ne peut donc créer aucune ressource, même avec une approbation valide.

## 8. Tournois internes et tournois ouverts

Chaque tournoi devra obligatoirement préciser son audience.

### Tournoi interne

L’inscription est réservée aux licenciés présents dans l’instance du club organisateur. Aucun passeport extérieur n’est accepté.

### Tournoi ouvert

Le club organisateur choisit s’il accepte :

- les licenciés des autres clubs Pelote Manager ;
- tous les joueurs, y compris les non-licenciés.

L’annonce publique peut être diffusée sur le réseau Pelote Manager.

## 9. Passeport joueur futur

Le passeport permettra à un licencié de s’inscrire à un tournoi ouvert d’un autre club sans recréer un compte complet dans l’instance organisatrice.

Le compte principal et la fiche complète restent dans le club d’origine. Après consentement du joueur, le réseau transmet uniquement les informations nécessaires à l’inscription.

Le club organisateur conserve une inscription extérieure locale, mais n’obtient aucun accès à la base du club d’origine.

Le passeport devra être :

- volontaire ;
- minimal ;
- révocable ;
- limité aux usages explicitement acceptés ;
- séparé du registre commercial de la plateforme ;
- dépourvu de mot de passe ou de secret provenant du club d’origine.

## 10. Règle définitive

Les clubs partagent un logiciel et peuvent partager des informations publiques de tournois. Ils ne partagent jamais leurs comptes, leurs bases de licenciés ou leurs données métier privées.
