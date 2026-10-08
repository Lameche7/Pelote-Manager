# Échanges universels de créneaux — spécification technique

## Périmètre
L'administrateur échange deux occupations existantes entre elles, parmi championnat, tournoi, réservation classique et créneau permanent. Aucun accord préalable des joueurs. Confirmation explicite, notifications aux intéressés, journal d'audit et possibilité d'annulation seulement si elle reste sûre.

## Sources de vérité vérifiées
- `public.calendar_occupations` : projection des occupations.
- `public.championship_matches`, `public.championship_match_manual_schedules` : programmation des championnats.
- `public.tournament_match_planning` : programmation des tournois.
- `public.reservations` : réservations classiques.
- Tables de créneaux permanents : identifier le modèle de récurrence avant implémentation.

## Invariants indispensables
1. Opération atomique en base (une transaction, verrous sur les deux occupations et leurs objets métier).
2. Interdire l'échange avec soi-même, une occupation annulée, expirée ou non modifiable.
3. Vérifier les deux ressources, plages horaires, durées et chevauchements avec toutes les autres occupations; exclure uniquement les deux occupations échangées du contrôle.
4. Préserver les identifiants des parties, équipes, résultats, propriétaires, et références métier.
5. Les restrictions ordinaires de réservabilité peuvent être outrepassées par un administrateur autorisé; jamais les collisions, la sécurité RLS ou les contraintes physiques.
6. Si les durées diffèrent, ne jamais écraser un troisième créneau : bloquer l'échange et afficher une explication, avant d'ajouter éventuellement un mode d'ajustement explicite.
7. Mettre à jour dans la même transaction les objets métier ET la projection calendrier, avec audit avant/après; émettre les notifications après commit via une file persistante.
8. Exposer un aperçu en lecture seule puis une commande de confirmation avec contrôle de version pour prévenir les changements entre aperçu et validation.
9. Distinguer occurrence unique et série permanente : ne modifier une occurrence qu'après identification explicite de la règle métier.
10. Tester les six combinaisons de types (et les créneaux permanents), les échanges de ressources, les collisions, les droits et les transactions concurrentes.

## UX prévue
Administration → Réservations → Échanger des créneaux : deux sélecteurs d'occupations du calendrier, cartes avant/après, vérification, confirmation, résultat, historique. Ne jamais activer la confirmation tant que la vérification transactionnelle n'existe pas.

## Étapes
1. Cartographier les clés étrangères, triggers, fonctions RPC et synchronisations pour chaque source métier.
2. Implémenter RPC de simulation et RPC atomique avec permissions admin.
3. Ajouter interface et tests de non-régression.
4. Déployer sur preview, tester sans altérer les données réelles, soumettre à validation, puis merger sur demande explicite.

## Attention
Une simple permutation des lignes de `calendar_occupations` est incorrecte : elle désynchroniserait les championnats et tournois. Ne pas lancer de migration de mutation en production avant validation des invariants.
