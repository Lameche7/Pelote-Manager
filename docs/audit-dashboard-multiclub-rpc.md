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
