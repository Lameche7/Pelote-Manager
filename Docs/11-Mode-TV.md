# 11 - Mode TV

Version : 2.2

Ce document décrit le fonctionnement du Mode TV.

Le Mode TV permet de diffuser automatiquement les informations du club sur un écran situé dans le trinquet.

Il fonctionne sans intervention humaine.

Toutes les informations proviennent directement de Pelote Manager.

---

# Objectif

Le Mode TV informe les joueurs, les spectateurs et les visiteurs.

Il remplace les feuilles papier traditionnellement affichées dans le club.

Les informations sont mises à jour automatiquement.

---

# Philosophie

Le Mode TV est une vue publique.

Aucune interaction n'est nécessaire.

L'écran défile automatiquement.

Toutes les informations sont présentées de manière claire, lisible et dynamique.

---

# Accès

Le Mode TV est accessible :

- sans connexion ;
- sur une télévision ;
- sur un écran d'ordinateur ;
- sur une tablette.

Une simple adresse Internet suffit.

---

# Fonctionnement

Le Mode TV fonctionne en continu.

Il actualise automatiquement les informations.

Aucun rechargement manuel n'est nécessaire.

Lorsqu'il est supporté par le navigateur, le Mode TV demande un `screen Wake Lock` pour empêcher la mise en veille de l'écran pendant la diffusion. Si le navigateur relâche ce verrou lorsque la page passe en arrière-plan, PILOTOKI le redemande automatiquement lorsque l'écran redevient visible. Le verrou est relâché quand la page TV est quittée ou masquée.

L'absence de support de l'API Wake Lock ne bloque jamais le Mode TV.

---

# Informations diffusées

Le contenu varie selon l'activité du club.

Le logiciel peut notamment afficher :

- le logo du club ;
- la date et l'heure ;
- les partenaires ;
- les prochains événements.

---

# Pendant un tournoi

Lorsque le tournoi est en cours.

Le Mode TV affiche automatiquement :

- les matchs en cours ;
- les prochains matchs ;
- les résultats récemment validés ;
- les classements ;
- les poules.

Les informations sont mises à jour dès qu'un résultat est validé.

---

# Hors tournoi

Lorsque aucun tournoi n'est organisé.

Le Mode TV présente :

- les actualités ;
- les événements du club ;
- les animations ;
- les informations pratiques.

Le logiciel reste utile toute l'année.

---

# Rotation automatique

Le Mode TV fait défiler automatiquement plusieurs écrans.

Par exemple :

Accueil

↓

Planning

↓

Résultats

↓

Classements

↓

Partenaires

↓

Actualités

↓

Informations pratiques

La durée d'affichage de chaque écran est paramétrable.

La télécommande peut également utiliser les touches gauche et droite pour passer immédiatement à l'écran précédent ou suivant. Deux chevrons très discrets apparaissent pendant l'interaction puis disparaissent après environ trois secondes d'inactivité. Après une navigation manuelle, la temporisation automatique repart de zéro sur le nouvel écran.

---

# Mise à jour

Toutes les données proviennent directement de Pelote Manager.

Aucune saisie spécifique n'est nécessaire.

Le Mode TV utilise les informations déjà présentes dans le logiciel.

---

# Personnalisation

L'administrateur peut choisir :


- les écrans à afficher ;
- leur ordre ;
- leur durée d'affichage.

Chaque club peut adapter la diffusion à ses besoins.

---

# Partenaires

Le Mode TV permet de diffuser :

- les logos ;
- les publicités ;
- les sponsors.

Le défilement est entièrement paramétrable.

---

# Affichage des matchs

Pour chaque match.

Le logiciel affiche notamment :

- l'heure ;
- la série ;
- la poule ;
- les équipes.

Lorsqu'un score est disponible.

Il est affiché automatiquement.

---

# Classements

Le Mode TV présente les classements actualisé automatiquement après publication ou validation.

Ils sont recalculés automatiquement par le Ranking Engine.

Aucune intervention humaine n'est nécessaire.

---

# Résultats

Les derniers résultats sont mis en évidence.

Le public peut suivre l'évolution du tournoi en direct.

---

# Informations du club

Le Mode TV peut également afficher :

- les horaires ;
- les coordonnées ;
- les réseaux sociaux ;
- les prochains événements ;
- les informations de restauration.

---

# Robustesse

En cas de perte de connexion.

Le dernier écran affiché reste visible.

Le Mode TV se resynchronise automatiquement dès que la connexion revient.

---

# Évolutions prévues

Le Mode TV pourra ultérieurement intégrer :

- des vidéos ;
- des animations ;
- une météo locale ;
- un fil d'actualités ;
- un bandeau d'informations défilant.

Ces évolutions ne devront pas remettre en cause son architecture.

---

# Principe fondamental

Le Mode TV est la vitrine numérique du club.

Il diffuse automatiquement toutes les informations utiles.

L'administrateur ne saisit jamais deux fois la même information.

Toute donnée affichée provient directement de Pelote Manager.

---

Le Mode TV consomme exclusivement des projections publiques. Il n'accède jamais aux modèles métier internes ni aux données privées.
