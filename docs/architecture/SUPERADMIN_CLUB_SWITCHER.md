# Super-administrateur : sélection sécurisée du club actif

## Objectif
Un compte super-admin Pilotoki doit accéder aux espaces de tous les clubs sans utiliser leurs identifiants. Les administrateurs ordinaires restent cantonnés à leur club. Le compte d'Antoine (Morlaàs) conserve son accès joueur aux tournois de Lourdes.

## Architecture de sécurité (obligatoire avant activation)
- L'identité de super-admin est vérifiée côté serveur dans le registre de plateforme, jamais à partir d'une adresse e-mail, d'un paramètre d'URL ou du localStorage.
- Le sélecteur de club n'est affiché qu'après validation de ce rôle; il liste les clubs autorisés.
- Un club actif est une sélection de contexte, **pas** une permission. Toutes les RPC admin concernées reçoivent un club cible et vérifient côté serveur que l'utilisateur est soit administrateur du club cible, soit super-admin de la plateforme.
- Ne pas remplacer aveuglément admin_current_club_id() par un club fourni par le navigateur. Migrer les opérations une par une, avec vérifications RLS et tests négatifs.
- Les utilisateurs ordinaires ne peuvent ni lister les autres clubs administrativement ni appeler une opération admin sur un club tiers.
- Ne jamais permettre qu'un changement de club modifie l'affiliation sportive d'un joueur.
- Afficher constamment le nom du club actif et demander confirmation pour les opérations destructrices.
- Préserver les parcours Lourdes et les réservations existantes.

## Étapes
1. Authentification super-admin inter-projets (registre plateforme / base métier), session et RPC de clubs accessibles.
2. Contexte club actif dans le bandeau supérieur, console globale et changement sans déconnexion.
3. Adapter les lectures admin, puis les écritures et les RPC, avec tests d'isolement et journal d'audit (acteur, club cible, action).
4. Tester Lourdes, Morlaàs et compte Antoine; tester les refus d'accès croisés.
5. Activer en production après tests, avant la mise en service des tournois de Morlaàs.

## État
Document de cadrage uniquement. Aucun sélecteur actif ni permission de production modifiée par ce changement.
