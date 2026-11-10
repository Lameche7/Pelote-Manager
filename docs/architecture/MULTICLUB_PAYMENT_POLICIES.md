# Pilotoki — politiques de paiement multi-club

## Décision produit
Chaque club choisit indépendamment les moyens de règlement et la condition de validation des **licences** et des **inscriptions aux tournois**. Aucun club n'est obligé de posséder un compte HelloAsso. Les encaissements ne transitent jamais par le compte du PCL ou de Pilotoki.

## Configuration par club
- Fournisseurs disponibles : HelloAsso **du club concerné**, paiements manuels (espèces, chèque, virement), et autres prestataires ultérieurs.
- Licence : paiement immédiat obligatoire / validation avec règlement différé.
- Tournoi : paiement obligatoire pour confirmer / inscription en attente de règlement.
- Tournoi : réservation de place pendant l'attente (oui/non), délai d'expiration paramétrable si oui.
- Suivi : à régler, partiellement réglé, réglé, annulé, remboursé.
- Une inscription peut être **enregistrée** sans être **confirmée**. Le statut d'inscription ne doit pas être confondu avec le statut du paiement.

## Sécurité et isolation
- Toutes les règles et connexions de paiement sont rattachées à un club_id, jamais à un réglage global implicite.
- L'administration et les RPC doivent vérifier le club actif et les droits de l'utilisateur côté serveur (RLS ou SECURITY DEFINER contrôlé).
- Les identifiants fournisseurs restent côté serveur; ne jamais exposer les secrets dans le navigateur.
- Les webhooks doivent être authentifiés, idempotents, et associés à la bonne organisation / club.
- Les montants, bénéficiaires et politiques applicables sont figés lors de la création d'une commande; un changement de réglage ne modifie pas rétroactivement les commandes existantes.
- Ne pas autoriser la confirmation d'un paiement manuel par un utilisateur non habilité.

## Déploiement progressif, sans régression à Lourdes
1. Inventorier les flux existants : licence, inscription tournoi, réservation, paiements fractionnés, webhooks, retour checkout, RPC.
2. Introduire la configuration persistante et les RPC sécurisées, avec migration **sans changement du comportement des clubs existants**. Ne pas basculer les flux existants avant la migration.
3. Ajouter Administration → Paramètres → Paiements, avec deux sections Licences / Tournois, méthodes de paiement, délai et confirmation. Validation serveur de la cohérence (paiement obligatoire implique au moins un moyen opérationnel).
4. Adapter les inscriptions tournoi : états distincts et règles d'expiration de places, y compris concurrence et capacité.
5. Adapter les licences et le suivi des règlements manuels/partiels.
6. Raccorder HelloAsso par organisation (OAuth partenaire) et tester sur un second club avant activation générale.

## Critères d'acceptation
- Club sans HelloAsso : inscription et licence possibles selon sa politique, sans appel HelloAsso.
- Club avec HelloAsso : checkout vers **son propre** organisme.
- Inscription sans paiement : statut en attente; place réservée seulement si la règle du club le prévoit.
- Paiement validé : confirmation idempotente; pas de double réservation ni de double encaissement.
- Les paramètres d'un club ne sont ni visibles ni modifiables par un administrateur d'un autre club.
- Lourdes : aucun changement de comportement ou de prestataire lors de la migration initiale.
