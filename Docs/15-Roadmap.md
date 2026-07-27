# 15 - Roadmap

Version : 2.0

Ce document définit la stratégie d'évolution de Pelote Manager.

Il décrit les grandes orientations du projet ainsi que les fonctionnalités prévues à moyen et long terme.

La Roadmap constitue un document de pilotage.

Elle ne remplace pas les spécifications fonctionnelles.

---

# Objectif

La Roadmap permet :

- de planifier les évolutions ;
- de définir les priorités ;
- de garantir une progression cohérente du projet.

Elle évolue tout au long de la vie du logiciel.

---

# Philosophie

Pelote Manager évolue par versions.

Chaque version apporte un ensemble cohérent de fonctionnalités.

Une version ne doit jamais introduire une fonctionnalité inachevée.

La stabilité est prioritaire sur la quantité.

---

# Version 2.0

Cette version constitue la refonte complète du projet.

Elle comprend notamment :

- gestion des paramètres du club ;
- gestion des tournois ;
- gestion des séries ;
- inscriptions des équipes ;
- gestion des disponibilités ;
- génération intelligente des poules ;
- génération intelligente du planning ;
- saisie des résultats ;
- calcul automatique des classements ;
- portail public ;
- espace d'administration ;
- réservation du trinquet ;
- affichage dynamique (Mode TV).

Cette version constitue le socle fonctionnel du logiciel.

---

# Version 2.1

Améliorations prévues :

- optimisation du moteur de génération des poules ;
- amélioration du moteur de planification ;
- assistant de réservation proposant des créneaux alternatifs ;
- personnalisation avancée de l'affichage dynamique ;
- statistiques enrichies.

---

# Version 2.2

Fonctionnalités envisagées :

- paiement en ligne des réservations ;
- gestion des abonnements ;
- notifications automatiques par e-mail ;
- rappels des matchs ;
- rappels des réservations.

---

# Version 2.3

Fonctionnalités envisagées :

- tableau de bord statistique avancé ;
- export PDF ;
- export Excel ;
- génération automatique des feuilles de match ;
- rapports de tournoi.

---

# Version 3.0

Évolutions majeures envisageables :

- application mobile ;
- notifications Push ;
- gestion de plusieurs clubs ;
- synchronisation avec des services externes ;
- API publique.

Ces fonctionnalités ne font pas partie du périmètre actuel.

---

# Gestion des évolutions

Toute nouvelle fonctionnalité doit être :

- documentée ;
- validée ;
- priorisée.

Une fonctionnalité ne peut être développée que si son besoin est clairement identifié.

---

# Priorisation

Les évolutions sont classées selon quatre niveaux.

Critique

Fonction indispensable au fonctionnement du logiciel.

---

Importante

Améliore significativement l'expérience utilisateur.

---

Confort

Apporte un gain d'utilisation.

---

Future

Idée retenue mais non planifiée.

---

# Principes d'évolution

Le logiciel privilégie :

- les besoins réels des utilisateurs ;
- la simplicité ;
- la stabilité.

Une nouvelle fonctionnalité ne doit jamais complexifier inutilement l'application.

---

# Révision

La Roadmap est un document vivant.

Elle est mise à jour à chaque nouvelle version importante.

Les fonctionnalités peuvent être :

- ajoutées ;
- reportées ;
- supprimées ;
- re-priorisées.

---

# Principe fondamental

Pelote Manager évolue progressivement.

Chaque version doit améliorer le logiciel sans remettre en cause les fondations existantes.

La qualité et la stabilité restent prioritaires sur la quantité de fonctionnalités.

---

# Consolidation documentaire et architecturale

Avant la poursuite fonctionnelle de la V2 :
- adoption de la Domain Map ;
- harmonisation Event → Occupation ;
- modèle Person / Account / Membership / Player ;
- adoption des Value Objects Calendar ;
- formalisation des Policies ;
- consolidation des ADR ;
- création du domaine Calendar de référence.

Cette consolidation documentaire n'est pas une version fonctionnelle. Les versions existantes sont conservées et l'API publique reste prévue en V3.0.

---

# Annexe — Plan de développement consolidé

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
