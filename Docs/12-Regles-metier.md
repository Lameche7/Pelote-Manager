# 12 - Règles métier

Version : 2.0

Ce document définit les règles métier fondamentales de Pelote Manager.

Ces règles sont indépendantes de toute technologie.

Elles doivent être respectées par l'ensemble de l'application.

---

# Principe général

Le logiciel applique automatiquement les règles métier.

L'utilisateur ne doit jamais pouvoir créer une situation incohérente.

---

# Club

Le logiciel gère un seul club.

Toutes les données appartiennent à ce club.

Le multi-club pourra être ajouté ultérieurement sans modifier les règles métier.

---

# Tournoi

Un tournoi suit le cycle officiel :

Préparation

↓

Configuration

↓

Inscriptions ouvertes

↓

Inscriptions fermées

↓

Poules générées

↓

Poules validées

↓

Planning généré

↓

Planning publié

↓

En cours

↓

Terminé

↓

Archivé

`Annulé` est un état terminal distinct.

---

# Séries

Une série appartient toujours à un tournoi.

Une série possède :

- un nom ;
- un ordre ;
- une capacité maximale.

Une série désactivée possède `enabled = false` ; une série active possède une capacité strictement positive.

---

# Équipes

Une équipe appartient toujours à une seule série.

Une équipe ne peut jamais appartenir à plusieurs séries d'un même tournoi.

---

Une équipe respecte le nombre et les rôles de joueurs définis par le format de compétition.

Les informations des joueurs doivent être complètes avant validation.

---

# Disponibilités

Chaque équipe peut déclarer ses disponibilités.

Les disponibilités sont prises en compte par :

- le moteur de génération des poules ;
- le moteur de planification.

Les disponibilités ne garantissent jamais un horaire.

Elles représentent une préférence.

---

# Poules

Une équipe appartient à une seule poule.

Toutes les équipes d'une même poule se rencontrent.

Une poule validée ne peut être modifiée qu'après intervention explicite de l'administrateur.

---

# Matchs

Un match oppose exactement deux équipes.

Une équipe ne peut jamais jouer contre elle-même.

Chaque match appartient à une seule poule.

---

# Planning

Un match ne peut être planifié qu'une seule fois.

Deux matchs ne peuvent jamais occuper le même créneau.

Le planning doit respecter les contraintes du tournoi.

---

# Résultats

Un résultat appartient à un seul match.

Le classement est toujours calculé automatiquement.

Il ne peut jamais être modifié manuellement.

---

# Réservations

Une réservation occupe un créneau du calendrier.

Une réservation ne peut jamais entrer en conflit avec :

- un match ;
- une autre réservation ;
- une fermeture ;
- un événement.

---

# Calendrier

Le calendrier constitue la référence unique.

Toute occupation du trinquet est représentée dans le calendrier.

Le calendrier garantit l'absence de conflit.

---

# Utilisateurs

Chaque utilisateur possède un rôle.

Les droits dépendent exclusivement de ce rôle.

Aucun droit ne doit être déduit de l'interface.

---

# Suppression

Les données importantes ne sont jamais supprimées physiquement.

Le logiciel privilégie :

- l'archivage ;
- la désactivation ;
- l'annulation.

L'historique doit être conservé.

---

# Historique

Toutes les opérations importantes doivent être tracées.

Le logiciel conserve notamment :

- la date ;
- l'utilisateur ;
- l'action réalisée.

---

# Validation

Toute étape importante doit être validée.

Exemples :

- validation des poules ;
- validation du planning ;
- validation des résultats.

Une validation engage la suite du processus.

---

# Automatisation

Le logiciel automatise tout ce qui peut l'être.

Cependant.

L'administrateur conserve toujours la décision finale.

Le logiciel propose.

L'organisateur décide.

---

# Cohérence

Le logiciel refuse toute action susceptible de rendre les données incohérentes.

Les messages d'erreur doivent expliquer clairement la raison du refus.

---

# Évolutivité

Toute nouvelle fonctionnalité doit respecter les règles décrites dans ce document.

En cas de contradiction.

Ce document fait référence.

---

# Principe fondamental

Pelote Manager est un assistant d'organisation.

Il automatise les tâches répétitives.

Il contrôle la cohérence des données.

Il explique ses décisions.

L'organisateur reste toujours maître du tournoi.

---

# Règles de référence V2.1

Cycle du tournoi : Préparation → Configuration → Inscriptions ouvertes → Inscriptions fermées → Poules générées → Poules validées → Planning généré → Planning publié → En cours → Terminé → Archivé ; `Annulé` est terminal.

Une série désactivée possède `enabled = false` ; une série active possède une capacité strictement positive. Une équipe respecte le nombre et les rôles définis par le format. Les disponibilités distinguent indisponibilité obligatoire, disponibilité préférée et disponibilité possible.

Une réservation confirmée possède une Occupation associée. Seul le domaine Calendrier décide de l'existence d'un conflit de ressource et de période. Seul le domaine Réservations décide si l'utilisateur a le droit de réserver.

## Invariants essentiels
- un `TimeRange` possède un début strictement antérieur à sa fin ;
- une Occupation concerne exactement une ressource ;
- une Occupation active ne chevauche aucune Occupation incompatible ;
- un résultat validé est la seule source du classement ;
- une rencontre ne peut être programmée qu'une fois ;
- une publication de planning est atomique ;
- aucune capacité transverse ne prend de décision métier ;
- un objet archivé n'est plus modifiable hors procédure explicite.

## Autorité documentaire
1. les ADR acceptés fixent les décisions d'architecture ;
2. la Domain Map fixe les frontières ;
3. le Glossaire fixe le vocabulaire ;
4. les règles métier fixent les invariants ;
5. les documents fonctionnels fixent les parcours.
