0. Vision du projet
0.1 Objectif

Pelote Manager n'est pas un simple gestionnaire de tournoi.

C'est le logiciel de gestion du Trinquet du PCL Lourdais.

Il doit permettre :

gérer la vie quotidienne du club
gérer les réservations
organiser les tournois
gérer les résultats
afficher les classements
communiquer avec les adhérents
devenir à terme le logiciel unique du club.

Le logiciel doit pouvoir fonctionner pendant plusieurs années sans remise en question de son architecture.

0.2 Philosophie

La V1 était centrée sur :

le tournoi.

La V2 sera centrée sur :

le club.

Le tournoi devient simplement une activité du club.

Le calendrier est partagé entre :

les réservations
les entraînements
les compétitions
les animations
les tournois.
0.3 Les principes

Le logiciel doit être :

✔ simple

✔ rapide

✔ fiable

✔ maintenable

✔ évolutif

✔ entièrement piloté par les données

Aucune valeur ne devra être codée en dur.

0.4 Les utilisateurs

Le logiciel distingue plusieurs profils.

Visiteur

Aucune connexion.

Peut :

consulter le site
consulter les actualités
consulter les résultats
consulter les tournois
consulter les disponibilités
demander une réservation
s'inscrire au tournoi
Utilisateur

Compte simple.

Peut :

réserver un terrain
consulter ses réservations
modifier ses informations
Licencié

Compte validé.

Peut :

réserver avec des règles privilégiées
bénéficier de tarifs spécifiques (plus tard)
accéder à certaines fonctionnalités réservées
Administrateur

Gestion complète du logiciel.

0.5 Les modules

Le logiciel est composé de neuf grands modules.

1 Club

Présentation

Actualités

Restaurant

Evènements

Photos

2 Réservations

Calendrier

Créneaux

Disponibilités

Blocages

Historique

3 Tournois

Création

Gestion

Archivage

4 Equipes

Inscriptions

Disponibilités

Validation

5 Poules

Création

Optimisation

Validation

6 Planning

Génération automatique

Optimisation globale

Vue calendrier

Vue terrain

7 Résultats

Saisie

Classements

Statistiques

8 Administration

Paramètres

Utilisateurs

Configuration

9 Mode TV

Affichage public

0.6 Les grands principes métier

Le calendrier est unique.

Toutes les activités utilisent ce calendrier.

Une réservation est un évènement.

Un match est un évènement.

Une fermeture est un évènement.

Un entraînement est un évènement.

Le moteur décide uniquement si deux évènements peuvent coexister.

0.7 Le fonctionnement annuel

Le club fonctionne toute l'année.

Pendant l'année :

les réservations sont ouvertes.

Lorsqu'un tournoi est créé :

certaines plages deviennent réservées au tournoi.

Les autres restent réservables.

Exemple :

Club ouvert :

09h00 → 23h00

Tournoi :

17h30 → 22h30

Le logiciel interdit uniquement les réservations sur :

17h30 → 22h30

Le reste continue normalement.

0.8 Les objectifs de qualité

Le logiciel devra fonctionner avec :

plusieurs centaines d'équipes

plusieurs milliers de réservations

plusieurs années d'historique

sans modification de l'architecture.

0.9 Les objectifs techniques

Le code devra respecter les règles suivantes :

TypeScript strict
Aucun any
Aucun code dupliqué
Composants React < 300 lignes
Fonctions < 50 lignes
Logique métier hors des composants
Services testables indépendamment
Migrations versionnées
Documentation continue
📘 Fin du chapitre 0 — Vision du projet