# Domain Map

Statut : Accepté — référence officielle
Version : 2.1
Date : 2026-07-27
Remplace : les listes de domaines dispersées dans les chapitres historiques

## Domaines métier

1. **Club et ressources** — installations, ressources, horaires et configuration du club.
2. **Personnes et adhésions** — personnes, comptes associés, adhésions et licences.
3. **Calendrier** — Occupations de ressources, périodes, visibilité et conflits.
4. **Réservations** — demande, confirmation, règles client et cycle de réservation.
5. **Tournois** — éditions, séries, équipes, inscriptions, poules et cycle du tournoi.
6. **Planification sportive** — affectation des rencontres et contraintes sportives.
7. **Résultats et classements** — scores validés et classements dérivés.
8. **Communication et publication** — contenus éditoriaux et projections publiques.

## Capacités transverses

Identité et contrôle d'accès, Notifications, Audit, Fichiers, Recherche et Paiement soutiennent les domaines sans prendre de décision métier.

## Relations principales

Les Réservations et Tournois demandent au Calendrier de créer ou modifier des Occupations. La Planification sportive propose un planning ; sa publication atomique crée les Occupations. Résultats et classements publie des projections après validation. Communication et publication n'accède qu'aux données déclarées publiables.

L'administration n'est pas un domaine : elle compose des cas d'usage des domaines, sous contrôle d'accès.
