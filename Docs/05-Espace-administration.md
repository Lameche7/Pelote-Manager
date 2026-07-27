# 05 - Espace administration


Version : 2.0

Ce document définit l'ensemble des fonctionnalités accessibles aux administrateurs.

L'administration constitue le centre de pilotage du club.

Toutes les fonctionnalités sensibles du logiciel sont regroupées dans cet espace.

---

# Objectif

L'espace d'administration permet :

- d'administrer le club ;
- d'organiser les tournois ;
- de gérer les réservations ;
- de publier les informations publiques ;
- de suivre les compétitions ;
- de consulter les statistiques.

L'interface doit guider l'administrateur.

Elle ne doit jamais le laisser dans une situation ambiguë.

---

# Philosophie

L'administration est organisée autour des workflows.

Le logiciel accompagne l'utilisateur.

Il ne se contente pas d'afficher des formulaires.

Chaque écran indique :

- ce qui est déjà fait ;
- ce qu'il reste à faire ;
- les éventuels problèmes.

---

# Menu principal

Le menu principal comprend :

- Tableau de bord
- Club
- Tournois
- Réservations
- Calendrier
- Résultats
- Communication
- Utilisateurs
- Paramètres

---

# Tableau de bord

Le tableau de bord constitue la page d'accueil de l'administration.

Il présente immédiatement :

- le tournoi actif ;
- les réservations du jour ;
- les matchs du jour ;
- les prochains événements ;
- les alertes importantes.

---

Le tableau de bord doit répondre immédiatement à trois questions :

Que se passe-t-il aujourd'hui ?

Que dois-je faire ?

Y a-t-il un problème ?

---

# Club

Le module Club permet de gérer :

- les informations générales ;
- les installations ;
- les terrains ;
- les horaires d'ouverture ;
- les jours de fermeture ;
- les partenaires ;
- les informations de contact.

Ces paramètres changent rarement.

---

# Tournois

Chaque tournoi possède sa propre fiche.

Depuis cette fiche.

L'administrateur peut :

- modifier les paramètres ;
- ouvrir les inscriptions ;
- fermer les inscriptions ;
- gérer les séries ;
- consulter les équipes ;
- générer les poules ;
- générer le planning ;
- suivre les résultats.

---

# Paramètres du tournoi

Chaque édition possède ses propres paramètres.

L'administrateur définit notamment :

- nom ;
- description ;
- dates ;
- règlement ;
- terrains utilisés ;
- horaires réservés au tournoi.

---

Les séries sont entièrement paramétrables.

Pour chacune.

L'administrateur définit :

- le nom ;
- l'ordre ;
- la capacité maximale.

Une série désactivée possède `enabled = false` ; une série active possède une capacité strictement positive.

Elle n'apparaît plus dans les inscriptions.

---

# Equipes

L'administrateur consulte :

- les équipes inscrites ;
- leur série ;
- leurs disponibilités ;
- la date d'inscription.

Il peut :

- modifier une inscription ;
- changer de série ;
- supprimer une équipe ;
- ajouter manuellement une équipe.

---

# Génération des poules

Le logiciel vérifie automatiquement :

- que les inscriptions sont terminées ;
- que la série contient suffisamment d'équipes.

Puis.

Il génère les poules.

Pour chaque série.

L'écran affiche :

- les poules proposées ;
- les équipes ;
- les diagnostics.

L'administrateur peut :

- regénérer ;
- modifier ;
- valider.

Une fois validées.

Les poules deviennent définitives.

---

# Génération du planning

Le planning est généré pour l'ensemble du tournoi.

Le logiciel vérifie automatiquement.

Que toutes les séries possèdent des poules.

Si une seule série est incomplète.

La génération est refusée.

Le logiciel indique précisément pourquoi.

---

Une fois la génération effectuée.

Le calendrier affiche :

- tous les matchs ;
- tous les terrains ;
- toutes les journées.

---

L'administrateur peut :

- déplacer un match ;
- changer de terrain ;
- modifier un horaire.

Toutes les modifications sont contrôlées.

Le logiciel interdit les conflits.

---

# Calendrier

Le calendrier constitue le cœur de l'administration.

Il affiche :

- les réservations ;
- les matchs ;
- les fermetures ;
- les événements.

Toutes les occupations utilisent la même représentation.

---

Le calendrier permet :

- créer ;
- déplacer ;
- modifier ;
- supprimer.

Les conflits sont détectés immédiatement.

---

# Réservations

Le module Réservations affiche :

- les réservations à venir ;
- les réservations terminées ;
- les annulations.

L'administrateur peut :

- créer une réservation ;
- modifier une réservation ;
- annuler une réservation.

---

Les règles de réservation sont automatiquement appliquées.

Exemples :

- délai minimum ;
- horaires autorisés ;
- fermeture exceptionnelle ;
- priorité licenciés.

---

# Résultats

Pendant le tournoi.

L'administrateur saisit les résultats.

Le logiciel :

- met à jour les classements ;
- met à jour le calendrier ;
- publie immédiatement les résultats.

Les classements sont recalculés automatiquement.

Ils ne sont jamais modifiés manuellement.

---

# Communication

Le club peut publier :

- actualités ;
- événements ;
- partenaires ;
- photos.

Le contenu est immédiatement visible sur le portail public.

---

# Utilisateurs

Le module Utilisateurs permet de gérer :

- les comptes ;
- les licenciés ;
- les administrateurs ;
- les rôles.

Chaque action est tracée.

---

# Paramètres

Le module Paramètres concerne uniquement :

- la configuration globale ;
- les règles de réservation ;
- les paramètres techniques.

Les paramètres d'un tournoi ne sont jamais mélangés avec ceux du club.

---

# Premier lancement

Lors de la première connexion.

Si le club n'est pas configuré.

Le logiciel redirige automatiquement vers les paramètres du club.

Aucune autre fonctionnalité n'est accessible.

---

Une fois cette étape terminée.

Le tableau de bord devient disponible.

---

# Assistant de progression

Le logiciel guide l'administrateur.

Il indique en permanence :

✓ Club configuré

✓ Tournoi créé

✓ Séries configurées

✓ Inscriptions ouvertes

✓ Inscriptions fermées

✓ Poules générées

✓ Planning publié

✓ Tournoi en cours

✓ Tournoi terminé

L'administrateur connaît toujours l'étape suivante.

---

# Sécurité

Toutes les actions importantes sont enregistrées.

Le logiciel conserve :

- la date ;
- l'utilisateur ;
- l'action réalisée.

Ces informations ne sont jamais supprimées.

---

# Principe fondamental

L'administration ne doit jamais être une simple succession de formulaires.

Elle doit accompagner l'organisateur pendant toute la vie du tournoi.

Le logiciel doit devenir un véritable assistant d'organisation.

Il guide, vérifie, alerte et sécurise chaque étape.

L'administrateur garde toujours la décision finale.

---

# Précisions V2.1

Le tableau de bord présente les prochaines activités et Occupations publiables.

Le moteur de planification contrôle les contraintes sportives. Le domaine Calendrier contrôle uniquement les conflits d'occupation des ressources.

## Calendrier
Le calendrier d'administration affiche les Occupations provenant des réservations, matchs publiés, entraînements, fermetures, maintenances, animations et usages privés. Il permet de créer une Occupation administrative, la déplacer, modifier sa période ou sa ressource, l'annuler et consulter son origine et son historique. Une Occupation issue d'un autre domaine ne peut être modifiée que par un cas d'usage respectant les règles de son domaine d'origine.

Un résultat validé devient publiable selon la politique de publication. Un contenu de communication est visible dès sa publication.

L'audit trace l'utilisateur, la date et l'heure, l'action, l'objet, les anciennes et nouvelles valeurs, l'origine et la justification éventuelle.
