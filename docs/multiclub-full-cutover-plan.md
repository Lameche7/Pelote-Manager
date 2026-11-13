# Pilotoki — préparation du basculement complet multi-clubs

## Règle de livraison
Une base métier unique, clubs séparés par `club_id`. Aucun changement SQL en production et aucune fusion avant validation de toutes les lectures, écritures et autorisations. Lourdes reste utilisable. Morlaàs démarre sans données de tournoi.

## Audit confirmé
- Le catalogue contient Lourdes et Morlaàs, avec des identifiants distincts.
- Le sélecteur actuel ne change que le paramètre `club` (aperçu visuel).
- La session plateforme est indépendante de la session métier et peut être absente.
- `get_my_club_access()` ne connaît que les adhésions métier ; `admin_current_club_id()` n'accepte pas un club étranger.
- `AdminShell` bloque volontairement `adminClubId` ; ne pas supprimer ce verrou avant la migration complète.
- Les RPC du tableau de bord `admin_get_dashboard`, `admin_dashboard_match_counts` et `admin_monthly_match_report` requièrent des surcharges `target_club_id` contrôlées.
- Les anciennes RPC doivent rester disponibles pour les utilisateurs habituels.

## Chantiers obligatoires
- [ ] Authentification : lier les identités plateforme et métier, gérer session absente/expirée, révocation et déconnexion sans élargissement implicite des droits.
- [ ] Autorisations : bail serveur court, révocable et audité ; refus des utilisateurs ordinaires pour un club tiers ; vérifications RLS et RPC.
- [ ] Contexte : club actif dans le bandeau sur tous les écrans, persistant entre les routes et après actualisation ; validation du catalogue ; suppression du cache de l'ancien club.
- [ ] Accueil : branding, événements, tournois et liens propres au club actif.
- [ ] Réservations : disponibilités, créneaux, réservations, reports, échanges, permanents et paiements ciblés par club.
- [ ] Tournois : création, équipes, poules, programmation, résultats, qualifications, imports et notifications ciblés par club.
- [ ] Championnats : calendrier, équipes, arbitres, programmation, résultats, import et phases finales ciblés par club.
- [ ] Arbitrage : propositions, affectations, changements de créneaux, saisies et notifications ciblés par club.
- [ ] Administration : tableau de bord, membres, utilisateurs, licences, communications, événements, réglages, tarification, statistiques et Mode TV.
- [ ] Stockage : logos et médias séparés par club, avec politiques de lecture/écriture vérifiées.
- [ ] Mode joueur : préserver l'affiliation sportive et les participations extérieures indépendamment du club administré.
- [ ] Tests : Lourdes, Morlaàs vide, compte super-admin, admin Lourdes, admin Morlaàs, joueur extérieur, utilisateur non connecté, session expirée, révocation, changement rapide de club, refus inter-clubs.
- [ ] Déploiement : sauvegarde exploitable vérifiée, migrations revues, CI verte, vérification de toutes les routes, puis fusion et déploiement coordonnés.

## Interdictions avant validation
Ne pas déduire une permission du `club` de l'URL ou du stockage navigateur. Ne pas contourner `enforce_single_club_administrator()`. Ne pas déployer `service_role` dans le client. Ne pas afficher des données Lourdes lorsque Morlaàs est sélectionné, même en cas d'erreur de chargement.
