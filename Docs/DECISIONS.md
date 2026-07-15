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