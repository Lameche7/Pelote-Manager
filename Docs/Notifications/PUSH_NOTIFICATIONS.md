# Notifications Push — Pelote Manager

## Objectif

Pelote Manager ne doit pas dépendre d'une consultation volontaire de l'application pour transmettre une information importante.

Une notification métier doit suivre le même parcours quel que soit le module d'origine :

```text
Événement métier
  → club_communications
  → communication_deliveries
  → historique Mon espace / Notifications
  → Web Push pour les appareils abonnés
```

Les modules métier ne doivent jamais envoyer directement un Web Push. Ils publient une communication et ses destinataires ; le canal Push se charge ensuite de la livraison aux appareils.

## Cas couverts

Le moteur peut être réutilisé notamment pour :

- créneau de réservation libéré ;
- communication publiée par le club ;
- inscription à un tournoi validée ;
- partie de tournoi programmée ou déplacée ;
- résultat ou classement publié ;
- future convocation, animation, entraînement ou championnat.

## PWA

Pelote Manager expose :

- `public/manifest.webmanifest` ;
- `public/sw.js` ;
- `public/pwa-icon.svg` ;
- l'enregistrement du service worker depuis `src/main.tsx`.

Le service worker ne met volontairement pas les données métier en cache. Son rôle dans cette première version est l'installation PWA et la réception des notifications push, afin d'éviter d'afficher des réservations ou plannings périmés.

Un clic sur une notification ouvre par défaut `/mon-espace/notifications`.

## Appareils et consentement

L'abonnement est lié à un profil Pelote Manager et à un appareil/navigateur.

Un même profil peut donc enregistrer plusieurs appareils. L'utilisateur doit autoriser les notifications sur chaque appareil.

Sur iPhone/iPad, Pelote Manager doit être ajouté à l'écran d'accueil puis ouvert depuis son icône avant de demander l'autorisation Push.

La page `Mon espace → Notifications` contient le contrôle d'activation et de désactivation de l'appareil courant.

## Modèle de données

### `push_subscriptions`

Stocke un abonnement Web Push par endpoint :

- `profile_id` ;
- endpoint Web Push ;
- clés `p256dh` et `auth` ;
- plateforme et user-agent ;
- état actif/inactif ;
- dernière réussite et dernière erreur.

Les clés stockées ici sont celles de l'abonnement navigateur ; la clé privée VAPID du serveur n'est jamais stockée dans la base ni dans GitHub.

### `push_delivery_attempts`

Journalise la livraison d'une `communication_delivery` vers un appareil :

- communication ;
- livraison utilisateur ;
- abonnement appareil ;
- statut `pending`, `sent`, `failed` ou `invalid` ;
- nombre de tentatives ;
- réponse HTTP et erreur éventuelle ;
- date d'envoi.

La contrainte `(delivery_id, subscription_id)` rend l'envoi idempotent par notification et appareil.

## Edge Functions

### `push-config`

Expose uniquement la clé VAPID publique nécessaire au navigateur.

Variable :

- `WEB_PUSH_VAPID_PUBLIC_KEY`.

### `send-push-notifications`

Reçoit l'identifiant d'une communication depuis un Database Webhook, récupère les destinataires possédant un compte et leurs appareils actifs, puis envoie le Web Push.

Variables :

- `WEB_PUSH_VAPID_PUBLIC_KEY` ;
- `WEB_PUSH_VAPID_PRIVATE_KEY` ;
- `WEB_PUSH_VAPID_SUBJECT` ;
- `WEB_PUSH_WEBHOOK_SECRET`.

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par l'environnement Edge Functions.

Un endpoint Web Push retournant HTTP 404 ou 410 est considéré comme expiré : l'abonnement est marqué inactif automatiquement.

## Configuration Supabase

### 1. Migration

Exécuter :

```text
20260813114000_add_web_push_notifications.sql
```

### 2. Déployer les Edge Functions

Déployer :

```text
push-config
send-push-notifications
```

Les deux fonctions ont `verify_jwt = false` dans `supabase/config.toml` :

- `push-config` ne révèle que la clé publique ;
- `send-push-notifications` refuse toute requête dont l'en-tête `x-pelote-push-secret` ne correspond pas à `WEB_PUSH_WEBHOOK_SECRET`.

### 3. Ajouter les secrets

Dans les secrets Edge Functions :

```text
WEB_PUSH_VAPID_PUBLIC_KEY=<clé publique VAPID>
WEB_PUSH_VAPID_PRIVATE_KEY=<clé privée VAPID>
WEB_PUSH_VAPID_SUBJECT=mailto:<adresse de contact>
WEB_PUSH_WEBHOOK_SECRET=<secret long aléatoire>
```

Ne jamais ajouter ces valeurs à GitHub, à une migration ou au front-end, à l'exception de la clé VAPID publique exposée à l'exécution par `push-config`.

### 4. Database Webhook

Créer un webhook sur :

```text
public.club_communications
```

Événements :

```text
INSERT
UPDATE
```

URL :

```text
https://<PROJECT_REF>.supabase.co/functions/v1/send-push-notifications
```

En-tête :

```text
x-pelote-push-secret: <WEB_PUSH_WEBHOOK_SECRET>
```

Le webhook peut se déclencher sur un brouillon ou une archive : la fonction vérifie elle-même que la communication est `published` et non expirée avant tout envoi.

## Contrat pour les futurs modules

Un nouveau module ne doit pas connaître VAPID, le service worker ou `push_subscriptions`.

Il doit :

1. créer/publier une ligne `club_communications` ;
2. créer les lignes `communication_deliveries` correspondant aux destinataires ;
3. laisser le moteur Push distribuer la communication aux appareils enregistrés.

Cette séparation garantit une source de vérité unique pour :

- le compteur de notifications ;
- l'historique dans `Mon espace` ;
- les notifications Push ;
- un éventuel futur canal e-mail.

## Règles de fiabilité

- une erreur Push ne doit jamais annuler l'action métier qui a déclenché la communication ;
- les envois sont idempotents par livraison/appareil ;
- un abonnement expiré est désactivé ;
- les secrets VAPID restent côté serveur ;
- chaque utilisateur peut désactiver l'appareil courant ;
- le navigateur conserve le contrôle final de l'autorisation système.
