# Event Engine

Le moteur d'évènements est la source générique des occupations planifiées du club. Un évènement possède un type administrable, une période, une visibilité, un état de publication et une relation normalisée vers un ou plusieurs terrains. Sélectionner « tous les terrains » signifie créer une relation vers chaque terrain actif : aucune donnée métier n'est dupliquée dans `events`.

## Intégration au calendrier

Un évènement publié et bloquant projette automatiquement une occupation `club_event` par terrain dans `calendar_occupations`. Le moteur de disponibilité existant n'a donc aucune connaissance des tournois ou des autres types : il détecte simplement une occupation en conflit. Un brouillon, un évènement informatif ou archivé ne bloque pas les réservations.

`event_resources.calendar_occupation_id` relie chaque projection à sa source et permet une synchronisation atomique lors d'une modification, d'un archivage ou d'une suppression.

## Extensions prévues

`event_documents` réserve le modèle documentaire sans implémenter le stockage. Les champs de capacité et d'inscription préparent la participation. Les notifications, la communication, l'affichage TV, les statistiques et les enrichissements propres aux tournois devront référencer `events.id` plutôt que créer un calendrier parallèle.

Toutes les opérations d'administration sont isolées par `club_id` et protégées par `events.manage`.
