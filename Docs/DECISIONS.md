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