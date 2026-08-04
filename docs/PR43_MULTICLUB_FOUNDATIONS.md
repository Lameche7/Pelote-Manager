# PR43 — Plateforme et instances de clubs totalement isolées

## 1. Décision d’architecture

Pelote Manager ne partagera pas les comptes, les licenciés ni les données métier entre plusieurs clubs.

La cible retenue est une architecture **multi-instance**, et non une base multi-club partagée :

- un seul produit et un seul dépôt de code source ;
- une plateforme centrale administrée par l’éditeur ;
- une instance technique indépendante pour chaque club client ;
- une base Supabase, une authentification et un stockage propres à chaque club ;
- aucun licencié ni compte utilisateur global commun aux clubs ;
- aucun accès métier automatique du super administrateur aux données des clubs.

Une personne inscrite dans deux clubs possède deux comptes et deux fiches totalement indépendants. Une modification, une suppression ou une suspension dans un club n’a aucun effet dans l’autre.

## 2. Séparation entre plateforme et clubs

### 2.1 Plateforme centrale

La plateforme centrale contient uniquement les informations nécessaires à la commercialisation et à l’exploitation du service :

- identité du club client ;
- formule souscrite ;
- statut commercial : essai, actif, suspendu ou résilié ;
- administrateur principal déclaré ;
- domaine ou sous-domaine attribué ;
- références techniques de l’instance ;
- version applicative déployée ;
- dates de création, renouvellement et suspension ;
- journaux de provisionnement et de maintenance.

La plateforme centrale ne contient pas :

- les licenciés ;
- les membres ;
- les comptes utilisateurs du club ;
- les réservations ;
- les horaires ;
- les tournois ;
- les paiements des réservations ;
- les documents internes du club.

### 2.2 Instance d’un club

Chaque club possède son propre environnement :

```text
Club A
  ├── Supabase Auth A
  ├── Base de données A
  ├── Stockage A
  └── Application configurée pour A

Club B
  ├── Supabase Auth B
  ├── Base de données B
  ├── Stockage B
  └── Application configurée pour B
```

Aucune requête du Club A ne peut atteindre la base du Club B, car les deux clubs n’utilisent pas le même projet Supabase.

## 3. Comptes, administrateurs et licenciés

### 3.1 Super administrateur

Le super administrateur appartient uniquement à la plateforme centrale.

Il peut :

- créer une nouvelle instance de club ;
- suivre son état technique ;
- attribuer son adresse ;
- déclencher une mise à jour ;
- suspendre ou réactiver le service ;
- consulter les journaux de déploiement ;
- gérer l’abonnement et les options.

Il ne devient pas administrateur métier du club et ne consulte pas ses licenciés par défaut.

Une intervention de support dans une instance devra être exceptionnelle, explicite, limitée dans le temps et auditée.

### 3.2 Administrateur du club

Le premier administrateur est créé ou invité dans le projet Supabase propre au club.

Il configure ensuite :

- l’identité visuelle ;
- les installations et terrains ;
- les horaires et fermetures ;
- les tarifs ;
- les règles de réservation ;
- les membres et licenciés ;
- les responsables et leurs permissions ;
- les événements, tournois et paiements.

Il n’accède ni à la plateforme centrale ni aux autres clubs.

### 3.3 Utilisateurs et licenciés

Les utilisateurs sont locaux à l’instance du club.

La même adresse électronique peut être utilisée dans deux clubs, car chaque club possède son propre système d’authentification Supabase.

Exemple :

```text
alain@example.fr dans le Club A = compte A
alain@example.fr dans le Club B = compte B
```

Les deux comptes n’ont aucun identifiant commun et aucune synchronisation automatique.

Les numéros de licence, fiches de membres, saisons, classements et historiques restent exclusivement dans la base du club concerné.

## 4. Code source et déploiements

L’isolation complète ne signifie pas une copie manuelle du code pour chaque client.

La cible reste :

- un seul dépôt GitHub ;
- une seule branche principale ;
- les mêmes migrations et versions applicatives ;
- un déploiement automatisé par instance ;
- des variables d’environnement distinctes pour chaque club.

Chaque instance reçoit notamment :

```text
VITE_SUPABASE_URL propre au club
VITE_SUPABASE_ANON_KEY propre au club
identifiant technique de l’instance
nom de domaine ou sous-domaine du club
```

Une nouvelle version validée est publiée depuis le même code source vers les instances sélectionnées, sans modifier manuellement le code de chaque club.

## 5. Conservation du modèle actuel

Le projet actuel du Pelotaris Club Lourdais devient la première instance de référence.

Les tables `clubs`, les `club_id`, les rôles et les permissions peuvent être conservés dans chaque instance pour la cohérence du modèle métier, mais une instance de club ne contiendra qu’un seul club exploité.

La PR43 ne doit donc plus transformer la base actuelle en base partagée entre plusieurs clubs.

Elle doit préparer :

- un modèle d’instance reproductible ;
- un processus de création d’une nouvelle instance ;
- un contrôle de version des migrations ;
- une configuration initiale sans données du PCL ;
- une plateforme centrale ne contenant aucune donnée métier des clubs.

## 6. Provisionnement d’un nouveau club

Depuis `/super-admin`, la création d’un club devra lancer un processus contrôlé :

1. création de la fiche commerciale du club dans la plateforme centrale ;
2. création ou rattachement d’un projet Supabase dédié ;
3. application de toutes les migrations de référence ;
4. insertion des réglages et rôles standards ;
5. création du déploiement applicatif dédié ;
6. installation des variables d’environnement propres à l’instance ;
7. attribution du sous-domaine ;
8. invitation du premier administrateur ;
9. exécution de tests de santé ;
10. passage de l’instance à l’état actif.

Une création incomplète reste en état `provisioning_failed` et ne doit jamais être présentée comme opérationnelle.

## 7. Mise à jour des clubs

La plateforme doit connaître la version installée sur chaque instance.

Exemple :

```text
PCL Lourdes       version 1.8.0   à jour
US Adéenne        version 1.8.0   à jour
Club de Tarbes    version 1.7.2   mise à jour requise
```

Une mise à jour comprend :

- les migrations Supabase compatibles ;
- le déploiement du nouveau code ;
- un contrôle de santé ;
- un journal de résultat ;
- une stratégie de reprise en cas d’échec.

Les migrations doivent rester reproductibles et ne jamais dépendre de données particulières au PCL.

## 8. Sécurité et confidentialité

L’isolation physique des projets constitue la première barrière de sécurité.

Elle doit être complétée par :

- RLS et permissions dans chaque instance ;
- secrets propres à chaque club ;
- absence de clés Supabase de club dans la base centrale en clair ;
- journalisation des opérations de plateforme ;
- sauvegardes et restaurations indépendantes ;
- suppression ou export d’un club sans toucher aux autres ;
- aucune recherche globale de licenciés entre clubs.

## 9. Nouveau découpage de réalisation

### Phase A — Modèle d’instance reproductible

- identifier toutes les données de démonstration ou spécifiques au PCL ;
- séparer migrations structurelles et données d’initialisation ;
- créer un jeu de réglages standards sans licencié ni réservation ;
- vérifier qu’une base Supabase vide peut devenir une instance fonctionnelle uniquement avec les migrations.

### Phase B — Registre central de plateforme

- créer les tables des clubs clients, abonnements, instances et versions ;
- créer le rôle `platform_admin` ;
- créer les journaux de provisionnement ;
- ne stocker aucune donnée métier de club.

### Phase C — Espace `/super-admin`

- lister les clients ;
- consulter leur état ;
- créer une demande de provisionnement ;
- suspendre ou réactiver une instance ;
- suivre les versions et erreurs techniques.

### Phase D — Provisionnement automatisé

- créer l’instance Supabase dédiée ;
- appliquer les migrations ;
- créer le déploiement et sa configuration ;
- inviter le premier administrateur ;
- contrôler la santé de l’instance.

### Phase E — Assistant du club

- identité du club ;
- terrains ;
- horaires ;
- tarifs ;
- règles ;
- responsables ;
- ouverture publique.

## 10. Critères de validation

La fondation sera validée lorsque :

1. une instance neuve peut être créée sans aucune donnée du PCL ;
2. ses comptes et licenciés sont stockés uniquement dans son projet Supabase ;
3. la même adresse électronique peut créer des comptes indépendants dans deux clubs ;
4. la suppression d’un utilisateur dans un club n’affecte aucun autre club ;
5. une clé ou une panne Supabase d’un club ne donne aucun accès aux autres ;
6. le super administrateur voit les états techniques et commerciaux, pas les licenciés ;
7. une mise à jour commune peut être déployée sans recopier manuellement le code ;
8. le PCL continue de fonctionner comme première instance de référence.

## 11. Règle irrévocable

Aucune fonctionnalité ne devra introduire :

- un annuaire global de licenciés ;
- une fiche membre partagée ;
- un compte utilisateur commun aux clubs ;
- une recherche inter-clubs de personnes ;
- une base métier commune contenant les réservations de plusieurs clubs.

La plateforme vend, provisionne et maintient des instances. Chaque club reste entièrement maître et isolé de ses données.
