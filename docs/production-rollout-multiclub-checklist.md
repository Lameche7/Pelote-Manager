# Déploiement progressif en production — accès inter-clubs

État au 12 novembre 2026 : **non déployé**. Ne pas fusionner la PR #501 avant validation.

## Conditions bloquantes avant toute écriture en production

- [ ] Confirmer dans Supabase Dashboard qu'une sauvegarde exploitable de la base **business** existe, avec sa date et sa procédure de restauration (les outils disponibles ne permettent pas de le vérifier).
- [ ] Vérifier les changements SQL de la migration `20261112210000_platform_admin_short_lived_leases.sql` et leurs effets sur `has_club_permission` et `get_my_club_access`.
- [ ] Vérifier les trois surcharges SQL `admin_get_dashboard(uuid)`, `admin_dashboard_match_counts(uuid)` et `admin_monthly_match_report(uuid)` sur une base éphémère (CI).
- [ ] Vérifier le contrôle d'identité double plateforme/business de l'Edge Function `platform-business-admin-lease`.
- [ ] Préparer une procédure de désactivation côté Edge et de retrait des autorisations, indépendamment de l'interface.
- [ ] Vérifier que les anciennes fonctions sans argument continuent de fonctionner pour Lourdes.

## Ordre de mise en service

1. Confirmer la sauvegarde et consigner un point de restauration.
2. Appliquer uniquement la migration des autorisations temporaires.
3. Vérifier que les comptes administrateurs ordinaires restent limités à leur club.
4. Installer les trois surcharges SQL à identifiant de club explicite ; conserver les fonctions historiques.
5. Déployer l'Edge Function avec `PLATFORM_ADMIN_LEASES_ENABLED` désactivé par défaut.
6. Tester le refus d'accès sans autorisation, avec autorisation expirée et pour un club non autorisé.
7. Autoriser temporairement le compte super-administrateur de la plateforme.
8. N'ouvrir que la page de tableau de bord inter-clubs en lecture seule, jamais les autres routes admin.
9. Vérifier Lourdes, Morlaàs, puis la révocation et l'expiration de l'autorisation.

## Arrêt d'urgence

- Désactiver l'émission des autorisations temporaires côté serveur.
- Révoquer les autorisations actives ; ne pas se limiter à cacher l'interface.
- Conserver le blocage `adminClubId` des anciennes routes.
- Si une migration SQL a affecté un comportement existant, utiliser le plan de retour arrière vérifié et la sauvegarde, pas un rollback improvisé.

**Aucun déploiement en production sans confirmation de sauvegarde exploitable.**
