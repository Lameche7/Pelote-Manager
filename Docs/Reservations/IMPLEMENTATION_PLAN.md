# Plan de mise en service — Module Réservations

## Objectif

Livrer un module de réservation exploitable en production avant de démarrer les autres modules fonctionnels.

Le module doit permettre au club de publier les disponibilités du trinquet, aux utilisateurs connectés de réserver et gérer leurs réservations, et aux administrateurs de piloter les règles, occupations et incidents.

## Principes non négociables

- Une seule source de vérité pour les occupations du calendrier.
- Aucun chevauchement sur une même ressource.
- Une réservation annulée n'est jamais supprimée physiquement.
- Toutes les règles métier sont validées côté serveur.
- Les horaires, durées, quotas et fenêtres d'anticipation sont paramétrables.
- Les visiteurs peuvent consulter les disponibilités mais pas réserver.
- Les licenciés peuvent bénéficier de règles spécifiques configurables.
- Toute opération sensible est traçable.

## Découpage de livraison

### PR 11 — Fondations métier et base de données

- Ressources réservables, horaires et paramètres.
- Agrégat Réservation et états métier.
- Occupations du calendrier.
- Contraintes anti-chevauchement.
- RPC sécurisées de création, modification et annulation.
- RLS et journal d'audit.
- Tests SQL et tests unitaires des règles pures.

### PR 12 — Consultation publique du calendrier

- Vue jour et semaine.
- Créneaux libres, occupés et fermés.
- Navigation par date.
- Affichage adapté au mobile.
- États de chargement, erreurs et absence de disponibilité.

### PR 13 — Parcours utilisateur

- Création d'une réservation.
- Confirmation et récapitulatif.
- Liste « Mes réservations ».
- Modification avec revalidation complète.
- Annulation sans suppression.
- Messages métier explicites en cas de conflit ou de quota dépassé.

### PR 14 — Administration du module

- Gestion des horaires d'ouverture.
- Durée par défaut et pas de réservation.
- Fenêtres minimale et maximale d'anticipation.
- Quotas par rôle.
- Fermetures ponctuelles et annuelles.
- Création et modification d'une réservation pour un utilisateur.
- Tableau de suivi et recherche.

### PR 15 — Robustesse et exploitation

- Historique détaillé des changements.
- Gestion des réservations expirées, refusées, terminées et absences.
- Statistiques d'occupation et d'annulation.
- Accessibilité clavier et lecteur d'écran.
- Tests de concurrence sur un même créneau.
- Tests de bout en bout des parcours critiques.
- Vérifications de sécurité et de performance.

### PR 16 — Mise en production

- Paramétrage réel du trinquet.
- Jeu de données initial contrôlé.
- Vérification des droits et politiques Supabase.
- Validation sur mobile et ordinateur.
- Procédure de sauvegarde et retour arrière.
- Guide administrateur.
- Recette finale avant ouverture aux utilisateurs.

## Critères de mise en service

Le module est considéré opérationnel lorsque :

- deux utilisateurs ne peuvent jamais obtenir le même créneau ;
- les fermetures et occupations bloquent immédiatement la réservation ;
- les règles sont appliquées côté serveur et non uniquement dans l'interface ;
- un utilisateur retrouve, modifie et annule ses réservations selon ses droits ;
- un administrateur peut configurer le fonctionnement sans modifier le code ;
- l'historique permet d'expliquer toute création, modification ou annulation ;
- les tests CI, sécurité, concurrence et parcours critiques sont verts ;
- le fonctionnement est validé sur téléphone et ordinateur.

## Hors périmètre avant mise en service

- Tournois.
- Paiement en ligne.
- Cautions.
- Abonnements payants.
- Notifications automatiques avancées.

Ces fonctions devront pouvoir être ajoutées ensuite sans modifier les fondations du calendrier et des réservations.
