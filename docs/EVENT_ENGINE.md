# Event Engine

Le moteur d'évènements est la source générique des occupations planifiées du club. Un évènement possède un type administrable, une période, une visibilité, un état de publication et une relation normalisée vers un ou plusieurs terrains. Sélectionner « tous les terrains » signifie créer une relation vers chaque terrain actif : aucune donnée métier n'est dupliquée dans `events`.

## Intégration au calendrier

Un évènement publié et bloquant projette automatiquement une occupation `club_event` par terrain dans `calendar_occupations`. Le moteur de disponibilité existant n'a donc aucune connaissance des tournois ou des autres types : il détecte simplement une occupation en conflit. Un brouillon, un évènement informatif ou archivé ne bloque pas les réservations.

Seul un évènement public projette son nom. Les visibilités `members` et `private` projettent toujours le libellé neutre « Indisponible », car le calendrier d'occupation est lisible publiquement. Les anciennes commandes de blocages manuels acceptent exclusivement les occupations `closure` et ne peuvent donc ni modifier ni annuler une projection `club_event`.

`event_resources.calendar_occupation_id` relie chaque projection à sa source et permet une synchronisation atomique lors d'une modification, d'un archivage ou d'une suppression.

Avant toute projection bloquante, la commande verrouille les lignes des terrains sélectionnés dans un ordre déterministe puis recherche explicitement les occupations qui chevauchent la période. La contrainte d'exclusion de `calendar_occupations` demeure la dernière protection contre une réservation concurrente.

## Extensions prévues

`event_documents` réserve le modèle documentaire sans implémenter le stockage. Les champs de capacité et d'inscription préparent la participation. Les notifications, la communication, l'affichage TV, les statistiques et les enrichissements propres aux tournois devront référencer `events.id` plutôt que créer un calendrier parallèle.

Toutes les opérations d'administration sont isolées par `club_id` et protégées par `events.manage`.

Les horaires sont stockés en `timestamptz`. Le formulaire convertit explicitement entre cette valeur et l'heure murale `Europe/Paris` attendue par `datetime-local`, y compris lors des changements d'heure. Un responsable optionnel est un profil lié à un membre actif du club de l'évènement ; cette règle est contrôlée par la RPC, pas seulement par le sélecteur de l'interface.

Chaque création, modification, archivage et suppression produit une entrée immuable dans `event_audit_log`. L'audit de suppression conserve l'instantané antérieur sans clé étrangère vers l'évènement supprimé. La duplication est préparée dans le formulaire et ne crée rien avant une validation explicite ; la RPC force ensuite la copie en brouillon non bloquant.
