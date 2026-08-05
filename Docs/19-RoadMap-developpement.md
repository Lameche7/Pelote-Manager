# 19 — Roadmap de développement

Version : 2.1  
Mise à jour : 5 août 2026

Ce document est le tableau de pilotage technique de Pelote Manager. Il décrit l’état réel du produit et ne doit pas être interprété comme une promesse commerciale.

## Légende

- ✅ **Terminé et intégré** : disponible sur `main` et validé.
- 🟡 **Partiel** : une partie fonctionne, le périmètre restant est indiqué.
- ⬜ **À faire** : aucun périmètre complet n’est encore livré.
- 🔒 **Bloqué volontairement** : préparé techniquement mais désactivé pour des raisons de sécurité ou de coût.

## État global

Pelote Manager dispose désormais d’une application de club fonctionnelle pour l’authentification, les profils, les licenciés, les réservations, les tarifs, le paiement simulé, une partie du paramétrage et le Back Office.

Le socle multi-instance est intégré : chaque club est destiné à posséder son propre projet Supabase, son authentification, sa base, son stockage et son déploiement. La plateforme centrale super administrateur a été installée et validée en simulation. Le provisionnement réel demeure désactivé.

---

## Phase 1 — Fondations

**Statut : ✅ Terminé et intégré**

Livré :

- architecture React et TypeScript ;
- client Supabase et authentification ;
- profils utilisateurs ;
- navigation et routes protégées ;
- migrations SQL et politiques de sécurité ;
- tests, typage, lint, formatage et build automatisés ;
- configuration d’identité propre à chaque instance de club.

---

## Phase 2 — Paramétrage du club

**Statut : 🟡 Partiel**

Livré :

- informations du club ;
- horaires d’ouverture ;
- fermetures ;
- saisons ;
- paramètres de réservation ;
- tarifs effectivement appliqués aux réservations.

Reste à réaliser :

- paramètres propres aux tournois ;
- définition des créneaux de compétition ;
- finalisation de certains écrans de configuration avancée.

---

## Phase 3 — Gestion des tournois

**Statut : ⬜ À faire**

Périmètre prévu :

- création et cycle de vie d’un tournoi ;
- séries et catégories ;
- ouverture et fermeture des inscriptions ;
- équipes, joueurs et postes ;
- disponibilités ;
- distinction tournoi interne / tournoi ouvert.

Aucun développement ne démarre sans décision explicite de priorité.

---

## Phase 4 — Pool Engine

**Statut : ⬜ À faire**

Périmètre prévu :

- calcul des configurations possibles ;
- génération automatique des poules ;
- diagnostics et score de qualité ;
- validation manuelle avant publication.

---

## Phase 5 — Planning Engine

**Statut : ⬜ À faire**

Périmètre prévu :

- génération des matchs et créneaux ;
- respect des disponibilités et contraintes ;
- optimisation et comparaison de solutions ;
- diagnostics ;
- validation avant publication.

---

## Phase 6 — Ranking Engine et résultats

**Statut : ⬜ À faire**

Périmètre prévu :

- saisie et validation des scores ;
- calcul des points et classements ;
- goal-average et départages ;
- statistiques ;
- publication des résultats.

---

## Phase 7 — Réservations du trinquet

**Statut : ✅ Opérationnel**

Livré :

- calendrier et disponibilités ;
- création et annulation des réservations ;
- prévention des conflits ;
- espace personnel et historique ;
- gestion administrative ;
- tarifs licencié et visiteur ;
- paiement simulé ;
- bases du flux HelloAsso.

À consolider ultérieurement : paiement réel, remboursements et notifications automatiques.

---

## Phase 8 — Portail public

**Statut : 🟡 Partiel**

Livré :

- accueil public ;
- accès aux réservations ;
- inscription et connexion ;
- identité visuelle configurable par club.

Reste à réaliser avec le domaine Tournois :

- inscriptions publiques aux compétitions ;
- planning publié ;
- résultats et classements publics.

---

## Phase 9 — Mode TV

**Statut : ⬜ À faire**

Périmètre prévu : rotation automatique, planning, résultats, classements et partenaires.

---

## Phase 10 — Finalisation produit

**Statut : 🟡 En continu**

Travaux permanents :

- corrections et non-régressions ;
- sécurité et permissions ;
- performance ;
- documentation ;
- déploiements contrôlés ;
- accessibilité et ergonomie.

---

## Chantier transversal — Administration du club

**Statut : 🟡 Consolidation en cours dans la PR44**

Objectifs immédiats :

- utiliser les permissions de `club_memberships` comme source de vérité ;
- synchroniser automatiquement le rôle Administrateur et son habilitation ;
- masquer et protéger le Back Office pour les comptes non habilités ;
- reprendre les anciens administrateurs sans correction SQL manuelle.

---

## Chantier transversal — Plateforme multi-instance

**Statut : ✅ Socle simulé / 🔒 exécution réelle désactivée**

Livré :

- configuration d’une instance par club ;
- registre commercial et technique central séparé ;
- authentification super administrateur distincte ;
- suivi reprenable du provisionnement ;
- plans de coût et confirmations ;
- simulation complète sans création de ressources réelles.

Non livré volontairement :

- création réelle de projets Supabase ;
- création réelle de projets Vercel ;
- facturation ou dépense automatique ;
- partage de comptes ou de données métier entre clubs.

Le mode réel ne sera étudié que lorsqu’un besoin commercial concret le justifiera et après une validation séparée.

---

## Règles de développement

Chaque évolution suit obligatoirement :

1. besoin et périmètre validés ;
2. Issue GitHub ;
3. branche dédiée ;
4. développement et migrations ;
5. tests automatisés ;
6. Preview et validation fonctionnelle ;
7. Pull Request ;
8. fusion contrôlée ;
9. contrôle de production.

Une anomalie critique ou haute est traitée avant une nouvelle fonction non prioritaire.

## Prochaine décision

Après la PR44, la prochaine évolution fonctionnelle sera choisie explicitement. La présente roadmap n’engage pas automatiquement le démarrage du module Tournois, du provisionnement réel ou d’un autre chantier.
