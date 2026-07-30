# Architecture du Back Office

## Périmètre multi-club

Cette PR **prépare mais n’implémente pas le multi-club**. Les agrégats introduits portent un `club_id`, les rôles et permissions sont définis par club, et les politiques RLS vérifient l’appartenance au club concerné.

Dans l’interface actuelle, un compte doit être rattaché explicitement à exactement un club. Aucun club par défaut n’est déduit. Si le compte n’a aucune appartenance, l’accès est refusé ; s’il en possède plusieurs, l’interface demande implicitement la future étape de sélection et refuse de choisir arbitrairement.

Restent volontairement hors périmètre :

- le provisionnement autonome de nouveaux clubs ;
- le sélecteur de club actif ;
- la personnalisation de domaine et de marque par tenant ;
- la facturation SaaS et l’administration inter-clubs ;
- la migration complète des tables historiques de réservation vers un paramétrage par club.

## Modèle d’autorisation

L’autorisation repose sur une appartenance `club_memberships`, un rôle propre au club et des permissions normalisées. Le client utilise ces permissions pour masquer les entrées de navigation et protéger les routes, mais la sécurité ne dépend jamais du client : les écritures Club sont également contrôlées par RLS ou par une fonction SQL vérifiant `has_club_permission`.

Les permissions financières sont séparées : `payments.read`, `payments.manage` et `pricing.manage`. Le modèle Trésorier reçoit ces permissions sans recevoir la gestion des réservations ou du club.

## Évolution attendue

La prochaine étape multi-club consistera à ajouter un sélecteur explicite et à transporter le club actif dans le contexte de session. La fonction actuelle refuse déjà les comptes multi-clubs, de sorte que cette évolution remplacera une erreur contrôlée plutôt qu’un fallback implicite.
