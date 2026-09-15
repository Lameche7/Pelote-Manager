# PILOTOKI Network — architecture cible

## Statut de la décision

Cette décision remplace la cible commerciale **multi-instance** définie dans `PR43_MULTICLUB_FOUNDATIONS.md`.

Le Pelotaris Club Lourdais reste l'instance de production de référence pendant toute la transition. La transformation doit être **progressive, additive et sans changement visible pour les utilisateurs PCL** tant qu'une fonction réseau n'est pas explicitement activée.

## Pourquoi changer

Le produit vise un abonnement club à faible coût. Une instance Supabase et un déploiement Vercel par club augmenteraient trop vite le coût marginal par client.

Le fonctionnement réel de la pelote impose aussi des données naturellement communes :

- un numéro de licence identifie une identité sportive unique ;
- un joueur peut être affilié à plusieurs clubs, notamment par extension de licence ;
- un championnat officiel est commun à tous les clubs concernés ;
- un tournoi appartient à son organisateur mais peut être publié au réseau et recevoir des joueurs d'autres clubs.

La cible devient donc une **plateforme multi-tenant à données hybrides** : certaines données sont globales au réseau PILOTOKI, d'autres restent strictement privées au club, et les passerelles sont explicites.

## Architecture cible

```text
                         PILOTOKI
                            │
                 1 application / 1 API
                            │
                    1 projet Supabase
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
     NOYAU RÉSEAU                        ESPACES CLUBS
          │                                   │
  identités sportives                  réservations
  licences                             créneaux
  clubs fédéraux                       tarifs
  championnats                         communications internes
  résultats officiels                  permissions
  tournois publiés                     documents
          │                                   │
          └──────── passerelles contrôlées ───┘
```

## Trois catégories de données

### 1. GLOBAL

Une ligne représente une réalité commune à toute la plateforme.

Exemples :

- identité sportive du joueur ;
- numéro de licence ;
- référentiel des clubs fédéraux ;
- championnats officiels ;
- divisions, poules, équipes et rencontres de championnat ;
- résultats et classements officiels.

Une donnée globale n'appartient pas au club qui l'a importée ou découverte.

### 2. CLUB

Une ligne appartient à un club précis et n'est accessible qu'aux personnes autorisées pour ce club.

Exemples :

- réservations ;
- ressources et terrains ;
- horaires et fermetures ;
- tarifs ;
- campagnes de licence ;
- communications internes ;
- rôles et permissions ;
- créneaux permanents ;
- paramètres TV ;
- médias du club ;
- documents internes.

Ces données doivent rester protégées par `club_id`, RLS et fonctions métier contrôlant le club actif.

### 3. MIXTE

Une donnée appartient à un club mais peut être exposée volontairement au réseau.

Le cas principal est le tournoi :

- `organizer_club_id` définit le propriétaire ;
- seul le club organisateur administre la compétition ;
- sa visibilité peut être `private`, `network` ou `public` ;
- les inscriptions réseau peuvent référencer l'identité sportive globale ;
- le club représenté au moment de l'inscription reste figé dans l'historique.

## Identité sportive globale

Le numéro de licence est l'identifiant métier sportif unique.

La cible conceptuelle est :

```text
sport_players
  id
  licence_number UNIQUE
  first_name
  last_name
  birth_date
  ...

player_club_affiliations
  player_id
  club_id
  affiliation_type   -- primary | extension | other
  starts_on
  ends_on
  season_id
```

Un joueur n'est donc pas dupliqué lorsqu'il possède une extension de licence.

Les coordonnées privées, préférences de compte et données administratives de club ne deviennent pas automatiquement globales.

## Compte utilisateur

`profiles` représente l'identité de connexion PILOTOKI.

À terme :

```text
profile -> sport_player
sport_player -> N affiliations clubs
profile -> N club_memberships de permission
```

Deux notions doivent rester séparées :

- **affiliation sportive** : le joueur appartient sportivement à un ou plusieurs clubs ;
- **appartenance administrative** : le compte possède un rôle ou des permissions dans un club.

Un joueur peut avoir une extension dans un club sans disposer d'aucun droit d'administration dans ce club.

## Club actif

L'application transporte à terme un `active_club_id` pour toutes les fonctions privées d'un club.

Règles UX :

- un utilisateur lié à un seul club ne voit aucun sélecteur et conserve le parcours actuel ;
- un utilisateur lié à plusieurs clubs peut changer explicitement de club actif ;
- aucun fallback implicite ne choisit un club arbitrairement ;
- changer de club actif ne change jamais l'identité sportive globale du compte.

## Championnats

Les championnats sont des données **GLOBAL**.

Le super administrateur PILOTOKI peut importer une compétition une seule fois. Tous les clubs concernés bénéficient ensuite du même championnat, des mêmes rencontres et des mêmes résultats.

Le modèle existant `championships` / `championship_federation_clubs` / `championship_club_links` est conservé et renforcé.

Un club officiel peut exister sans être client PILOTOKI. Lorsqu'il devient client, son identité fédérale est reliée à `public.clubs` sans dupliquer l'historique existant.

## Tournois

Les tournois sont des données **MIXTE**.

Le club organisateur reste propriétaire de son tournoi et de son administration.

Visibilités cibles :

- `private` : seulement le club organisateur ;
- `network` : visible aux utilisateurs PILOTOKI autorisés à découvrir les tournois ;
- `public` : visible sans appartenance à un club PILOTOKI selon les règles du tournoi.

Les joueurs déjà connus de PILOTOKI s'inscrivent avec leur identité sportive globale. Les joueurs externes restent possibles grâce au mécanisme d'identité externe puis peuvent réclamer leur historique ultérieurement.

## Super administration

Le super administrateur PILOTOKI gère :

- clubs clients ;
- formule et statut commercial ;
- référentiel sportif global ;
- imports de championnats ;
- rapprochements de clubs fédéraux ;
- opérations réseau explicitement prévues.

Il ne reçoit pas automatiquement les permissions métier privées des clubs.

Une intervention support dans les données privées doit rester explicite, limitée et auditée.

## Règle de sécurité

Le fait d'utiliser un seul Supabase ne doit jamais signifier que les données privées sont partagées.

Pour chaque objet CLUB ou MIXTE, la sécurité doit être garantie côté base :

1. relation directe ou dérivable vers un `club_id` propriétaire ;
2. RLS ou fonction SQL vérifiant l'accès au club ;
3. `USING` et `WITH CHECK` cohérents pour les mises à jour ;
4. aucun contrôle d'autorisation reposant uniquement sur React ;
5. aucune autorisation basée sur `user_metadata` ;
6. tout `SECURITY DEFINER` doit contrôler explicitement l'utilisateur et son périmètre.

## Compatibilité PCL pendant la migration

La migration suit une règle stricte :

> aucune PR d'architecture réseau ne doit modifier le comportement visible du PCL sauf si cet effet est explicitement annoncé et testé.

Séquence de migration :

1. ajouter les nouvelles structures ;
2. backfiller les données PCL ;
3. vérifier les invariants ;
4. maintenir une couche de compatibilité avec les fonctions existantes ;
5. basculer progressivement les lectures ;
6. basculer progressivement les écritures ;
7. activer les fonctions réseau seulement après validation ;
8. supprimer l'ancien modèle uniquement lorsqu'il n'est plus référencé.

`club_members`, `profiles.member_id` et les historiques associés ne sont pas supprimés dans la fondation réseau.

## Infrastructure cible

Pour réduire le coût marginal par club :

- un dépôt GitHub ;
- un projet Vercel principal ;
- un projet Supabase principal ;
- plusieurs clubs logiques dans la même plateforme ;
- éventuellement plusieurs domaines ou sous-domaines vers le même déploiement sans duplication d'infrastructure.

L'ancien worker de provisionnement multi-instance reste dans le dépôt pendant la transition mais n'est plus la cible commerciale active.

## Ordre de réalisation

1. fondations et audit ;
2. identité sportive globale ;
3. affiliations joueur-club ;
4. découplage progressif `profiles.member_id` ;
5. club actif et audit RLS multi-tenant ;
6. championnat global administré au niveau réseau ;
7. tournois réseau ;
8. notifications réseau ;
9. super administration commerciale simplifiée ;
10. second club pilote dans la même infrastructure.
