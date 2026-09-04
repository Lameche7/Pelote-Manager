# Championnat — cœur métier

## Objectif

Le module Championnat représente une compétition officielle dans son ensemble : tous les clubs, toutes les équipes, tous les joueurs, toutes les rencontres et les classements disponibles dans les sources officielles.

Le premier club qui importe une compétition n'en devient pas propriétaire. La compétition reste une donnée globale de Pelote Manager afin qu'un autre club abonné puisse ensuite rejoindre la même compétition sans dupliquer les équipes, les joueurs ou les résultats.

## Principes structurants

### Compétition globale, service par club

`championships` décrit la compétition officielle. `championship_club_links` rattache ensuite les clubs abonnés qui peuvent utiliser Pelote Manager autour de cette compétition.

Un lien `manager` donne au club le droit d'administrer la compétition lorsqu'il possède aussi la permission `championships.manage`. Un lien `participant` prépare le futur accès d'un autre club abonné sans lui donner automatiquement des droits d'administration.

Le modèle commercial précis (abonnement club, éventuelle offre individuelle joueur) reste hors du cœur métier. Il pourra évoluer sans modifier les données sportives.

### Club officiel et club Pelote Manager sont deux notions distinctes

`championship_federation_clubs` représente les clubs présents dans la source officielle. Un club officiel peut exister dans une compétition sans être abonné à Pelote Manager.

`linked_club_id` permet, lorsqu'un club rejoint Pelote Manager, de rattacher son identité officielle à `public.clubs` sans modifier les championnats déjà importés.

### Identité sportive globale du joueur

`championship_players` représente l'identité officielle du joueur et est unique par source + numéro de licence.

Cette identité peut être reliée ultérieurement à un `profile`. Le compte reste global et n'appartient ni au club qui a importé le championnat ni à une compétition particulière. Le même joueur peut donc conserver son historique entre saisons et compétitions.

### Les équipes sont propres à une division

Le numéro d'équipe d'un club n'est pas global. Les fichiers réels montrent qu'un même club peut avoir une équipe `01` dans plusieurs séries.

Une équipe est donc identifiée dans une division par :

`division + club officiel + numéro d'équipe`.

Les poules, équipes et rencontres sont également contraintes à rester dans la même division afin d'éviter les croisements accidentels entre séries.

## Imports officiels

Le cœur prévoit des lots d'import et plusieurs sources complémentaires :

- `matches` : rencontres, programmation, reports et résultats ;
- `engagements` : équipes, joueurs et licences ;
- `standings` : classement officiel ;
- `rules` : référence ou métadonnées du règlement applicable.

L'administrateur ne doit pas préparer ou nettoyer manuellement les exports officiels. L'assistant d'import devra accepter les fichiers tels qu'ils sont fournis, afficher une prévisualisation, rapprocher automatiquement les données puis demander une validation avant écriture définitive.

Le classement officiel est stocké comme donnée source dans un premier temps. Le recalcul Pelote Manager pourra être ajouté ensuite lorsque les règles sportives auront été formalisées et testées.

## Provenance et mises à jour

Les compétitions, fichiers, rencontres et classements conservent des identifiants ou métadonnées de source. Cette provenance doit permettre à une future synchronisation de comparer une nouvelle extraction officielle à l'état existant et d'afficher les changements avant application.

L'import initial par fichiers reste la voie robuste. Une synchronisation depuis une URL publique pourra être ajoutée si le fonctionnement de la source officielle est suffisamment stable.

## Évolutions prévues, hors cœur actuel

Le schéma est conçu pour accueillir ensuite :

- espace joueur : poule, calendrier, adversaires, résultats, classement et notifications ;
- rattachement assisté d'un compte à l'identité officielle par numéro de licence ;
- proposition de résultat par un joueur puis validation par un administrateur ;
- confirmation d'un résultat par les deux équipes ;
- organisation d'une rencontre entre clubs abonnés : proposition de date, accord, programmation et notifications ;
- statistiques joueur agrégeant championnats et tournois.

Ces fonctions seront ajoutées par étapes afin de ne pas rendre le cœur du championnat dépendant de l'adoption de Pelote Manager par tous les clubs.
