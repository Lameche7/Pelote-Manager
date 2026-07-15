# 02 - Modèle métier et base de données

Version : 2.0

Ce document définit le modèle métier officiel de Pelote Manager.

Aucune table SQL ne doit être créée avant validation de ce document.

Le schéma SQL sera une conséquence de ce modèle.

Jamais l'inverse.

---

# 1. Philosophie

La base de données ne représente pas l'interface.

Elle représente le fonctionnement réel du club.

Chaque table correspond à un concept métier.

Chaque relation représente une règle métier.

Aucune table technique ne doit exister sans justification métier.

---

# 2. Les grands domaines

Le logiciel est constitué des domaines suivants.

Club

↓

Installations

↓

Calendrier

↓

Réservations

↓

Tournois

↓

Communication

↓

Utilisateurs

↓

Administration

---

# 3. Domaine Club

Le club est la racine du logiciel.

Il possède :

- des installations
- des utilisateurs
- des paramètres
- des saisons
- des tournois
- des réservations
- des évènements

Un seul club est prévu aujourd'hui.

L'architecture permettra cependant d'en gérer plusieurs.

---

# 4. Domaine Saison

Une saison représente une année sportive.

Exemple :

2026

Elle regroupe :

- les tournois
- les statistiques
- les archives

Une saison possède :

Nom

Date début

Date fin

Etat

---

# 5. Domaine Tournoi

Le tournoi est indépendant.

Chaque tournoi possède :

Nom

Description

Affiche

Date ouverture inscriptions

Date fermeture inscriptions

Début

Fin

Etat

Règlement

Terrains utilisés

Horaires

Séries

Equipes

Poules

Planning

Résultats

Classements

---

Etat possible :

Préparation

Inscriptions ouvertes

Inscriptions fermées

Poules créées

Planning publié

En cours

Terminé

Archivé

---

# 6. Domaine Série

Une série appartient à un tournoi.

Une série possède :

Nom

Ordre

Couleur

Capacité maximale

Visible

Archivée

Exemples :

1ère Série

2ème Série

3ème Série

4ème Série

Féminine

Mixte

Loisirs

Jeunes

---

Une série ne contient aucune logique.

Elle ne fait que classifier les équipes.

---

# 7. Domaine Joueur

Le joueur représente une personne.

Un joueur peut :

être licencié

être utilisateur

être administrateur

jouer plusieurs tournois

changer d'équipe selon les saisons

participer à plusieurs compétitions

Le joueur n'appartient jamais directement à une équipe.

---

# 8. Domaine Equipe

Une équipe est créée pour un tournoi.

Elle appartient :

à une série

d'un tournoi.

Elle contient :

deux joueurs (pour la pala aujourd'hui)

mais l'architecture permettra demain :

1 joueur

3 joueurs

4 joueurs

sans modification majeure.

Une équipe possède :

date d'inscription

validation

commentaires

disponibilités

---

# 9. Domaine Disponibilités

Les disponibilités ne sont pas des créneaux.

Elles sont des règles.

Exemple :

Tous les mardis

17h30 →22h30

Tous les jeudis

19h30 →22h30

Jamais le vendredi

Le moteur génère ensuite les créneaux utilisables.

Cela évite de stocker des milliers de lignes.

---

# 10. Domaine Poules

Une poule appartient :

à une série

d'un tournoi.

Elle contient :

des équipes.

Une poule ne connaît pas le planning.

---

# 11. Domaine Match

Un match appartient :

à une poule.

Il possède :

Equipe A

Equipe B

Etat

Score

Arbitre (plus tard)

Terrain

Horaire

---

Etat :

A programmer

Programmé

En cours

Terminé

Validé

Annulé

Archivé

---

# 12. Domaine Classement

Le classement n'est jamais stocké.

Il est toujours calculé.

Les seules données persistées sont :

les résultats.

---

# 13. Domaine Installation

Une installation représente un lieu.

Exemple :

Trinquet

Petit fronton

Salle

Chaque installation possède :

des terrains.

---

# 14. Domaine Terrain

Un terrain appartient à une installation.

Il possède :

Nom

Type

Etat

Visible

---

# 15. Domaine Calendrier

Le calendrier est unique.

Il ne connaît qu'un seul objet :

Evènement.

Tout le logiciel utilise ce calendrier.

---

# 16. Domaine Evènement

Un évènement possède :

Début

Fin

Terrain

Type

Etat

Description

---

Types :

Réservation

Match

Cours

Entraînement

Animation

Maintenance

Fermeture

Restaurant

Privatisation

---

Le moteur calendrier interdit les conflits.

---

# 17. Domaine Réservation

Une réservation référence un évènement.

Elle ajoute :

Client

Paiement

Commentaires

Présence

Elle n'occupe jamais directement un terrain.

C'est l'évènement qui occupe le terrain.

---

# 18. Domaine Résultat

Un résultat appartient à un match.

Il contient :

les sets

le score

la validation

Le classement est recalculé automatiquement.

---

# 19. Domaine Communication

Actualités

Evènements

Photos

Affiches

Documents

---

# 20. Domaine Notifications

Prévu pour V3.

SMS

Emails

Push

WhatsApp

---

# 21. Domaine Paiement

Prévu pour V3.

Stripe

HelloAsso

Paiement club

Facturation

---

# Conclusion

Le logiciel ne repose pas sur des tables.

Il repose sur un modèle métier.

Les tables SQL seront créées uniquement pour représenter ce modèle.