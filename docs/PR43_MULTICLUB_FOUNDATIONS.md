# PR43 — Fondations multi-club de la plateforme

## 1. Objectif

Préparer Pelote Manager à accueillir plusieurs clubs dans une même plateforme, sans mélange de données et sans créer une installation technique distincte par client.

La cible est :

- une seule application ;
- une seule base de données ;
- plusieurs clubs isolés par `club_id` ;
- des utilisateurs pouvant appartenir à un ou plusieurs clubs ;
- un rôle de plateforme distinct des rôles de club ;
- un futur espace `/super-admin` pour créer et administrer les clubs clients.

Cette PR traite d'abord les fondations de données et de sécurité. Elle ne doit pas introduire un tableau de bord super administrateur tant que l'isolation d'un deuxième club n'est pas démontrée.

## 2. Principe d'autorisation retenu

Trois niveaux doivent rester distincts :

1. **Compte utilisateur global** : identité et authentification communes à la plateforme.
2. **Appartenance à un club** : rôle et permissions valables uniquement dans ce club.
3. **Administration de plateforme** : droit de gérer les clubs clients, sans devenir automatiquement administrateur de chacun d'eux.

Un administrateur de club ne peut jamais accéder aux données d'un autre club.

Un administrateur de plateforme ne doit pas recevoir implicitement toutes les permissions métier des clubs. Les opérations de support devront être explicites, limitées et auditées.

## 3. Fondations déjà présentes

Les éléments suivants sont déjà orientés multi-club :

- `clubs` ;
- `club_roles` ;
- `club_role_permissions` ;
- `club_memberships` ;
- `club_seasons` ;
- `club_prices` ;
- `reservable_resources.club_id` ;
- `club_members.club_id` ;
- `club_member_seasons.club_id` ;
- `club_member_imports.club_id` ;
- `club_member_audit_log.club_id` ;
- `event_types.club_id` ;
- `events.club_id` ;
- `event_documents.club_id` ;
- `event_audit_log.club_id` ;
- les permissions `has_club_permission(...)` ;
- les RPC d'administration utilisant majoritairement `admin_current_club_id()`.

L'interface actuelle accepte exactement un club par compte administrateur. `admin_current_club_id()` refuse volontairement l'absence d'appartenance et les comptes liés à plusieurs clubs.

## 4. Classification des données

### 4.1 Données globales de plateforme

| Élément | Cible | Observation |
|---|---|---|
| `auth.users` | Global | Authentification commune à tous les clubs. |
| `profiles` | Global | Identité du compte utilisateur. Les colonnes métier de licence doivent en sortir. |
| `permissions` | Global | Catalogue normalisé des permissions de club. |
| futurs abonnements et offres | Global | À créer plus tard pour la commercialisation SaaS. |
| futurs administrateurs de plateforme | Global | À créer séparément des rôles de club. |

### 4.2 Données directement rattachées à un club

| Élément | État actuel |
|---|---|
| `clubs` | Conforme. |
| `club_roles` | Conforme. |
| `club_memberships` | Conforme pour un rôle par club et par profil. |
| `club_seasons` | Conforme. |
| `club_prices` | Rattaché au club, mais n'est plus la source des tarifs de réservation. |
| `reservable_resources` | `club_id` présent. |
| `club_members` | `club_id` présent. |
| tables de gestion et d'import des membres | Majoritairement conformes. |
| `event_types`, `events`, `event_documents`, `event_audit_log` | `club_id` présent. |

### 4.3 Données rattachées seulement de manière indirecte

Ces tables peuvent retrouver leur club par une relation, mais l'absence de `club_id` direct complique les RLS, les audits et les contrôles d'intégrité.

| Élément | Club retrouvé par | Risque |
|---|---|---|
| `resource_opening_hours` | `resource_id` | Faible si toutes les RPC contrôlent le terrain ; RLS publique à vérifier. |
| `reservations` | `resource_id` | Important : aucune clé directe pour les politiques, statistiques et paiements. |
| `calendar_occupations` | `resource_id` | Important : lecture publique actuellement trop large pour plusieurs clubs. |
| `reservation_audit_log` | `reservation_id` | Audit inter-clubs plus difficile. |
| `payments` | `reservation_id` | Gestion financière par club indirecte. |
| `payment_events` | `payment_id` | Webhooks et rapprochements doivent identifier le club sans ambiguïté. |
| `event_resources` | `event_id` et `resource_id` | Il faut garantir qu'un événement et un terrain appartiennent au même club. |

### 4.4 Données encore globales alors qu'elles doivent être propres à un club

#### `reservation_settings`

La table est actuellement un singleton avec une clé booléenne `id = true`.

Elle contient notamment :

- délais de réservation licencié et public ;
- tarifs licencié et public ;
- durée d'un créneau ;
- pas de réservation ;
- préavis minimal.

Elle doit devenir une table à une ligne par club, avec :

- `club_id uuid primary key references clubs(id)` ;
- suppression de la clé booléenne ;
- toutes les lectures déterminées à partir du club du terrain ;
- toutes les modifications administratives limitées au club actif.

C'est le blocage prioritaire avant la création d'un deuxième club.

## 5. Blocages critiques constatés

### 5.1 Calendrier public non contextualisé par club

Les ressources actives et les occupations non annulées sont actuellement lisibles publiquement sans sélection explicite de club.

Avec deux clubs, une page publique pourrait donc agréger les terrains ou occupations des deux structures.

La future consultation publique devra recevoir ou résoudre un club explicite :

- par slug dans l'URL ;
- puis filtrer toutes les ressources, horaires et occupations par ce club.

### 5.2 Statut de licencié non contextualisé par club

`is_active_licensee(profile_id, date)` ne reçoit pas de club.

De plus, `profiles.member_id` est une relation unique vers un seul `club_member`. Une même personne ne peut donc pas être licenciée ou liée à des registres de plusieurs clubs.

Décision à appliquer :

- conserver `profiles` comme identité globale ;
- remplacer le lien unique `profiles.member_id` par une table d'association entre profil et fiche membre de club ;
- faire dépendre le statut de licencié du club concerné par la réservation.

La fonction cible devra ressembler conceptuellement à :

```sql
is_active_licensee(target_profile_id, target_club_id, target_date)
```

### 5.3 Unicité mondiale du numéro de licence

`club_members.licence_number_normalized` est actuellement unique dans toute la base.

Cette règle peut être conservée uniquement si la fiche représente réellement une personne/licence globale. Or la même table porte aussi `club_id`, ce qui la présente comme une fiche appartenant à un club.

Avant migration, il faut figer l'un des deux modèles :

- **modèle recommandé** : identité globale séparée, adhésion/licence rattachée au club et à la saison ;
- modèle simplifié temporaire : fiche de membre par club, avec unicité `(club_id, licence_number_normalized)`.

La PR43 doit au minimum supprimer la contradiction actuelle et permettre à un même compte d'être lié à plusieurs clubs.

### 5.4 Compte administrateur lié à plusieurs clubs

`admin_current_club_id()` refuse les comptes multi-clubs. C'est une protection correcte aujourd'hui, mais elle ne constitue pas le futur sélecteur.

Le club actif devra être explicite et contrôlé côté serveur. Il ne faut jamais accepter un `club_id` envoyé par le navigateur sans vérifier l'appartenance et la permission.

### 5.5 Ancien rôle global dans `profiles`

`profiles.role` et les contrôles historiques `is_profile_admin()` appartiennent au modèle mono-club initial.

Ils ne doivent plus servir à donner des droits métier dans tous les clubs.

Les rôles de club doivent provenir exclusivement de `club_memberships` et les droits de plateforme d'une structure distincte.

## 6. Modèle cible minimal

### 6.1 Identité globale

```text
auth.users
  └── profiles
```

### 6.2 Appartenances et responsabilités de club

```text
profiles
  └── club_memberships
        ├── club_id
        └── role_id
```

### 6.3 Registre sportif

Cible recommandée :

```text
profiles
  └── profile_club_members
        ├── profile_id
        └── club_member_id

club_members
  └── club_member_seasons
        ├── club_id
        ├── club_season_id
        └── is_licensed
```

Cette association permet à un même compte d'être rattaché à plusieurs clubs sans dupliquer son authentification.

### 6.4 Réservations

Chaque agrégat métier doit porter directement le club :

```text
reservation_settings.club_id
reservable_resources.club_id
reservations.club_id
calendar_occupations.club_id
reservation_audit_log.club_id
payments.club_id
payment_events.club_id
```

Les clés étrangères composites ou les triggers de contrôle doivent empêcher les incohérences, par exemple une réservation du club A utilisant un terrain du club B.

## 7. Administration de plateforme

Le futur super administrateur doit être séparé des rôles de club.

Structure cible possible :

```text
platform_admins
  - profile_id
  - is_active
  - created_at
  - created_by
```

Puis des RPC sécurisées et auditées :

- `platform_list_clubs()` ;
- `platform_get_club(...)` ;
- `platform_create_club(...)` ;
- `platform_suspend_club(...)` ;
- `platform_invite_club_admin(...)`.

Aucune de ces fonctions ne doit être accordée au rôle `authenticated` sans contrôle interne de `platform_admins`.

## 8. Provisionnement futur d'un club

La création d'un club devra être atomique. Une seule commande serveur créera :

1. la ligne `clubs` ;
2. les rôles standards du club ;
3. les permissions de ces rôles ;
4. les réglages de réservation du club ;
5. les types d'événements par défaut ;
6. éventuellement une saison initiale ;
7. l'appartenance de l'administrateur principal ;
8. une trace d'audit de plateforme.

En cas d'échec d'une étape, aucune création partielle ne doit rester en base.

## 9. Découpage de réalisation

### Phase A — Isolation du moteur de réservation

- transformer `reservation_settings` en réglages par club ;
- ajouter `club_id` aux réservations, occupations, audits et paiements ;
- remplir ces colonnes à partir des relations existantes ;
- ajouter contraintes, index et RLS ;
- adapter toutes les RPC de réservation, tarifs, horaires et paiements ;
- ajouter des tests avec deux clubs distincts.

### Phase B — Identité membre multi-club

- créer l'association profil ↔ membre de club ;
- migrer `profiles.member_id` ;
- contextualiser `is_active_licensee` par club ;
- adapter l'inscription et la liaison de licence ;
- tester un compte lié à deux clubs.

### Phase C — Club actif

- remplacer le refus des comptes multi-clubs par une sélection explicite ;
- transporter le club actif dans les commandes serveur de façon vérifiable ;
- conserver l'accès direct pour un compte lié à un seul club.

### Phase D — Administration de plateforme

- créer `platform_admins` et son audit ;
- créer `/super-admin` ;
- lister et créer les clubs ;
- inviter l'administrateur principal ;
- gérer l'état commercial du club.

### Phase E — Adresse et personnalisation du club

- URL publique par slug ;
- identité visuelle par club ;
- futur sous-domaine ou domaine personnalisé ;
- assistant de première configuration.

## 10. Critères de validation de la PR43

La PR43 ne sera considérée comme terminée que si les tests démontrent :

1. deux clubs peuvent avoir des tarifs, horaires et terrains différents ;
2. une réservation du club A ne peut jamais utiliser un terrain du club B ;
3. l'administrateur du club A ne peut lire ni modifier les données privées du club B ;
4. le calendrier public d'un club ne retourne aucune donnée de l'autre club ;
5. un tarif modifié dans le club A n'affecte pas le club B ;
6. les paiements et audits sont rattachés sans ambiguïté à leur club ;
7. les données actuelles du Pelotaris Club Lourdais sont migrées sans perte ;
8. aucun accès de production ne dépend encore de `is_profile_admin()` pour les droits métier de club.

## 11. Règles de déploiement

- aucune migration multi-club directement en production sans validation sur le projet Supabase Test ;
- sauvegarde ou export vérifiable avant les transformations destructrices ;
- migrations progressives : ajout nullable, backfill contrôlé, contraintes, puis `not null` ;
- contrôles SQL qui arrêtent la migration si une donnée ne peut pas être attribuée à un club ;
- application des migrations en production avant la fusion du code qui en dépend ;
- aucun deuxième club réel créé avant validation complète des tests d'isolation.
