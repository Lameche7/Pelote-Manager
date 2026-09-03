begin;

-- Version conservée pour rester alignée avec l'historique de migration du
-- projet de test. Le premier prototype de PR130 utilisait ce numéro de version
-- pour un rattachement manuel côté administration. Ce parcours a été abandonné.
--
-- La fonctionnalité retenue est implémentée dans la migration suivante :
-- rattachement volontaire d'une identité externe au moment de la création du
-- compte utilisateur, sans intervention administrateur.

commit;
