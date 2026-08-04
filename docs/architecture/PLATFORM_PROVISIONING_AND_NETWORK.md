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

## 5. Tournois internes et tournois ouverts

Chaque tournoi devra obligatoirement préciser son audience.

### Tournoi interne

L’inscription est réservée aux licenciés présents dans l’instance du club organisateur. Aucun passeport extérieur n’est accepté.

### Tournoi ouvert

Le club organisateur choisit s’il accepte :

- les licenciés des autres clubs Pelote Manager ;
- tous les joueurs, y compris les non-licenciés.

L’annonce publique peut être diffusée sur le réseau Pelote Manager.

## 6. Passeport joueur futur

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

## 7. Règle définitive

Les clubs partagent un logiciel et peuvent partager des informations publiques de tournois. Ils ne partagent jamais leurs comptes, leurs bases de licenciés ou leurs données métier privées.
