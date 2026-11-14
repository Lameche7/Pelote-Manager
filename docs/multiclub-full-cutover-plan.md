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


## Architecture joueur validée — 14 novembre 2026

### Identité, club et navigation
- Une identité Supabase métier unique par personne : même e-mail, même compte, quel que soit le club.
- Une adresse publique stable par club, sous-domaine envisagé `<slug-court>.pelotemanager.fr` (DNS, TLS, configuration Vercel et compatibilité PWA à vérifier avant activation). Ne jamais inférer un droit de l'hôte ou du lien d'entrée.
- Le club d'entrée vient du domaine visité, après résolution côté serveur dans un catalogue public de domaines autorisés ; il reste le club d'accueil tant qu'aucun rattachement validé n'existe.
- Le club d'appartenance sportif est associé à une licence vérifiée. La saisie libre d'un numéro de licence ne suffit pas à prouver l'identité ; prévoir une validation par le club et un contrôle des doublons et des mutations.
- Après rattachement, proposer le club d'appartenance comme club favori, modifiable par le joueur. Le choix du club favori change l'accueil, jamais les permissions.
- Un lien explicite vers un tournoi d'un autre club ouvre toujours le bon tournoi, sans changer automatiquement l'appartenance ou les droits.
- Ne pas confondre : `entryClubId` (origine de navigation), `affiliationClubId` (licence vérifiée), `preferredClubId` (choix utilisateur), `organizerClubId` (propriétaire de la compétition), `authorizedAdminClubId` (droits vérifiés).

### Mes tournois, tous clubs confondus
- `Mon espace → Mes tournois` agrège les participations du compte connecté sur tous les clubs ; il ne filtre PAS sur le club d'accueil ni le favori.
- Chaque carte indique le club organisateur, le tournoi, la série, la prochaine partie, les disponibilités, les résultats, le classement et le tableau de phases finales selon les droits et données disponibles.
- Les notifications et les conflits de programmation concernent toutes les participations du joueur ; les accès aux informations privées doivent être contrôlés côté serveur.
- Pour éviter les doublons et les erreurs de rapprochement, relier les participations à l'identité vérifiée plutôt qu'à une simple correspondance de nom, e-mail ou licence non confirmée.

### Administration modulaire et planning
- Les menus et routes admin dépendent des droits serveur et des modules souscrits par le club ; masquer une entrée de menu n'est pas une protection.
- Offre Tournois + Arbitrage : écran allégé, sans administration Championnats ou Réservations classiques non souscrites ; conserver les paramètres nécessaires au fonctionnement.
- Planning hebdomadaire d'un club : superposition des parties de plusieurs tournois du MÊME club, filtre par tournoi/série/terrain/statut et indication des conflits. Ne pas mélanger les plannings d'autres clubs par défaut.
- Réutiliser les réservations et créneaux existants plutôt que créer un second calendrier divergent.

### Ordre de réalisation sans impact production
1. Auditer la résolution actuelle des liens, l'authentification, les participations et les RLS, sans écriture métier.
2. Ajouter des fonctions pures et des tests unitaires pour la résolution d'un club d'entrée et les règles de priorité, sans activer de nouveaux domaines.
3. Préparer la migration versionnée et les RPC nécessaires à la préférence et à l'affiliation vérifiée ; tests sur base éphémère uniquement.
4. Adapter `Mes tournois` à l'agrégation inter-clubs sécurisée.
5. Ajouter les modules souscrits et le planning hebdomadaire multi-tournois.
6. Vérifier toutes les routes, les liens directs, la déconnexion, la révocation, le cache et les cas Lourdes/Morlaàs avant une livraison coordonnée.

### Garde-fous de livraison
- Ne pas activer les domaines envisagés avant leur configuration réelle.
- Ne pas modifier Supabase production pendant les tests ; une PR partageant la même base n'est PAS un environnement de données isolé.
- Ne pas lancer de prévisualisation Vercel : les builds de PR sont volontairement bloqués pour économiser le quota.
- Ne pas fusionner la PR #514 ni rétablir l'administration d'Antoine avant validation explicite de la séparation inter-clubs.
