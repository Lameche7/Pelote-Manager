# 10 - Réservations

Version : 2.0

Ce document décrit le fonctionnement du module de réservation.

Il définit les règles permettant aux utilisateurs de réserver le trinquet en dehors des périodes occupées par un tournoi ou par un autre événement.

Le moteur de réservation est totalement indépendant de l'interface utilisateur et de la base de données.

---

# Objectif

Le module Réservations permet aux utilisateurs de réserver le trinquet.

Le logiciel garantit qu'aucune réservation ne puisse entrer en conflit avec :

- un tournoi ;
- un match ;
- une fermeture ;
- une maintenance ;
- une autre réservation.

---

# Philosophie

Le logiciel ne gère qu'un seul calendrier.

Toutes les occupations utilisent le même moteur.

Une réservation est simplement un événement du calendrier.

Au même titre qu'un match ou une fermeture.

Cette architecture garantit l'absence de conflit.

---

# Types d'occupation

Le calendrier peut contenir notamment :

- une réservation ;
- un match ;
- une fermeture exceptionnelle ;
- une fermeture annuelle ;
- un événement du club ;
- une animation.

Tous ces événements sont traités de manière identique.

Un créneau occupé ne peut jamais être réservé.

---

# Conditions de réservation

Pour réserver.

L'utilisateur doit posséder un compte.

Les visiteurs non connectés peuvent uniquement consulter les créneaux disponibles.

---

# Création d'une réservation

L'utilisateur choisit :

- une date ;
- une heure de début.

Le logiciel calcule automatiquement :

- l'heure de fin ;
- la durée.

La durée par défaut est définie dans les paramètres du club.

---

# Vérifications automatiques

Avant validation.

Le logiciel contrôle notamment :

- que le créneau existe ;
- qu'il est libre ;
- que le club est ouvert ;
- qu'aucun tournoi n'occupe ce créneau ;
- qu'aucune fermeture n'est prévue ;
- que les règles de réservation sont respectées.

---

# Paramètres du club

L'administrateur peut définir :

- les horaires d'ouverture ;
- les horaires de fermeture ;
- la durée d'une réservation ;
- le nombre maximal de réservations simultanées par utilisateur ;
- le délai minimum avant réservation ;
- le délai maximum de réservation ;
- les jours de fermeture ;
- les périodes de fermeture annuelle.

Toutes ces règles sont paramétrables.

Aucune n'est codée en dur.

---

# Licenciés

Le club peut appliquer des règles particulières aux licenciés.

Par exemple :

- réservation plus longtemps à l'avance ;
- priorité sur certains créneaux ;
- tarifs particuliers.

Ces avantages sont entièrement configurables.

---

# Tournoi

Lorsqu'un tournoi est publié.

Les créneaux utilisés deviennent automatiquement indisponibles.

Aucune règle spécifique n'est nécessaire.

Le moteur considère simplement que ces créneaux sont déjà occupés.

---

# Modification

Une réservation peut être modifiée.

Avant validation.

Le logiciel effectue les mêmes contrôles que lors de sa création.

---

# Annulation

Une réservation peut être annulée.

Elle n'est jamais supprimée.

Son historique est conservé.

---

# Historique

Le logiciel conserve notamment :

- la date de création ;
- le créateur ;
- les modifications ;
- les annulations.

Cette traçabilité garantit un historique complet.

---

# Calendrier

Le calendrier affiche :

- les créneaux libres ;
- les réservations ;
- les matchs ;
- les événements ;
- les fermetures.

L'utilisateur visualise immédiatement les disponibilités.

---

# Statistiques

Le logiciel produit automatiquement :

- le nombre de réservations ;
- le taux d'occupation ;
- les heures les plus demandées ;
- les jours les plus demandés ;
- les annulations ;
- les réservations par utilisateur.

Ces statistiques permettent au club de mieux comprendre l'utilisation du trinquet.

---

# Évolutions prévues

Le module pourra ultérieurement intégrer :

- le paiement en ligne ;
- les cautions ;
- les abonnements ;
- les tarifs variables ;
- les réservations récurrentes ;
- les notifications automatiques.

Ces évolutions ne devront pas remettre en cause son architecture.

---

# Principe fondamental

Le logiciel ne distingue pas un match d'une réservation.

Il gère uniquement des occupations du calendrier.

Cette approche garantit une cohérence parfaite entre les tournois, les réservations et les autres événements organisés par le club.