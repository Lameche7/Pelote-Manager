# 04 - Espace public

Version : 2.0

Ce document définit l'ensemble des fonctionnalités accessibles au public.

L'espace public constitue le portail officiel du club.

Il doit rester utile toute l'année, indépendamment de l'existence d'un tournoi.

---

# Objectif

L'espace public permet :

- de présenter le club ;
- de communiquer avec les visiteurs ;
- de gérer les inscriptions aux tournois ;
- de permettre les réservations ;
- de consulter les résultats ;
- de suivre la vie du club.

Le portail doit être simple, rapide et accessible sur ordinateur comme sur mobile.

---

# Philosophie

Le tournoi n'est pas la page d'accueil.

Le tournoi est une rubrique du portail.

Le portail représente avant tout le club.

Même en dehors des périodes de compétition, il doit rester vivant et utile.

---

# Menu principal

Le menu principal comprend les rubriques suivantes :

- Accueil
- Tournois
- Réservations
- Calendrier
- Résultats
- Club
- Actualités
- Contact

Lorsque l'utilisateur est connecté, son espace personnel apparaît également.

---

# Accueil

La page d'accueil constitue la vitrine du club.

Elle présente :

- le logo ;
- une photo ou une vidéo de présentation ;
- les actualités principales ;
- les prochains événements ;
- le tournoi en cours ou le prochain tournoi ;
- les informations pratiques.

L'objectif est que le visiteur comprenne immédiatement :

- où il se trouve ;
- ce qui se passe actuellement ;
- quelles actions il peut effectuer.

---

# Tournois

La rubrique Tournois affiche :

- les tournois en cours ;
- les prochains tournois ;
- les tournois archivés.

Chaque tournoi possède sa propre page.

Cette page présente :

- le nom ;
- l'affiche ;
- la description ;
- les dates ;
- le règlement ;
- les séries ouvertes ;
- le nombre d'équipes inscrites.

---

# Inscriptions

Lorsque les inscriptions sont ouvertes.

Le portail affiche automatiquement :

"Les inscriptions sont ouvertes"

avec un bouton :

"S'inscrire"

Le formulaire permet :

- de choisir une série ;
- de renseigner les membres exigés par le format de compétition configuré ;
- de saisir leurs coordonnées ;
- de définir leurs disponibilités.

Lorsque les inscriptions sont fermées.

Le bouton disparaît.

Le portail affiche simplement :

"Les inscriptions sont terminées."

---

# Liste des équipes

Pendant toute la durée des inscriptions.

Les visiteurs peuvent consulter :

- les équipes déjà inscrites ;
- leur série.

Aucune information personnelle sensible n'est affichée.

Les numéros de téléphone et adresses e-mail restent privés.

---

# Calendrier public

Le calendrier public permet de consulter :

- les matchs programmés ;
- les prochains matchs ;
- les événements du club ;
- les animations ;
- les fermetures exceptionnelles.

Il est consultable sans connexion.

---

# Réservation d'un terrain

Les utilisateurs connectés peuvent réserver un terrain.

Le portail affiche uniquement les créneaux réellement disponibles.

Sont automatiquement exclus :

- les créneaux occupés par un tournoi ;
- les fermetures ;
- les créneaux bloqués ;
- les réservations existantes.

Le calendrier est mis à jour automatiquement.

---

# Compte utilisateur

Après connexion.

L'utilisateur dispose d'un espace personnel.

Il peut :

- consulter ses réservations ;
- modifier ses réservations ;
- annuler une réservation ;
- consulter ses inscriptions aux tournois ;
- modifier son profil.

---

# Résultats

Les résultats sont accessibles publiquement.

Le portail affiche :

- les matchs terminés ;
- les scores ;
- les classements ;
- les prochains matchs.

Les classements sont recalculés automatiquement.

---

# Club

La rubrique Club présente :

- l'histoire du club ;
- les installations ;
- les terrains ;
- les horaires ;
- les tarifs ;
- les partenaires ;
- les informations pratiques.

---

# Actualités

Le club peut publier :

- des actualités ;
- des annonces ;
- des événements ;
- des photos.

Les actualités apparaissent automatiquement sur la page d'accueil.

---

# Contact

Le portail propose :

- l'adresse ;
- le téléphone ;
- l'adresse e-mail ;
- la localisation ;
- un formulaire de contact.

---

# Responsive

Toutes les pages doivent fonctionner :

- sur ordinateur ;
- sur tablette ;
- sur smartphone.

Aucune fonctionnalité ne doit être réservée à un seul type d'écran.

---

# Accessibilité

Le portail doit respecter les bonnes pratiques d'accessibilité.

Les formulaires doivent être simples.

Les textes doivent rester lisibles.

Les contrastes doivent être suffisants.

Les actions importantes doivent toujours être explicites.

---

# Performance

Le portail doit charger rapidement.

Les images sont optimisées.

Les données sont chargées uniquement lorsque cela est nécessaire.

Le visiteur ne doit jamais attendre inutilement.

---

# Évolutivité

Le portail devra pouvoir accueillir de nouvelles fonctionnalités sans modification majeure.

Exemples :

- paiement en ligne ;
- boutique du club ;
- galerie photos ;
- vidéos ;
- notifications ;
- application mobile.

---

# Principe fondamental

Le portail public représente le club.

Il ne doit jamais donner l'impression d'être uniquement une application de tournoi.

Le tournoi est une fonctionnalité importante.

Le club reste au centre du logiciel.

---

# Règles V2.1

## Inscriptions
Les membres exigés sont ceux du format de compétition configuré. La confirmation finale exige une authentification.

## Calendrier public
Le calendrier public est une projection des Occupations publiables. Il n'expose jamais les données privées, les commentaires internes, les identifiants techniques ou les motifs non publics.

## Réservation d'un terrain
Le portail affiche les créneaux disponibles au moment de la consultation. La disponibilité est obligatoirement revalidée au moment de la confirmation.

## Sécurité et confidentialité
- seules les données publiées sont exposées ;
- aucune donnée privée n'est envoyée inutilement au navigateur ;
- les autorisations sont contrôlées côté serveur ;
- le formulaire de contact est protégé contre les abus ;
- aucune information sensible n'est déduite du seul affichage.
