# PLAN_MODIFICATIONS_V2.1.md

**Projet : Pelote Manager**  
**Objet : consolider la documentation existante sans réécriture générale**  
**Règle : seules les modifications ci-dessous doivent être appliquées.**

---

## 00 — Vision du projet

### Remplacements

Dans **0.4 Les utilisateurs** :

- supprimer pour le visiteur :
  - `demander une réservation`
  - `s'inscrire au tournoi`

- remplacer par :
  - `consulter les disponibilités`
  - `commencer une demande de réservation ou d'inscription`
  - `se connecter ou créer un compte avant confirmation`

Dans **0.6 Les grands principes métier**, remplacer :

> Une réservation est un évènement.  
> Un match est un évènement.  
> Une fermeture est un évènement.  
> Un entraînement est un évènement.  
> Le moteur décide uniquement si deux évènements peuvent coexister.

par :

> Toute utilisation d'une ressource est représentée dans le calendrier par une Occupation.  
> Une réservation crée une Occupation.  
> Un match publié crée une Occupation.  
> Une fermeture crée une Occupation.  
> Un entraînement crée une Occupation.  
> Le domaine Calendrier décide uniquement si des Occupations peuvent coexister sur une même ressource et une même période.

### Ajout en fin de chapitre

> Le logiciel est structuré en domaines métier clairement séparés.  
> Chaque domaine possède ses responsabilités, son vocabulaire et ses règles.  
> La cartographie officielle des domaines est définie dans `Docs/Architecture/01-Domain-Map.md`.

---

## 01 — Architecture générale

### Remplacer la section 3 « Les domaines métier »

Remplacer les quatre domaines actuels par les huit domaines officiels :

1. Club et ressources  
2. Personnes et adhésions  
3. Calendrier  
4. Réservations  
5. Tournois  
6. Planification sportive  
7. Résultats et classements  
8. Communication et publication  

Ajouter les capacités transverses :

- Identité et contrôle d'accès
- Notifications
- Audit
- Fichiers
- Recherche
- Paiement

Préciser :

> Administration n'est pas un domaine métier autonome.  
> Elle constitue un ensemble de cas d'usage permettant d'agir sur les domaines selon les droits accordés.

### Remplacer la section 5 « Architecture Feature First »

Structure officielle :

```text
src/
├── app/
├── application/
├── domain/
├── features/
├── infrastructure/
├── shared/
├── assets/
├── styles/
└── types/
```

### Remplacer la section 6 « Structure interne d'une fonctionnalité »

```text
features/
└── tournaments/
    ├── components/
    ├── hooks/
    ├── routes/
    └── view-models/
```

Les règles métier, repositories abstraits et moteurs ne sont pas placés dans `features/`.

### Remplacer la section 7 « Le noyau métier »

```text
domain/
├── club/
├── people/
├── calendar/
├── reservations/
├── tournaments/
├── planning/
├── ranking/
└── communication/
```

Chaque domaine peut contenir :

```text
entities/
value-objects/
policies/
services/
events/
errors/
repositories/
```

### Ajouter après la section 7

## Building Blocks officiels

- Entity
- Aggregate Root
- Value Object
- Policy
- Domain Service
- Domain Event
- Repository interface
- Factory
- Specification
- DTO applicatif

### Remplacer la section 11 « Le calendrier »

> Le domaine Calendrier ne connaît pas les réservations, les matchs ou les entraînements comme objets métier complets.  
> Il manipule uniquement :
>
> - Resource
> - TimeRange
> - Occupation
> - OccupationStatus
> - Visibility
> - Conflict
>
> Les autres domaines demandent la création, la modification, le déplacement ou l'annulation d'une Occupation.

### Ajouter

> Toute décision d'architecture structurante doit être consignée dans `Docs/DECISIONS.md`.

---

## 02 — Modèle métier et base de données

### Remplacer la section 2 « Les grands domaines »

Utiliser les huit domaines officiels de la Domain Map.

### Remplacer la section 7 « Domaine Joueur »

Créer trois concepts séparés :

#### Personne

Personne connue du club, avec ou sans compte.

#### Compte utilisateur

Identité d'accès permettant l'authentification.

#### Adhésion / Licence

Relation entre une personne et le club pour une période donnée.

#### Joueur

Rôle sportif d'une personne dans une compétition.

Règles :

- une personne peut exister sans compte ;
- un compte peut être lié à une personne ;
- une licence appartient à une personne et à une saison ;
- un joueur de tournoi référence une personne ;
- les cycles de vie sont indépendants.

### Modifier la section 8 « Domaine Equipe »

Remplacer :

> Elle contient deux joueurs.

par :

> Elle contient le nombre de joueurs imposé par le format de compétition configuré.  
> Pour la pala par équipes utilisée actuellement, ce nombre est égal à deux.

### Remplacer les sections 15 et 16

## Domaine Calendrier

Le Calendrier est l'autorité unique sur l'occupation des ressources.

Il manipule :

- Resource
- TimeRange
- Occupation
- Conflict

## Domaine Occupation

Une Occupation possède au minimum :

- identifiant ;
- ressource ;
- période ;
- type ;
- état ;
- visibilité ;
- référence vers le domaine d'origine ;
- date de création ;
- date de modification.

Types possibles :

- Reservation
- TournamentMatch
- Training
- ClubEvent
- Maintenance
- Closure
- PrivateUse

Le type informe sur l'origine de l'Occupation mais ne transfère aucune règle métier au Calendrier.

### Modifier la section 17 « Domaine Réservation »

Remplacer :

> Une réservation référence un évènement.

par :

> Une réservation est un agrégat métier autonome.  
> Lorsqu'elle est confirmée, elle demande la création d'une Occupation dans le domaine Calendrier.  
> La réservation reste propriétaire du client, des règles de réservation, du paiement, des commentaires et de son état métier.  
> Le Calendrier reste propriétaire de l'occupation physique et des conflits.

### Ajouter une section Value Objects

Value Objects minimums :

- TimeRange
- Duration
- AvailabilityRule
- Visibility
- Capacity
- CompetitionFormat
- Score
- TournamentPeriod
- ReservationWindow

### Ajouter une règle

> Les modèles de persistance ne sont jamais utilisés directement par le domaine.  
> Des mappers assurent la conversion entre lignes Supabase et modèles métier.

---

## 03 — Parcours utilisateurs

### Conserver les droits actuels comme référence officielle

Le visiteur :

- consulte ;
- ne confirme aucune réservation ;
- ne confirme aucune inscription.

L'utilisateur connecté :

- réserve ;
- s'inscrit à un tournoi.

### Ajouter dans « Ouverture des inscriptions »

> Un visiteur peut commencer à consulter le formulaire.  
> La création ou la confirmation d'une inscription exige un compte authentifié.

### Remplacer le cycle de tournoi par

```text
Préparation
→ Configuration
→ Inscriptions ouvertes
→ Inscriptions fermées
→ Poules générées
→ Poules validées
→ Planning généré
→ Planning publié
→ En cours
→ Terminé
→ Archivé
```

Ajouter `Annulé` comme état terminal distinct.

### Ajouter dans « Publication »

> La publication du planning demande la création des Occupations correspondantes dans le Calendrier.  
> La publication échoue si une Occupation ne peut pas être créée.

### Compléter l'audit

Tracer :

- utilisateur ;
- date et heure ;
- action ;
- objet concerné ;
- ancienne valeur ;
- nouvelle valeur ;
- origine de l'action ;
- justification éventuelle.

---

## 04 — Espace public

### Modifier « Inscriptions »

Remplacer :

> renseigner les deux joueurs

par :

> renseigner les membres exigés par le format de compétition configuré.

Ajouter :

> La confirmation finale exige une authentification.

### Modifier « Calendrier public »

Remplacer la section par :

> Le calendrier public est une projection des Occupations publiables.  
> Il n'expose jamais les données privées, les commentaires internes, les identifiants techniques ou les motifs non publics.

### Modifier « Réservation d'un terrain »

Remplacer :

> Le portail affiche uniquement les créneaux réellement disponibles.

par :

> Le portail affiche les créneaux disponibles au moment de la consultation.  
> La disponibilité est obligatoirement revalidée au moment de la confirmation.

Remplacer :

> mis à jour en temps réel

par :

> mis à jour automatiquement.

### Ajouter une section « Sécurité et confidentialité »

- seules les données publiées sont exposées ;
- aucune donnée privée n'est envoyée inutilement au navigateur ;
- les autorisations sont contrôlées côté serveur ;
- le formulaire de contact est protégé contre les abus ;
- aucune information sensible n'est déduite du seul affichage.

---

## 05 — Espace administration

### Modifier « Tableau de bord »

Remplacer :

> prochains événements

par :

> prochaines activités et Occupations publiables.

### Modifier « Génération du planning »

Ajouter :

> Le moteur de planification contrôle les contraintes sportives.  
> Le domaine Calendrier contrôle uniquement les conflits d'occupation des ressources.

### Remplacer « Calendrier »

> Le calendrier d'administration affiche les Occupations provenant des différents domaines :
>
> - réservations ;
> - matchs publiés ;
> - entraînements ;
> - fermetures ;
> - maintenance ;
> - animations ;
> - usages privés.
>
> Les opérations autorisées sont :
>
> - créer une Occupation administrative ;
> - déplacer une Occupation ;
> - modifier sa période ou sa ressource ;
> - annuler une Occupation ;
> - consulter son origine et son historique.
>
> Une Occupation issue d'un autre domaine ne peut être modifiée que par un cas d'usage respectant les règles de son domaine d'origine.

### Modifier « Résultats »

Remplacer :

> publie immédiatement les résultats

par :

> rend les résultats validés publiables automatiquement.

La publication effective dépend de la politique de publication.

### Modifier « Communication »

Remplacer :

> immédiatement visible

par :

> visible dès sa publication.

### Modifier « Sécurité »

Ajouter les champs d'audit complets définis dans le document 03.

---

## 06 — Gestion des tournois

### Remplacer le cycle de vie

```text
Préparation
→ Configuration
→ Inscriptions ouvertes
→ Inscriptions fermées
→ Poules générées
→ Poules validées
→ Planning généré
→ Planning publié
→ En cours
→ Terminé
→ Archivé
```

État terminal parallèle :

```text
Annulé
```

### Ajouter les transitions contrôlées

Policies minimales :

- CanConfigureTournamentPolicy
- CanOpenRegistrationsPolicy
- CanCloseRegistrationsPolicy
- CanGeneratePoolsPolicy
- CanValidatePoolsPolicy
- CanGeneratePlanningPolicy
- CanPublishPlanningPolicy
- CanStartTournamentPolicy
- CanFinishTournamentPolicy
- CanArchiveTournamentPolicy
- CanCancelTournamentPolicy

### Modifier « Gestion des séries »

Ne plus utiliser `capacité = 0` comme état.

Une série possède :

- `enabled`
- `capacity`

Règles :

- `enabled = false` : série indisponible ;
- `enabled = true` : capacité strictement positive ;
- la capacité ne peut pas être inférieure au nombre d'équipes déjà acceptées.

### Modifier « Génération des poules »

Les disponibilités sont des préférences ou contraintes selon leur niveau configuré.

Le moteur doit distinguer :

- contraintes obligatoires ;
- préférences ;
- diagnostics ;
- score de qualité.

### Modifier « Annulation »

> L'annulation du tournoi annule les Occupations futures créées par le tournoi.  
> Elle ne supprime ni les inscriptions, ni les poules, ni les résultats déjà conservés à titre historique.

---

## 07 — Génération des poules

### Action

Le chapitre est absent ou fusionné avec le chapitre 06 dans le corpus fourni.

Créer un fichier autonome :

`Docs/07-Generation-des-poules.md`

Il doit reprendre uniquement :

- entrées du Pool Engine ;
- contraintes obligatoires ;
- préférences ;
- génération de plusieurs solutions ;
- score de qualité ;
- diagnostics ;
- validation ;
- immutabilité après validation ;
- règles de régénération.

### Règle importante

Le Pool Engine :

- ne planifie aucun match ;
- ne crée aucune Occupation ;
- ne lit pas Supabase ;
- ne modifie aucune équipe ;
- retourne des propositions sans les enregistrer.

---

## 08 — Moteur de planification

### Ajouter aux données d'entrée

- ressources utilisables ;
- Occupations existantes sur les périodes concernées ;
- durée des matchs ;
- temps de repos minimal ;
- contraintes obligatoires ;
- préférences pondérées.

### Séparer explicitement les responsabilités

Planning Engine :

- affecte les rencontres aux créneaux ;
- respecte les contraintes sportives ;
- optimise la qualité du planning.

Calendar Domain :

- valide la coexistence physique des Occupations ;
- ne connaît pas les disponibilités sportives ;
- ne calcule pas les temps de repos ;
- ne choisit pas l'ordre des matchs.

### Modifier « Validation »

> La validation métier du planning précède sa publication.  
> La publication crée les Occupations du tournoi.  
> Si une Occupation est refusée, la publication complète échoue sans publication partielle.

### Ajouter

Policies minimales :

- CanScheduleMatchPolicy
- HasSufficientRestPolicy
- IsTeamAvailablePolicy
- IsCourtAllowedPolicy
- CanPublishPlanningPolicy

---

## 09 — Résultats et classements

### Remplacer les règles par défaut

Ne pas imposer comme règle officielle :

1. victoires ;
2. différence de points ;
3. points marqués ;
4. confrontation directe.

Remplacer par :

> Les règles de points, de classement et de départage proviennent du règlement configuré pour le tournoi.

### Ajouter le format actuellement prévu

Le moteur doit pouvoir représenter notamment :

- match en deux manches gagnantes ;
- manches principales en 20 points ;
- manche décisive en 10 points ;
- barème configurable ;
- goal-average configurable ;
- ordre de départage configurable.

### Séparer les états

Match :

```text
À programmer
→ Programmé
→ En cours
→ Terminé
→ Validé
→ Archivé
```

États alternatifs :

```text
Annulé
Forfait
Reporté
```

### Ajouter

Policies minimales :

- CanStartMatchPolicy
- CanEnterResultPolicy
- IsScoreValidPolicy
- CanValidateResultPolicy
- CanCorrectValidatedResultPolicy

### Modifier « Publication »

> Un résultat validé devient publiable.  
> Une correction conserve l'ancien résultat dans l'audit et déclenche un recalcul intégral.

---

## 10 — Réservations

### Remplacer toutes les phrases présentant la réservation comme un événement

Texte officiel :

> Une réservation est un agrégat métier autonome.  
> Une réservation confirmée crée une Occupation dans le Calendrier.  
> Le Calendrier ne connaît ni le client, ni le tarif, ni le statut de paiement.

### Remplacer « Types d'occupation »

Utiliser le vocabulaire `Occupation`, jamais `événement du calendrier`.

### Ajouter les états de réservation

```text
Brouillon
→ En attente
→ Confirmée
→ Terminée
```

États alternatifs :

```text
Annulée
Refusée
Expirée
Absence
```

### Ajouter les Policies

- CanCreateReservationPolicy
- CanConfirmReservationPolicy
- CanModifyReservationPolicy
- CanCancelReservationPolicy
- CanOccupyTimeRangePolicy
- CanMoveOccupationPolicy
- ReservationAdvanceWindowPolicy
- ReservationQuotaPolicy
- LicenseePriorityPolicy

### Modifier « Modification »

Distinguer :

- modification de métadonnées : pas de déplacement Calendrier ;
- modification de date, heure, durée ou terrain : déplacement d'Occupation avec revalidation complète.

### Modifier « Annulation »

> L'annulation métier de la réservation annule l'Occupation associée.  
> Aucun des deux objets n'est supprimé physiquement.

---

## 11 — Mode TV

### Modifications ciblées

Remplacer :

> mis à jour en temps réel

par :

> actualisé automatiquement après publication ou validation.

Ajouter :

> Le Mode TV consomme exclusivement des projections publiques.  
> Il n'accède jamais aux modèles métier internes ni aux données privées.

Aucune autre modification.

---

## 12 — Règles métier

### Remplacer le cycle de tournoi

Utiliser le cycle officiel défini dans les chapitres 03 et 06.

### Modifier « Séries »

Remplacer la règle `capacité égale à zéro` par :

- une série désactivée possède `enabled = false` ;
- une série active possède une capacité strictement positive.

### Modifier « Équipes »

Remplacer :

> Une équipe est composée de deux joueurs.

par :

> Une équipe respecte le nombre et les rôles de joueurs définis par le format de compétition.

### Modifier « Disponibilités »

Distinguer :

- indisponibilité obligatoire ;
- disponibilité préférée ;
- disponibilité possible.

### Remplacer « Réservations » et « Calendrier »

> Une réservation confirmée possède une Occupation associée.  
> Seul le domaine Calendrier décide de l'existence d'un conflit de ressource et de période.  
> Seul le domaine Réservations décide si l'utilisateur a le droit de réserver.

### Ajouter les invariants essentiels

- un `TimeRange` possède un début strictement antérieur à sa fin ;
- une Occupation concerne exactement une ressource ;
- une Occupation active ne chevauche aucune Occupation incompatible ;
- un résultat validé est la seule source du classement ;
- une rencontre ne peut être programmée qu'une fois ;
- une publication de planning est atomique ;
- aucune capacité transverse ne prend de décision métier ;
- un objet archivé n'est plus modifiable hors procédure explicite.

### Ajouter une règle d'autorité

> En cas de contradiction :
>
> 1. les ADR acceptés fixent les décisions d'architecture ;
> 2. la Domain Map fixe les frontières ;
> 3. le Glossaire fixe le vocabulaire ;
> 4. les règles métier fixent les invariants ;
> 5. les documents fonctionnels fixent les parcours.

---

## 13 — Architecture technique

### Remplacer l'architecture générale

```text
Presentation / Features
        ↓
Application
        ↓
Domain
        ↑
Infrastructure
```

Préciser :

- l'Application dépend du Domain ;
- l'Infrastructure implémente les interfaces définies par le Domain ou l'Application ;
- le Domain ne dépend d'aucune couche ;
- les Features ne dialoguent pas directement avec Supabase.

### Structure officielle

```text
src/
├── app/
├── application/
│   ├── club/
│   ├── reservations/
│   ├── tournaments/
│   └── shared/
├── domain/
│   ├── club/
│   ├── people/
│   ├── calendar/
│   ├── reservations/
│   ├── tournaments/
│   ├── planning/
│   ├── ranking/
│   └── communication/
├── features/
├── infrastructure/
│   ├── supabase/
│   ├── repositories/
│   ├── auth/
│   ├── storage/
│   └── logger/
└── shared/
```

### Remplacer « Services »

Distinguer :

- Application Services / Use Cases : orchestration ;
- Domain Services : logique métier ne relevant pas naturellement d'une entité ;
- Infrastructure Services : détails techniques.

### Ajouter les DTO

> Les données entrant ou sortant d'un cas d'usage sont représentées par des DTO.  
> Les DTO ne sont ni des entités métier ni des lignes SQL.

### Ajouter les transactions

> Les cas d'usage créant plusieurs objets cohérents doivent être atomiques.  
> Exemple : publication du planning et création de toutes ses Occupations.

### Ajouter les événements de domaine

Exemples :

- TournamentRegistrationsOpened
- PoolsValidated
- PlanningPublished
- ReservationConfirmed
- ReservationCancelled
- MatchResultValidated

Ils expriment un fait passé et ne contiennent aucune dépendance technique.

---

## 14 — Conventions de développement

### Ajouter « Nommage DDD »

- entités et Value Objects au singulier ;
- événements de domaine au passé ;
- Policies sous forme de capacité ou question ;
- Use Cases sous forme de verbe d'action ;
- repositories abstraits nommés `XRepository` ;
- implémentations techniques nommées `SupabaseXRepository`.

### Ajouter « Interdictions »

- aucun type Supabase dans `src/domain` ;
- aucun import React dans `src/domain` ;
- aucun appel réseau dans un moteur ;
- aucune règle métier dans un composant ;
- aucune règle métier dupliquée côté client et serveur ;
- aucun `Date` brut pour représenter une période métier sans encapsulation ;
- aucun statut métier sous forme de chaîne libre.

### Ajouter « Taille du code »

Les limites de 300 lignes par composant et 50 lignes par fonction sont des alertes de conception, pas des interdictions absolues. Toute exception doit rester lisible et justifiée.

### Ajouter « Tests »

Pour chaque Policy ou moteur :

- cas nominal ;
- limites ;
- refus ;
- incohérences ;
- déterminisme ;
- absence d'effet de bord.

### Ajouter « ADR »

Toute modification portant sur :

- frontière de domaine ;
- dépendance entre domaines ;
- structure de couches ;
- technologie structurante ;
- invariant global ;

doit être documentée dans `Docs/DECISIONS.md`.

---

## 15 — Roadmap

### Ne pas renommer la refonte documentaire en version fonctionnelle 2.1

Ajouter une section séparée :

## Consolidation documentaire et architecturale

Avant la poursuite fonctionnelle de la V2 :

- adoption de la Domain Map ;
- harmonisation Event → Occupation ;
- modèle Person / Account / Membership / Player ;
- adoption des Value Objects Calendar ;
- formalisation des Policies ;
- consolidation des ADR ;
- création du domaine Calendar de référence.

### Conserver les versions fonctionnelles existantes

Ne pas déplacer l'API publique en V2.2.  
Conserver l'API publique en V3.0 sauf décision ultérieure.

---

## 16 — Glossaire métier

### Conserver le document et le déclarer « Ubiquitous Language officiel »

Ne pas créer un second glossaire concurrent.

### Ajouter ou remplacer les définitions suivantes

#### Compte utilisateur

Identité d'accès authentifiée. Un compte peut être associé à une personne.

#### Personne

Individu connu du club indépendamment de l'existence d'un compte.

#### Adhésion

Relation entre une personne et le club pour une période donnée.

#### Licencié

Personne possédant une licence ou adhésion sportive valide selon les règles du club.

#### Joueur

Personne participant sportivement à une compétition.

#### Ressource

Élément dont l'usage peut être occupé dans le temps : terrain, salle ou espace.

#### TimeRange / Période

Intervalle possédant un début inclus et une fin exclue, avec début strictement antérieur à la fin.

#### Occupation

Blocage d'une ressource pendant une période, créé à la demande d'un domaine d'origine.

#### Conflit

Incompatibilité entre deux Occupations concernant la même ressource et des périodes qui se chevauchent.

#### Visibilité

Règle déterminant si une information peut être exposée publiquement, aux membres ou uniquement aux administrateurs.

#### Réservation

Engagement métier entre un utilisateur et le club pour utiliser une ressource. Une réservation confirmée crée une Occupation.

#### Événement du club

Contenu ou activité organisée par le club. Ce terme éditorial ne doit pas être utilisé pour désigner une Occupation technique du Calendrier.

### Supprimer ou corriger

Remplacer :

> Une réservation est représentée par un événement du calendrier.

par :

> Une réservation confirmée possède une Occupation associée dans le Calendrier.

---

## 17 — Roadmap vide / doublon

Le fichier vide intitulé `17 Roadmap` doit être supprimé ou remplacé par un simple fichier de redirection vers `15-Roadmap.md`.

Ne conserver qu'une seule Roadmap officielle.

---

## 18 — Assurance qualité

### Conserver

### Ajouter

Critères de fin pour une fonctionnalité :

- règles métier documentées ;
- tests unitaires du domaine ;
- tests d'intégration du cas d'usage ;
- contrôle des autorisations ;
- journalisation utile ;
- audit si nécessaire ;
- aucune dépendance interdite ;
- documentation synchronisée ;
- migration versionnée si nécessaire.

Ajouter des tests d'architecture automatiques :

- absence d'import React dans `src/domain` ;
- absence d'import Supabase dans `src/domain` ;
- absence d'import Infrastructure depuis Domain ;
- moteurs sans appels réseau ;
- routes regroupées selon l'ADR officielle.

---

# DOCUMENTS D'ARCHITECTURE DÉJÀ RÉCUPÉRÉS À CONSERVER

Les documents récupérés depuis l'historique Codex ne doivent pas être recréés s'ils existent déjà dans le dépôt.

## À conserver comme références

- `Docs/Architecture/01-Domain-Map.md`
- Architecture officielle
- Domain Map
- Ubiquitous Language
- Calendar Model
- CalendarEvent / Occupation Model
- Calendar Value Objects
- Calendar Policies
- `Docs/DECISIONS.md`

## Action de consolidation

1. vérifier les doublons ;
2. conserver la version la plus complète ;
3. renommer `CalendarEvent` en `Occupation` lorsque le document traite de l'occupation générique ;
4. ajouter en tête de chaque document :
   - statut ;
   - version ;
   - date ;
   - document remplacé éventuel ;
5. référencer ces documents depuis `01-Architecture-generale.md`.

---

# ADR À AJOUTER OU À CONFIRMER

## ADR — Calendar utilise Occupation

Le Calendrier manipule des Occupations génériques et ne possède pas les objets métier Réservation, Match ou Entraînement.

## ADR — Huit domaines officiels

La Domain Map fixe les huit domaines métier officiels.

## ADR — Administration n'est pas un domaine métier

L'administration est une interface et un ensemble de cas d'usage transverses soumis aux autorisations.

## ADR — Personne distincte du compte

Une personne, un compte utilisateur, une adhésion et un rôle de joueur possèdent des cycles de vie distincts.

## ADR — Série activée explicitement

L'activation d'une série est portée par un booléen ou un état explicite, jamais par `capacity = 0`.

## ADR — Publication atomique du planning

La publication d'un planning crée toutes les Occupations ou aucune.

## ADR — Classements dérivés

Les résultats validés sont persistés ; les classements sont recalculables.

## ADR — Une seule navigation applicative

Une seule application et un seul shell, adaptés selon les droits.

## ADR — Domaine dans `src/domain`

Le domaine pur est placé dans `src/domain`.

## ADR — Routes dans les features

Les écrans routables appartiennent à leurs features ; la composition du routeur reste centralisée dans `src/app`.

---

# REMPLACEMENTS GLOBAUX AUTORISÉS

Effectuer uniquement dans le sens Calendrier :

| Ancien terme | Nouveau terme |
|---|---|
| événement du calendrier | Occupation |
| CalendarEvent générique | Occupation |
| liste des événements du calendrier | liste des Occupations |
| conflit entre événements | conflit entre Occupations |
| créer un événement via réservation | créer une Occupation pour une réservation |

Ne pas remplacer :

- événement du club ;
- événement public ;
- événement éditorial ;
- événement de domaine.

---

# ORDRE D'EXÉCUTION

1. Sauvegarder l'état actuel dans Git.
2. Supprimer le doublon `17 Roadmap`.
3. Mettre à jour le Glossaire.
4. Confirmer la Domain Map.
5. Ajouter ou confirmer les ADR.
6. Mettre à jour les chapitres 00, 01, 02 et 12.
7. Mettre à jour les chapitres 03 à 11.
8. Mettre à jour les chapitres 13 à 15 et 18.
9. Créer le chapitre 07 autonome s'il manque réellement.
10. Rechercher les anciens usages de `Event`, `évènement` et `événement du calendrier`.
11. Vérifier qu'aucun événement éditorial n'a été renommé par erreur.
12. Lancer le contrôle final de cohérence.
13. Créer un commit documentaire unique.

---

# CONTRÔLE FINAL

La consolidation est terminée uniquement si :

- un seul Glossaire existe ;
- une seule Roadmap existe ;
- une seule Domain Map existe ;
- `Occupation` est le terme unique du Calendrier ;
- Réservation et Match restent des concepts de leurs domaines respectifs ;
- les huit domaines sont identiques dans tous les documents ;
- le cycle du tournoi est identique partout ;
- la série possède un état d'activation explicite ;
- le nombre de joueurs dépend du format ;
- visiteur et utilisateur ont les mêmes droits dans tous les documents ;
- les classements sont dérivés des résultats validés ;
- les documents récupérés depuis Codex sont intégrés sans doublon ;
- toutes les décisions structurantes sont consignées dans `DECISIONS.md`.

---

# LIVRABLE ATTENDU APRÈS APPLICATION

```text
Docs/
├── 00-Vision-du-projet.md
├── 01-Architecture-generale.md
├── 02-Modele-metier-et-base-de-donnees.md
├── 03-Parcours-utilisateurs.md
├── 04-Espace-public.md
├── 05-Espace-administration.md
├── 06-Gestion-des-tournois.md
├── 07-Generation-des-poules.md
├── 08-Moteur-de-planification.md
├── 09-Resultats-et-classements.md
├── 10-Reservations.md
├── 11-Mode-TV.md
├── 12-Regles-metier.md
├── 13-Architecture-technique.md
├── 14-Conventions-de-developpement.md
├── 15-Roadmap.md
├── 16-Glossaire-metier.md
├── 18-Assurance-qualite.md
├── DECISIONS.md
└── Architecture/
    ├── 01-Domain-Map.md
    ├── 02-Architecture-officielle.md
    ├── 03-Ubiquitous-Language.md
    └── Calendar/
        ├── 01-Calendar-Model.md
        ├── 02-Occupation.md
        ├── 03-Value-Objects.md
        └── 04-Policies.md
```

**Fin du plan de modifications V2.1.**
