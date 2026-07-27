# 07 - Génération des poules

Version : 2.1

Statut : Référence métier

## Entrées du Pool Engine

Le moteur reçoit les équipes, séries, paramètres de poules, contraintes obligatoires et préférences configurées.

## Contraintes obligatoires et préférences

Les contraintes obligatoires invalident une proposition lorsqu'elles ne sont pas respectées. Les préférences orientent l'optimisation sans rendre une proposition impossible.

## Propositions et qualité

Le moteur génère plusieurs solutions. Chaque proposition comporte un score de qualité et des diagnostics expliquant ses compromis et ses violations éventuelles.

## Validation

La validation est une décision explicite. Une répartition validée devient immuable. Toute régénération produit une nouvelle proposition et exige une nouvelle validation ; elle ne modifie jamais silencieusement la version validée.

## Frontières

Le Pool Engine :

- ne planifie aucun match ;
- ne crée aucune Occupation ;
- ne lit pas Supabase ;
- ne modifie aucune équipe ;
- retourne des propositions sans les enregistrer.
