# 13 - Assurance qualité

Version : 2.0

Ce document définit les principes de qualité appliqués au développement de Pelote Manager.

L'objectif est de garantir la stabilité, la fiabilité et la cohérence de l'application tout au long de son évolution.

---

# Objectif

Chaque nouvelle fonctionnalité doit être :

- fonctionnelle ;
- testée ;
- documentée ;
- cohérente avec les règles métier.

La qualité est une responsabilité permanente.

Elle ne constitue jamais une étape finale.

---

# Philosophie

Pelote Manager privilégie :

- la simplicité ;
- la robustesse ;
- la lisibilité ;
- la maintenabilité.

Une fonctionnalité simple et fiable est toujours préférable à une fonctionnalité complexe.

---

# Documentation

Toute fonctionnalité importante doit être documentée avant son développement.

La documentation constitue la référence du projet.

Le code doit respecter la documentation.

---

# Développement

Chaque évolution doit :

- respecter l'architecture du projet ;
- respecter les règles métier ;
- conserver la compatibilité avec les fonctionnalités existantes.

Une évolution ne doit jamais dégrader une fonctionnalité déjà validée.

---

# Validation fonctionnelle

Chaque fonctionnalité doit être vérifiée manuellement.

Les principaux scénarios doivent être testés.

Exemples :

- création d'un tournoi ;
- inscription d'une équipe ;
- génération des poules ;
- génération du planning ;
- saisie des résultats ;
- réservation d'un créneau.

---

# Tests unitaires

Les moteurs métier doivent disposer de tests automatisés.

Notamment :

- Pool Engine ;
- Planning Engine ;
- Ranking Engine.

Chaque moteur doit produire les mêmes résultats pour les mêmes données.

---

# Tests d'intégration

Les principaux workflows doivent être testés.

Exemples :

Création d'un tournoi

↓

Ouverture des inscriptions

↓

Création des poules

↓

Planning

↓

Résultats

↓

Classements

Le workflow complet doit fonctionner sans intervention technique.

---

# Régression

Une correction ne doit jamais provoquer une régression.

Avant chaque publication.

Les fonctionnalités principales doivent être vérifiées.

---

# Performance

Le logiciel doit rester fluide.

Les principales opérations doivent être rapides.

Notamment :

- ouverture des pages ;
- génération des poules ;
- génération du planning ;
- recalcul des classements.

---

# Messages d'erreur

Les messages d'erreur doivent être compréhensibles.

Ils doivent expliquer :

- ce qui s'est produit ;
- pourquoi ;
- comment résoudre le problème.

Les erreurs techniques ne doivent jamais être affichées directement à l'utilisateur.

---

# Sécurité

Toutes les validations importantes doivent être réalisées côté serveur.

Les contrôles effectués dans l'interface ne remplacent jamais les contrôles métier.

---

# Journalisation

Les opérations importantes doivent être enregistrées.

Notamment :

- création d'un tournoi ;
- validation des poules ;
- publication du planning ;
- modification d'un résultat.

Ces informations facilitent le diagnostic des problèmes.

---

# Relecture

Avant toute publication.

Le code doit être relu.

La lisibilité est considérée comme un critère de qualité.

---

# Publication

Une version ne peut être publiée que si :

✓ Les fonctionnalités prévues sont terminées.

✓ Les tests principaux sont validés.

✓ Aucun bug bloquant n'est connu.

✓ La documentation est à jour.

---

# Amélioration continue

Les retours des utilisateurs sont pris en compte.

Les améliorations sont planifiées dans la Roadmap.

Les corrections prioritaires sont intégrées avant les nouvelles fonctionnalités.

---

# Principe fondamental

La qualité ne consiste pas uniquement à corriger les bugs.

Elle consiste à produire un logiciel fiable, cohérent, compréhensible et durable.

Chaque évolution doit améliorer Pelote Manager sans remettre en cause sa stabilité.

---

# Critères de fin V2.1

- règles métier documentées ;
- tests unitaires du domaine ;
- tests d'intégration du cas d'usage ;
- contrôle des autorisations ;
- journalisation utile ;
- audit si nécessaire ;
- aucune dépendance interdite ;
- documentation synchronisée ;
- migration versionnée si nécessaire.

## Tests d'architecture automatiques
- absence d'import React dans `src/domain` ;
- absence d'import Supabase dans `src/domain` ;
- absence d'import Infrastructure depuis Domain ;
- moteurs sans appels réseau ;
- routes regroupées selon l'ADR officielle.
