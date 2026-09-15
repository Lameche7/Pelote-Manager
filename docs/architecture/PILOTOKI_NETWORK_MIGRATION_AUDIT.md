# PILOTOKI Network — audit de migration

Date de référence : 15 septembre 2026.

Cet audit accompagne `PILOTOKI_NETWORK_FOUNDATIONS.md`. Il décrit la situation observée sur le schéma de production PCL et les contraintes à respecter avant toute mutation de données.

## Objectif

Transformer progressivement l'instance PCL actuelle en première organisation d'une plateforme PILOTOKI multi-club, sans interrompre ni modifier les parcours actuels.

Aucune table existante n'est supprimée dans cette phase.

## Constat global

Le schéma actuel contient déjà plusieurs briques favorables à une architecture réseau :

- `clubs` existe ;
- de nombreuses tables métier privées portent déjà `club_id` ;
- `club_memberships` relie un compte à un club et à un rôle ;
- les rôles et permissions sont définis par club ;
- `tournaments` porte déjà `club_id` ;
- le cœur championnat est largement global ;
- `championship_players` porte déjà `licence_number` et peut être relié à `profile_id` ;
- `championship_federation_clubs` est indépendant d'un club PILOTOKI ;
- `championship_club_links` sert déjà de passerelle entre compétition globale et clubs utilisateurs.

## Zone 1 — identité joueur : RISQUE ÉLEVÉ

### État actuel

`club_members` contient notamment :

- `club_id` ;
- `licence_number` ;
- identité civile minimale ;
- données saisonnières/historiques via tables associées.

Le numéro de licence est historiquement contraint comme unique, ce qui correspond au fait métier qu'une licence identifie un joueur unique.

`profiles.member_id` pointe aujourd'hui directement vers `club_members` et constitue un lien central dans de nombreuses fonctions.

### Problème cible

Une personne peut appartenir sportivement à plusieurs clubs, notamment par extension de licence. La ligne d'identité sportive ne doit donc pas appartenir à un seul club.

### Cible

Introduire de façon additive :

```text
sport_players
player_club_affiliations
```

Puis relier progressivement :

```text
profiles -> sport_players
club_members / historiques -> affiliation ou compatibilité locale
```

### Invariants de migration

- aucun `profiles.member_id` existant ne doit être cassé pendant le backfill ;
- chaque licence PCL existante doit produire exactement une identité sportive globale ;
- les historiques, audits, communications et saisons restent accessibles ;
- aucune création de compte existante ne doit changer de comportement avant bascule explicite ;
- les doublons de licence doivent être refusés au niveau global.

## Zone 2 — affiliations sportives : NOUVELLE STRUCTURE

Une affiliation est différente d'un rôle applicatif.

Exemple :

```text
joueur 095067
  PCL      primary
  Club X   extension
```

Cette information ne donne aucun droit Back Office.

La cible doit permettre au minimum :

- affiliation principale ;
- extension ;
- saison ou période de validité ;
- historique ;
- plusieurs affiliations simultanées lorsque le règlement sportif le permet.

## Zone 3 — permissions club : BASE EXISTANTE À CONSERVER

Les tables suivantes constituent déjà une bonne base :

- `club_memberships` ;
- `club_roles` ;
- `club_role_permissions` ;
- `permissions`.

Elles doivent continuer à représenter les droits applicatifs, et non l'affiliation sportive.

À terme, un compte multi-club peut avoir :

```text
PCL      administrator
Club X   aucun rôle administratif
```

même si son joueur possède une extension au Club X.

## Zone 4 — données strictement CLUB

Les familles suivantes sont déjà naturellement privées par club ou dérivables depuis un parent club :

- `reservable_resources` et horaires associés ;
- `reservations` et audits associés ;
- `reservation_settings` ;
- `permanent_slots` et tables associées ;
- `club_prices` ;
- `club_seasons` ;
- `club_member_seasons` ;
- `club_communications` ;
- `communication_deliveries` ;
- `events` et ressources associées ;
- `licence_campaigns` ;
- `licence_requests` ;
- `club_tv_*` ;
- `club_media_assets` ;
- rôles et permissions club.

### Attention aux tables enfants sans `club_id`

Plusieurs tables n'ont pas leur propre colonne `club_id` mais sont rattachées à un parent qui en possède une, par exemple des occupations calendrier, des occurrences de créneaux permanents ou certaines tables de réservation.

Avant l'ouverture d'un deuxième club, chaque chemin d'accès doit être audité pour vérifier que l'autorisation remonte bien jusqu'au club propriétaire et qu'aucune lecture directe n'élargit le périmètre.

## Zone 5 — championnats : GLOBAL DÉJÀ BIEN ENGAGÉ

Les tables suivantes sont naturellement réseau :

- `championships` ;
- `championship_divisions` ;
- `championship_pools` ;
- `championship_teams` ;
- `championship_team_players` ;
- `championship_matches` ;
- `championship_standings` ;
- `championship_general_standings` ;
- `championship_players` ;
- `championship_federation_clubs`.

Les tables suivantes assurent ou peuvent assurer la couche club :

- `championship_club_links` ;
- paramètres et fenêtres de réservation championnat portant `club_id` ;
- audits/imports rattachés au club initiateur lorsque nécessaire.

### Cible super-admin

L'import d'une compétition officielle devient une opération plateforme. Une seule compétition et un seul ensemble de résultats sont stockés.

Chaque club PILOTOKI est ensuite relié à son identité fédérale et bénéficie des données déjà présentes.

## Zone 6 — tournois : MIXTE

`tournaments` porte déjà `club_id`, ce qui correspond naturellement au futur `organizer_club_id`.

La plupart des tables enfants (`tournament_series`, `tournament_teams`, `tournament_matches`, `tournament_pools`, résultats, planning, reports) héritent aujourd'hui du tournoi parent plutôt que de stocker directement `club_id`.

Cette structure peut être conservée si toutes les politiques et fonctions suivent systématiquement la relation vers `tournaments.club_id`.

### Évolution cible

Ajouter progressivement :

- visibilité `private | network | public` ;
- inscriptions utilisant l'identité sportive globale lorsque disponible ;
- conservation des identités externes pour les participants non encore liés ;
- snapshot du club représenté lors de l'inscription ;
- droits d'administration réservés au club organisateur.

## Zone 7 — notifications

Les notifications actuelles peuvent devenir à terme :

- privées au club ;
- personnelles au joueur ;
- réseau (nouveau tournoi, championnat, proposition interclubs).

Le modèle doit empêcher qu'une communication interne d'un club soit diffusée à un autre club par simple partage du même `profile`.

## Zone 8 — super administration

L'ancien registre central multi-instance n'est plus la cible de production.

Les concepts utiles restent pertinents :

- statut commercial du club ;
- formule ;
- dates d'essai/activation/suspension ;
- version produit ;
- journal des opérations plateforme.

Ils pourront être intégrés dans la même infrastructure logique, avec un périmètre d'accès réservé au rôle plateforme.

## RLS — audit obligatoire avant club n°2

Avant de créer un deuxième club réel, toutes les politiques et fonctions exposées doivent être classées et testées.

Checklist minimale par table/fonction :

- propriétaire global ou club identifié ;
- SELECT limité au périmètre attendu ;
- UPDATE possède `USING` et `WITH CHECK` ;
- INSERT valide le club cible ;
- DELETE valide le club cible ;
- toute fonction `SECURITY DEFINER` vérifie explicitement `auth.uid()` et les permissions ;
- aucune décision d'autorisation ne dépend de `raw_user_meta_data` ;
- aucune fonction d'administration ne suppose implicitement qu'il n'existe qu'un seul club ;
- les vues exposées respectent la sécurité des lignes.

## Compatibilité : règles non négociables

Pendant la transition :

1. la production PCL reste la source de vérité pour les utilisateurs actuels ;
2. les nouvelles tables commencent comme miroirs/additions ;
3. les backfills doivent être idempotents ;
4. aucune ancienne FK n'est supprimée avant migration complète des consommateurs ;
5. les RPC existantes gardent leur contrat tant que les écrans actuels les utilisent ;
6. les nouvelles fonctions réseau sont activées seulement après tests dédiés ;
7. chaque PR de migration doit fournir une requête de vérification et un chemin de retour compatible.

## Découpage recommandé des prochaines PR

### PR 186 — Network Foundations

- architecture cible ;
- audit du schéma ;
- invariants et stratégie de migration ;
- aucun changement runtime.

### PR 187 — Global Player Identity

- ajout `sport_players` ;
- backfill depuis les licences existantes ;
- liens de compatibilité ;
- aucune suppression de `club_members`.

### PR 188 — Player Club Affiliations

- ajout des affiliations ;
- PCL devient l'affiliation principale des joueurs actuels ;
- support futur des extensions.

### PR 189 — Profile Compatibility Layer

- lien profil -> identité sportive globale ;
- maintien de `profiles.member_id` pendant la transition ;
- adaptation progressive des fonctions d'identité.

### PR 190 — Tenant Security Audit

- audit RLS/RPC complet ;
- correction des fonctions supposant un club unique ;
- tests d'isolation avec deux clubs fictifs.

Les numéros sont indicatifs tant que les PR ne sont pas ouvertes.
