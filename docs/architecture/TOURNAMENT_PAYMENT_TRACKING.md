# Paiements des inscriptions aux tournois — étape additive

Cette migration enregistre **pour les nouvelles équipes** un instantané du tarif et de la politique de paiement du club dans `tournament_registration_payments`.

- Aucun changement des fonctions `save_my_tournament_registration_v4` ou `v3`, ni de `tournament_teams.status`.
- Aucun changement des quotas, classements, tableaux, calendriers, notifications ou inscriptions historiques.
- Montant 0 € : statut `paid` (aucune somme à encaisser) ; sinon `unpaid`.
- La politique et l'échéance de réservation provisoire sont **informatives** pour l'instant. Elles ne déclenchent **aucune annulation automatique**, ne libèrent aucune place et ne bloquent aucune inscription.
- Aucune mutation de paiement n'est exposée aux clients. Les confirmations manuelles, webhooks, encaissements partiels et expirations seront ajoutés seulement avec un flux audité et idempotent.
- Les inscriptions historiques ne sont pas rétroactivement inscrites dans le registre; un rapprochement explicite sera nécessaire pour les afficher dans un bilan complet.
- Les permissions de consultation sont vérifiées côté serveur et filtrées par club.

## Vérifications avant activation des règles
1. Tester l'inscription d'une nouvelle équipe dans un tournoi fictif (montant 0 et montant positif).
2. Vérifier l'absence de doublons et la conservation des statuts `accepted` / `pending` historiques.
3. Tester l'isolation entre deux clubs avant le premier déploiement multi-club.
4. Implémenter la capacité réservée, les délais et le paiement en ligne sans modifier le comportement existant par défaut.
