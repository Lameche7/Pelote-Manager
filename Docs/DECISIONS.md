ADR-001 : Un seul alias TypeScript est utilisé dans tout le projet : @/, pointant vers src/. Aucun alias spécifique (@components, @services, etc.) n'est créé.
ADR-002

Titre : Un seul client Supabase dans toute l'application

Décision

Le projet possède une seule instance du client Supabase.

Cette instance est créée dans :

src/lib/supabase.ts

Aucun autre fichier ne doit appeler createClient().

Tous les services, composants et moteurs utilisent cette instance.

Pourquoi ?

une seule configuration ;
une seule source de vérité ;
maintenance simplifiée ;
facilité de test.

ADR-003 — Tant que TypeScript requiert baseUrl pour les alias paths, nous le conservons. Les avertissements de dépréciation sont gérés via ignoreDeprecations. Cette décision sera réévaluée lors d'une migration vers TypeScript 7.
ADR-004 — Les fonctionnalités sont développées dans l'ordre du parcours utilisateur

On ne développe jamais une fonctionnalité isolée.

On suit toujours le parcours naturel :

Connexion

↓

Paramètres

↓

Tournoi

↓

Équipes

↓

Disponibilités

↓

Poules

↓

Planning

↓

Résultats

↓

Réservations

↓

Mode TV

Autrement dit, on construit Pelote Manager comme un utilisateur l'utilise, et non comme une liste de composants techniques. Cela rend le développement plus cohérent et facilite les tests à chaque étape.

ADR-005 — Une seule navigation

Le logiciel possède une seule navigation principale.

Cette navigation évolue selon le rôle de l'utilisateur.

On ne développe jamais deux applications distinctes (Admin/Public).

Le shell est unique.
DR-006 — Toute l'application est initialisée depuis src/app/.
ADR-007

Toutes les routes de l'application sont déclarées dans un seul fichier : src/app/router.tsx
---

# Décisions d'architecture V2.1

Statut : Acceptées
Version : 2.1
Date : 2026-07-27

## ADR-008 — Calendar utilise Occupation
Le Calendrier manipule des Occupations génériques et non les objets métier Réservation, Match ou Entraînement.

## ADR-009 — Huit domaines officiels
La Domain Map fixe les huit domaines métier officiels.

## ADR-010 — Administration n'est pas un domaine métier
L'administration est une interface et un ensemble de cas d'usage transverses soumis aux autorisations.

## ADR-011 — Personne distincte du compte
Personne, compte utilisateur, adhésion et rôle de joueur ont des cycles de vie distincts.

## ADR-012 — Série activée explicitement
Une série utilise un booléen ou état explicite et jamais `capacity = 0` comme activation.

## ADR-013 — Publication atomique du planning
La publication crée toutes les Occupations du planning ou aucune.

## ADR-014 — Classements dérivés

Les résultats validés sont persistés ; les classements sont recalculables.

## ADR-015 — Une seule navigation applicative
Une seule application et un seul shell sont adaptés selon les droits. Cette décision confirme ADR-005.

## ADR-016 — Domaine dans `src/domain`
Le domaine pur est placé dans `src/domain`.

## ADR-017 — Routes dans les features
Les écrans routables appartiennent à leurs features ; la composition du routeur reste centralisée dans `src/app`.
