# Plan de mise en service — Module Réservations

## Objectif

Livrer un module de réservation exploitable en production avant de démarrer les autres modules fonctionnels.

Le module doit permettre au club de publier les disponibilités du trinquet, aux utilisateurs avec ou sans compte de réserver selon leurs droits, aux utilisateurs connectés de gérer leurs réservations, et aux administrateurs de piloter les règles, occupations et incidents.

## Principes non négociables

- Une seule source de vérité pour les occupations du calendrier.
- Aucun chevauchement sur une même ressource.
- Une réservation annulée n'est jamais supprimée physiquement.
- Toutes les règles métier sont validées côté serveur.
- Les horaires, durées, quotas, tarifs et fenêtres d'anticipation sont paramétrables.
- Les visiteurs peuvent consulter les disponibilités et réserver en fournissant leurs coordonnées.
- Un compte non licencié bénéficie des mêmes conditions qu'un visiteur.
- Seul un statut de licencié actif et validé par un administrateur ouvre les avantages licencié.
- Toute opération sensible est traçable.

## Règles validées pour la mise en service

### Fenêtres d'ouverture des réservations

- Licencié actif validé par un administrateur : réservation possible à partir de 72 heures avant le créneau.
- Utilisateur non licencié avec compte : réservation possible à partir de 48 heures avant le créneau.
- Visiteur sans compte : réservation possible à partir de 48 heures avant le créneau.

Ces valeurs sont des paramètres administrables et ne doivent jamais être codées en dur dans l'interface.

### Tarifs

- Licencié actif validé : 12 € par réservation.
- Utilisateur non licencié ou visiteur : 18 € par réservation.

Les montants sont stockés en centimes, calculés et figés côté serveur au moment de la réservation. Une modification ultérieure du tarif ne modifie pas les réservations déjà créées.

### Validation de la licence

Le rôle applicatif et le statut de licence sont deux notions distinctes. Le statut de licence peut être :

- en attente ;
- actif ;
- expiré ;
- suspendu.

L'avantage licencié est accordé uniquement lorsque le statut est actif, validé par un administrateur et encore valable à la date du créneau. Dans tous les autres cas, les règles publiques de 48 heures et 18 € s'appliquent.

## Découpage de livraison

### PR 11 — Fondations métier et base de données

- Ressources réservables, horaires et paramètres.
- Statut de licence distinct du rôle applicatif.
- Agrégat Réservation et états métier.
- Occupations du calendrier.
- Contraintes anti-chevauchement.
- Calcul serveur de la fenêtre d'ouverture et du tarif.
- RPC sécurisées de création, modification et annulation.
- RLS et journal d'audit.
- Tests SQL et tests unitaires des règles pures.

### PR 12 — Consultation publique du calendrier

- Vue jour et semaine.
- Créneaux libres, occupés et fermés.
- Navigation par date.
- Navigation adaptée à la fenêtre de réservation du profil.
- Affichage adapté au mobile.
- États de chargement, erreurs et absence de disponibilité.

### PR 13 — Parcours de réservation

- Réservation sans compte avec coordonnées obligatoires.
- Création d'une réservation avec compte.
- Confirmation et récapitulatif du tarif appliqué.
- Liste « Mes réservations » pour les utilisateurs connectés.
- Accès sécurisé à une réservation invitée par lien ou référence.
- Modification avec revalidation complète.
- Annulation sans suppression.
- Messages métier explicites en cas de conflit ou de quota dépassé.

### PR 14 — Administration du module

- Gestion des horaires d'ouverture.
- Durée par défaut et pas de réservation.
- Fenêtres d'anticipation licencié et public.
- Tarifs licencié et public.
- Quotas par catégorie.
- Validation, expiration et suspension des licences.
- Fermetures ponctuelles et annuelles.
- Création et modification d'une réservation pour un utilisateur.
- Tableau de suivi et recherche.

### PR 15 — Robustesse et exploitation

- Historique détaillé des changements.
- Gestion des réservations expirées, refusées, terminées et absences.
- Statistiques d'occupation, de tarification et d'annulation.
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
- les fenêtres de 72 heures et 48 heures sont calculées correctement ;
- les tarifs de 12 € et 18 € sont calculés et figés correctement ;
- un statut de licence non validé, expiré ou suspendu ne donne aucun avantage ;
- un utilisateur retrouve, modifie et annule ses réservations selon ses droits ;
- un visiteur peut gérer sa réservation sans accéder aux réservations d'autrui ;
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
