# Audit des trois RPC du tableau de bord multi-clubs

Audit en lecture seule du schéma métier Supabase, 12 novembre 2026. Aucun changement de production.

| RPC | Résolution du club | Filtrage des données | Point à corriger |
| --- | --- | --- | --- |
| `admin_get_dashboard()` | `admin_current_club_id()` | Réservations, membres, paiements, fermetures, événements et communications filtrés par club | Ajouter un paramètre de club explicite et vérifier `admin.dashboard.read` |
| `admin_dashboard_match_counts()` | `admin_current_club_id()` | Tournois et liens de championnats filtrés par club | Ajouter un paramètre explicite et conserver les vérifications `tournaments.manage` / `championships.manage` |
| `admin_monthly_match_report()` | `admin_current_club_id()` | Tournois et réservations de championnats filtrés par club | Ajouter un paramètre explicite et supprimer l'hypothèse du nom du trinquet de Lourdes |

## Constat

La fonction `admin_current_club_id()` s'appuie exclusivement sur les adhésions directes de l'utilisateur et rejette les adhésions multiples. Elle ne peut donc pas identifier le club sélectionné par le super-administrateur de plateforme. Le jeton d'autorisation temporaire ne change pas ce constat.

Les trois RPC historiques ne prennent aucun argument. Les appeler après un changement de club dans l'URL ne suffit pas à isoler les données. Les deux fonctions de statistiques utilisent aussi le nom codé en dur `Trinquet Robert Cathala`, inadapté à Morlaàs.

## Séquence de migration prévue

1. Créer des surcharges `(target_club_id uuid)` distinctes sans modifier les RPC sans argument, pour conserver le fonctionnement de Lourdes.
2. Pour chaque surcharge, rejeter un identifiant nul, exiger `auth.uid()` et vérifier les permissions du club demandé **avant toute lecture**. Ne jamais faire confiance au paramètre URL.
3. Conserver tous les prédicats `club_id` sur les tables métiers et filtrer les championnats sur les ressources du club, sans nom de terrain codé en dur.
4. Tester en PostgreSQL éphémère les cas Lourdes, Morlaàs, identifiant inconnu, utilisateur non autorisé, expiration et révocation du bail plateforme.
5. Adapter le client pour appeler les trois surcharges avec le même identifiant explicite ; supprimer ensuite seulement le verrou `AdminShell` et le refus dans `adminDashboardService`.
6. Vérifier les autres modules avant d'ouvrir les écrans de gestion : réservations, tournois, championnats, arbitrage, membres, paiements et communications.

**Ne pas fusionner ni appliquer les migrations de bail de plateforme avant la validation de bout en bout.**

## État de validation sur la PR #501

Les tests PostgreSQL éphémères exécutent les trois surcharges avec deux clubs fictifs et des statistiques distinctes. Ils couvrent le refus sans identité, les identifiants inconnus ou nuls, l'isolation bidirectionnelle, la lecture par un administrateur de son club et la lecture inter-clubs sous bail plateforme, suivie de sa révocation. Les tests de refus après expiration figurent également dans la suite.

Le raccordement applicatif doit respecter les étapes suivantes :

1. Déployer **ensemble** la migration de bail, les trois surcharges validées et la fonction Edge d'émission/révocation, après revue des droits et tests sur une base de préproduction. Les scripts sous `tests/sql` restent des brouillons et ne doivent pas être appliqués directement en production.
2. Introduire un chemin de lecture explicitement paramétré dans `adminDashboardService` : les **trois** appels RPC doivent recevoir exactement le même `target_club_id`. Si un seul appel échoue, ne pas présenter un tableau de bord partiellement rempli comme un résultat complet.
3. Pour un changement de club, réinitialiser immédiatement les données et états React du club précédent ; ignorer les réponses asynchrones d'une sélection antérieure. Vérifier les permissions côté serveur à chaque requête.
4. Conserver les RPC historiques sans argument pour le parcours Lourdes tant que la migration applicative n'est pas complète.
5. Ne permettre au sélecteur de club d'ouvrir initialement **que** le tableau de bord en lecture seule. Les autres routes administratives restent bloquées tant que leurs lectures et mutations ne sont pas explicitement isolées.
6. Tester la déconnexion, l'expiration du bail, la révocation, le changement rapide de club, le rafraîchissement de page et le refus d'accès. Un bail expiré ne doit jamais provoquer un retour silencieux vers les données de Lourdes.
7. N'activer le parcours inter-clubs qu'après un test fonctionnel de bout en bout sur préproduction et une revue du modèle d'authentification plateforme + métier.

**État actuel :** aucun déploiement des nouvelles surcharges ou du bail sur la base métier ; le verrou de `AdminShell` et le refus de `adminDashboardService` restent obligatoires.
