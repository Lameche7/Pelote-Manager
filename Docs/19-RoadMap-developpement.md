# 19 - Roadmap de développement

Version : 2.0

Ce document décrit le plan de développement de Pelote Manager.

Il constitue le document de pilotage technique du projet.

Contrairement à la Roadmap Produit, cette Roadmap est évolutive et peut être mise à jour régulièrement.

---

# Objectif

La Roadmap de développement permet :

- de planifier les développements ;
- de suivre l'avancement du projet ;
- de définir les priorités techniques ;
- de préparer les prochaines versions.

---

# Philosophie

Le développement progresse par étapes.

Chaque étape doit produire une application :

- fonctionnelle ;
- testable ;
- stable.

Une étape n'est jamais considérée comme terminée tant que sa qualité n'est pas validée.

---

# Phase 1 — Fondations

Objectif :

Mettre en place une architecture saine.

Travaux :

- configuration du projet ;
- architecture React ;
- configuration TypeScript ;
- configuration Supabase ;
- authentification ;
- architecture SQL ;
- navigation générale ;
- composants de base.

Statut :

☐ À faire

---

# Phase 2 — Paramétrage

Objectif :

Permettre au club de configurer entièrement son environnement.

Travaux :

- paramètres du club ;
- horaires d'ouverture ;
- paramètres des réservations ;
- paramètres des tournois ;
- créneaux du tournoi.

Statut :

☐ À faire

---

# Phase 3 — Gestion des tournois

Objectif :

Permettre la création complète d'un tournoi.

Travaux :

- création d'un tournoi ;
- gestion des séries ;
- ouverture des inscriptions ;
- gestion des équipes ;
- disponibilités.

Statut :

☐ À faire

---

# Phase 4 — Génération des poules

Objectif :

Développer le Pool Engine.

Travaux :

- calcul des configurations ;
- génération automatique ;
- diagnostics ;
- score de qualité ;
- validation.

Statut :

☐ À faire

---

# Phase 5 — Génération du planning

Objectif :

Développer le Planning Engine.

Travaux :

- génération du calendrier ;
- optimisation ;
- diagnostics ;
- comparaison de plusieurs solutions ;
- validation.

Statut :

☐ À faire

---

# Phase 6 — Résultats

Objectif :

Développer le Ranking Engine.

Travaux :

- saisie des scores ;
- calcul automatique ;
- statistiques ;
- classements ;
- publication.

Statut :

☐ À faire

---

# Phase 7 — Réservations

Objectif :

Mettre en place la réservation du trinquet.

Travaux :

- calendrier ;
- réservations ;
- annulations ;
- paramètres ;
- gestion des conflits.

Statut :

☐ À faire

---

# Phase 8 — Portail public

Objectif :

Mettre à disposition les informations publiques.

Travaux :

- accueil ;
- inscriptions ;
- planning ;
- résultats ;
- classements.

Statut :

☐ À faire

---

# Phase 9 — Affichage dynamique

Objectif :

Développer le Mode TV.

Travaux :

- rotation automatique ;
- résultats ;
- planning ;
- classements ;
- partenaires.

Statut :

☐ À faire

---

# Phase 10 — Finalisation

Objectif :

Préparer la mise en production.

Travaux :

- optimisation ;
- corrections ;
- tests ;
- documentation ;
- déploiement.

Statut :

☐ À faire

---

# Règles de développement

Chaque phase doit respecter les étapes suivantes :

1. Documentation.
2. Développement.
3. Tests.
4. Validation.
5. Intégration.

Aucune phase ne doit être considérée comme terminée sans validation complète.

---

# Gestion des anomalies

Les anomalies sont classées selon leur gravité.

Critique

Empêche l'utilisation du logiciel.

Haute

Fonction importante dégradée.

Moyenne

Fonction secondaire impactée.

Faible

Problème esthétique ou mineur.

Les anomalies critiques sont corrigées avant tout nouveau développement.

---

# Critères de validation

Une phase est validée lorsque :

✓ Les fonctionnalités prévues sont terminées.

✓ Les tests sont validés.

✓ La documentation est à jour.

✓ Les règles métier sont respectées.

✓ Aucun bug bloquant n'est identifié.

---

# Suivi

Le suivi du développement est réalisé au moyen de GitHub.

Chaque évolution est associée à :

- une Issue ;
- une branche dédiée ;
- une Pull Request ;
- une validation avant fusion.

---

# Révision

Cette Roadmap est un document vivant.

Elle est mise à jour à la fin de chaque phase importante.

---

# Principe fondamental

Le développement de Pelote Manager privilégie la qualité à la vitesse.

Chaque étape doit produire une version stable, documentée et évolutive.

L'objectif n'est pas de développer plus vite.

L'objectif est de développer durablement.