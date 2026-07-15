# 09 - Résultats et classements

Version : 2.0

Ce document décrit le fonctionnement du moteur de gestion des résultats et des classements.

Il constitue la référence officielle du Ranking Engine.

Le moteur est totalement indépendant de l'interface utilisateur et de la base de données.

---

# Objectif

Le moteur gère l'ensemble des résultats du tournoi.

À chaque résultat validé.

Le classement est recalculé automatiquement.

Le logiciel garantit à tout moment la cohérence sportive de la compétition.

---

# Philosophie

Le classement n'est jamais saisi.

Il est toujours calculé.

L'administrateur saisit uniquement les résultats.

Toutes les statistiques sont déduites automatiquement.

---

# Données d'entrée

Le moteur reçoit :

- les matchs ;
- les équipes ;
- les scores ;
- le règlement du tournoi.

Le moteur ne réalise jamais de requête SQL.

---

# Données de sortie

Le moteur produit automatiquement :

- les classements ;
- les statistiques des équipes ;
- les statistiques des poules ;
- les indicateurs du tournoi.

Aucune donnée calculée ne doit être modifiée manuellement.

---

# Déroulement d'un match

Un match possède plusieurs états.

À programmer

↓

Programmé

↓

En cours

↓

Terminé

↓

Validé

↓

Archivé

Le passage d'un état à l'autre est contrôlé par le logiciel.

---

# Saisie des résultats

L'administrateur sélectionne un match.

Il saisit :

- le score de l'équipe A ;
- le score de l'équipe B.

Le logiciel vérifie immédiatement :

- la validité des valeurs ;
- la cohérence du résultat ;
- que le match n'est pas déjà validé.

---

# Validation

Une fois validé.

Le résultat devient officiel.

Le logiciel lance immédiatement le recalcul complet des classements.

Aucune action supplémentaire n'est nécessaire.

---

# Calcul automatique

Le moteur recalcule automatiquement :

- matchs joués ;
- matchs gagnés ;
- matchs perdus ;
- points marqués ;
- points encaissés ;
- différence de points ;
- classement de la poule.

Le calcul repart toujours des résultats enregistrés.

Il ne modifie jamais uniquement une ligne.

---

# Classement

Le classement est recalculé après chaque validation.

Les critères de classement sont définis par le règlement du tournoi.

Par défaut.

Le moteur applique :

1. Nombre de victoires

2. Différence de points

3. Points marqués

4. Confrontation directe

5. Tirage au sort si nécessaire

Ces règles pourront évoluer selon le règlement utilisé.

---

# Explication du classement

Le logiciel doit être capable d'expliquer chaque position.

Exemple :

Pourquoi cette équipe est-elle première ?

Réponse :

- même nombre de victoires ;
- meilleure différence de points ;
- confrontation directe gagnée.

Le classement n'est jamais une boîte noire.

---

# Statistiques d'une équipe

Pour chaque équipe.

Le moteur calcule automatiquement :

- matchs joués ;
- matchs gagnés ;
- matchs perdus ;
- points marqués ;
- points encaissés ;
- différence de points ;
- pourcentage de victoires.

Ces statistiques sont recalculées à chaque résultat.

---

# Statistiques d'une poule

Le moteur calcule également :

- nombre de matchs joués ;
- nombre restant ;
- taux d'avancement ;
- nombre total de points ;
- moyenne de points par match.

---

# Statistiques du tournoi

Le logiciel fournit notamment :

- nombre total de matchs ;
- matchs terminés ;
- matchs restants ;
- pourcentage d'avancement ;
- nombre total de points marqués.

Ces statistiques sont utilisées par le tableau de bord.

---

# Interface d'administration

Le module Résultats propose deux modes de fonctionnement.

---

## Mode Saisie

Ce mode est conçu pour être utilisé pendant le tournoi.

L'objectif est de saisir rapidement les résultats.

L'écran présente uniquement :

- les matchs à jouer ;
- les matchs en cours ;
- les matchs en attente de validation.

Chaque fiche de match permet de saisir :

- le score de l'équipe A ;
- le score de l'équipe B.

Après validation.

Le logiciel passe automatiquement au match suivant.

La saisie doit être la plus rapide possible.

---

## Mode Suivi

Le mode Suivi permet à l'organisateur de visualiser l'ensemble de l'avancement du tournoi.

Il affiche notamment :

- le nombre de matchs joués ;
- le nombre de matchs restants ;
- le pourcentage d'avancement ;
- les derniers résultats ;
- les prochains matchs ;
- les classements de toutes les séries.

Ce mode constitue le véritable tableau de bord sportif du tournoi.

---

# Publication

Les résultats validés sont immédiatement publiés.

Le portail public affiche automatiquement :

- les derniers résultats ;
- les classements actualisés ;
- les statistiques du tournoi.

Aucune publication supplémentaire n'est nécessaire.

---

# Correction d'un résultat

Un résultat peut être corrigé.

Après modification.

Le moteur recalcule immédiatement :

- le classement ;
- les statistiques ;
- les indicateurs.

Aucun recalcul manuel n'est nécessaire.

---

# Historique

Chaque modification importante est enregistrée.

Le logiciel conserve :

- la date ;
- l'utilisateur ;
- l'ancien résultat ;
- le nouveau résultat.

Cette traçabilité garantit la fiabilité des données.

---

# Contrôles

Le moteur vérifie notamment :

✓ Le score est valide.

✓ Le match existe.

✓ Les deux équipes sont correctes.

✓ Un match validé ne peut être supprimé.

✓ Les classements sont cohérents.

---

# Performances

Le recalcul doit être suffisamment rapide pour être instantané.

Même après plusieurs centaines de matchs.

L'utilisateur ne doit percevoir aucun délai.

---

# Évolutions prévues

Le moteur pourra ultérieurement intégrer :

- différents systèmes de points ;
- bonus offensifs ou défensifs ;
- phases finales ;
- élimination directe ;
- statistiques individuelles des joueurs.

Ces évolutions ne devront pas remettre en cause son architecture.

---

# Principe fondamental

L'administrateur saisit uniquement les résultats.

Le logiciel calcule automatiquement :

- les classements ;
- les statistiques ;
- l'avancement du tournoi.

Le Ranking Engine garantit en permanence la cohérence sportive de la compétition.

Le logiciel explique toujours les classements.

Il ne demande jamais à l'organisateur d'effectuer un recalcul manuel.