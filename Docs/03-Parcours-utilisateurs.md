# 03 - Parcours utilisateurs

Version : 2.0

Ce document décrit les parcours fonctionnels de chaque catégorie d'utilisateur.

Chaque écran du logiciel devra correspondre à l'un de ces parcours.

---

# Les profils

Le logiciel distingue quatre profils.

• Visiteur

• Utilisateur

• Licencié

• Administrateur

Chaque profil possède des droits différents.

---

# 1. Visiteur

Le visiteur n'est pas connecté.

Il peut :

- consulter les actualités
- consulter les événements
- consulter les tournois
- consulter les résultats
- consulter les classements
- consulter le planning
- consulter les équipes inscrites
- consulter les informations du club
- consulter les horaires

Il ne peut pas réserver.

Il ne peut pas s'inscrire à un tournoi.

---

# 2. Utilisateur

Un utilisateur possède un compte.

Il peut :

- réserver un terrain
- modifier ses réservations
- annuler ses réservations
- consulter son historique
- s'inscrire à un tournoi
- modifier son inscription tant que les inscriptions sont ouvertes

Il ne possède aucun droit d'administration.

---

# 3. Licencié

Le licencié est un utilisateur particulier.

Il bénéficie des règles définies par le club.

Par exemple :

- réservation jusqu'à 48h avant
- créneaux prioritaires
- tarifs particuliers
- accès à certains événements

Toutes ces règles sont paramétrables.

---

# 4. Administrateur

L'administrateur possède tous les droits.

Il peut :

- gérer les utilisateurs
- gérer les terrains
- gérer les installations
- gérer les réservations
- gérer les tournois
- publier des actualités
- créer des événements
- modifier tous les paramètres

---

# Premier démarrage

Lorsqu'aucun paramétrage n'existe encore.

Après la première connexion administrateur.

Le logiciel redirige automatiquement vers :

Configuration du club.

Aucune autre fonctionnalité n'est accessible.

Une fois la configuration validée.

Le tableau de bord devient disponible.

---

# Configuration du club

L'administrateur renseigne :

- nom du club
- logo
- adresse
- horaires d'ouverture
- horaires de fermeture
- jours de fermeture
- installations
- terrains
- règles de réservation

Cette configuration est permanente.

---

# Création d'un tournoi

L'administrateur crée une nouvelle édition.

Il définit :

- nom
- saison
- date d'ouverture des inscriptions
- date de fermeture
- début du tournoi
- fin du tournoi
- terrains utilisés
- horaires réservés au tournoi

Puis :

- les séries
- la capacité de chaque série

Une série désactivée possède `enabled = false` ; une série active possède une capacité strictement positive.

---

# Ouverture des inscriptions

Lorsque les inscriptions sont ouvertes.

Une carte apparaît automatiquement sur la page d'accueil.

Elle affiche :

- le tournoi
- les dates
- les séries
- le règlement
- le nombre d'équipes inscrites

Les visiteurs peuvent consulter les équipes déjà inscrites.

Les utilisateurs peuvent inscrire une équipe.

---

# Clôture des inscriptions

A la date prévue.

Les inscriptions deviennent impossibles.

L'administrateur peut néanmoins intervenir manuellement.

---

# Génération des poules

L'administrateur ouvre le module Poules.

Le logiciel vérifie :

- que les inscriptions sont terminées
- que chaque série possède suffisamment d'équipes

Il génère ensuite les poules série par série.

Chaque génération est indépendante.

Les diagnostics sont affichés.

L'administrateur valide les poules.

---

# Génération du planning

Une fois toutes les poules validées.

L'administrateur ouvre le module Planning.

Le logiciel vérifie que toutes les séries possèdent des poules.

Si une série manque.

La génération est refusée.

Le moteur génère ensuite le planning complet du tournoi.

Toutes les séries sont planifiées simultanément.

Le résultat est affiché sous forme de calendrier.

L'administrateur peut déplacer certains matchs avant validation.

---

# Publication

Une fois validé.

Le planning devient public.

Les matchs apparaissent automatiquement dans le calendrier.

Les réservations deviennent impossibles sur les créneaux occupés.

---

# Déroulement du tournoi

Pendant le tournoi.

L'administrateur saisit les résultats.

Les classements sont recalculés automatiquement.

Les prochains matchs sont mis à jour.

L'affichage public est actualisé.

---

# Fin du tournoi

Une fois tous les matchs terminés.

Le tournoi passe à l'état :

Terminé.

Les résultats sont archivés.

Les statistiques sont conservées.

---

# Réservation hors tournoi

En dehors des horaires réservés au tournoi.

Les terrains restent réservables.

Le moteur calendrier garantit l'absence de conflit.

---

# Affichage TV

Le mode TV affiche automatiquement :

- le planning
- les matchs en cours
- les prochains matchs
- les résultats
- les partenaires
- les informations du club

Aucune connexion n'est nécessaire.

---

# Administration

Toutes les modifications importantes sont enregistrées.

Le logiciel doit permettre de connaître :

- qui
- a modifié quoi
- et quand

Cette fonctionnalité sera implémentée progressivement.

---

# Principe général

Le logiciel guide toujours l'utilisateur.

Une action impossible doit être expliquée.

Le logiciel ne doit jamais laisser l'utilisateur dans une situation ambiguë.

Chaque étape du tournoi possède un ordre logique.

Le logiciel veille à ce que cet ordre soit respecté.

---

# Consolidation V2.1

## Ouverture des inscriptions
Un visiteur peut commencer à consulter le formulaire. La création ou la confirmation d'une inscription exige un compte authentifié.

## Cycle officiel du tournoi
Préparation → Configuration → Inscriptions ouvertes → Inscriptions fermées → Poules générées → Poules validées → Planning généré → Planning publié → En cours → Terminé → Archivé. `Annulé` est un état terminal distinct.

## Publication
La publication du planning demande la création des Occupations correspondantes dans le Calendrier. La publication échoue si une Occupation ne peut pas être créée.

## Audit
L'audit trace l'utilisateur, la date et l'heure, l'action, l'objet concerné, l'ancienne valeur, la nouvelle valeur, l'origine de l'action et la justification éventuelle.
