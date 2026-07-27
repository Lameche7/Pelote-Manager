# 08 - Moteur de planification

Version : 2.0

Ce document décrit le fonctionnement du moteur de planification.

Il constitue la référence officielle de l'algorithme de génération du planning.

Le moteur est totalement indépendant de l'interface utilisateur et de la base de données.

---

# Objectif

Le moteur construit automatiquement le planning complet d'un tournoi.

Son objectif est de produire le meilleur planning possible en tenant compte :

- des poules validées ;
- des disponibilités des équipes ;
- des horaires du tournoi ;
- des contraintes d'organisation.

Le moteur cherche toujours la meilleure solution.

Lorsque plusieurs solutions existent.

Il les compare.

Puis propose la plus pertinente.

---

# Philosophie

Le moteur ne cherche pas uniquement à placer des matchs.

Il cherche à construire le tournoi le plus agréable possible.

Chaque décision doit être justifiée.

Chaque résultat doit être explicable.

Le moteur agit comme un assistant d'organisation.

La décision finale appartient toujours à l'administrateur.

---

# Données d'entrée

Le moteur reçoit uniquement des données métier.

Il ne réalise jamais de requête SQL.

Il ne connaît pas React.

Il ne connaît pas Supabase.

Entrées :

- les poules validées ;
- les équipes ;
- les disponibilités ;
- les paramètres du tournoi ;
- les créneaux réservés au tournoi.

---

# Données de sortie

Le moteur retourne :

- un planning complet ;
- les matchs planifiés ;
- les diagnostics ;
- un indice global de qualité.

Aucune donnée n'est enregistrée automatiquement.

---

# Analyse préalable

Avant toute planification.

Le moteur réalise une phase d'analyse.

Il vérifie notamment :

- le nombre de matchs à programmer ;
- le nombre de créneaux disponibles ;
- les disponibilités des équipes ;
- les éventuelles contraintes.

Aucune planification n'est réalisée durant cette étape.

---

# Construction des contraintes

Le moteur construit ensuite toutes les contraintes du tournoi.

Exemples :

- une équipe ne peut jouer deux matchs simultanément ;
- une équipe doit disposer d'un temps de repos suffisant ;
- un créneau ne peut accueillir qu'un seul match ;
- les disponibilités doivent être respectées autant que possible.

---

# Recherche de solution

Le moteur explore différentes possibilités.

Il ne conserve jamais la première solution trouvée.

Chaque solution est évaluée.

La meilleure est retenue.

---

# Critères de qualité

Le moteur cherche notamment à optimiser :

- le respect des disponibilités ;
- l'équilibre des journées ;
- le temps de repos entre deux matchs ;
- la répartition des matchs dans la durée du tournoi ;
- la simplicité d'organisation.

Il cherche également à limiter :

- les conflits ;
- les temps d'attente excessifs ;
- les journées surchargées ;
- les situations difficiles à gérer.

---

# Évaluation
Chaque planning reçoit une note comprise entre 0 et 100.

Cette note représente la qualité globale de la planification.

Elle permet de comparer plusieurs propositions.

---

# Analyse détaillée

Le logiciel présente également plusieurs indicateurs.

Par exemple :

Respect des disponibilités

98 %

Temps de repos

95 %

Répartition des journées

97 %

Qualité générale

96 %

Ces informations permettent à l'organisateur de comprendre la qualité du planning proposé.

---

# Recommandations

Le moteur explique toujours les points faibles éventuels.

Exemples :

"Deux équipes possèdent très peu de disponibilités communes."

"Le mercredi est fortement sollicité."

"Le tournoi manque de deux créneaux pour atteindre une planification parfaite."

"L'ajout d'un créneau le jeudi améliorerait significativement la qualité."

Le logiciel ne se contente jamais d'afficher un résultat.

Il explique pourquoi.

---

# Plusieurs propositions

Lorsque plusieurs planifications présentent une qualité proche.

Le moteur peut proposer plusieurs solutions.

Exemple :

Solution 1

Qualité : 98 %

---

Solution 2

Qualité : 96 %

---

Solution 3

Qualité : 94 %

L'administrateur choisit celle qu'il souhaite conserver.

---

# Amélioration

Une fois le planning généré.

Le logiciel peut rechercher une meilleure organisation.

Cette recherche n'écrase jamais le planning actuel.

Elle produit une nouvelle proposition.

Exemple :

Planning actuel

95 %

↓

Nouvelle proposition

98 %

L'administrateur compare les deux.

Puis décide laquelle conserver.

---

# Modifications manuelles

Après génération.

L'administrateur peut :

- déplacer un match ;
- modifier un horaire.

Chaque modification entraîne immédiatement une nouvelle vérification.

Le logiciel refuse toute situation incohérente.

---

# Validation

Une fois validé.

Le planning devient officiel.

Les matchs sont publiés.

Le calendrier public est automatiquement mis à jour.

---

# Contrôles

Le moteur vérifie notamment :

✓ Tous les matchs sont programmés.

✓ Aucun match n'est planifié plusieurs fois.

✓ Aucun créneau n'accueille plusieurs matchs.

✓ Les disponibilités ont été prises en compte.

✓ Les contraintes du tournoi sont respectées.

---

# Performances

Le moteur doit rester suffisamment rapide pour permettre plusieurs essais successifs.

L'administrateur doit pouvoir comparer différentes propositions sans attente excessive.

---

# Journalisation

Pour chaque génération.

Le moteur conserve :

- la date ;
- le temps de calcul ;
- la note obtenue ;
- les principaux diagnostics.

Ces informations facilitent le suivi et l'amélioration du moteur.

---

# Évolutions prévues

Le moteur pourra ultérieurement intégrer :

- des priorités particulières ;
- des contraintes personnalisées ;
- des préférences d'organisation.

Ces évolutions ne devront pas remettre en cause son architecture.

---

# Principe fondamental

Le moteur de planification ne cherche pas uniquement à construire un calendrier.

Il cherche à produire la meilleure organisation possible du tournoi.

Chaque proposition est expliquée.

Chaque décision est justifiée.

Le logiciel assiste l'organisateur.

Il ne décide jamais à sa place.

---

# Consolidation V2.1

## Données d'entrée complémentaires
Ressources utilisables, Occupations existantes sur les périodes concernées, durée des matchs, temps de repos minimal, contraintes obligatoires et préférences pondérées.

## Responsabilités
Le Planning Engine affecte les rencontres aux créneaux, respecte les contraintes sportives et optimise la qualité. Le domaine Calendrier valide la coexistence physique des Occupations ; il ne connaît pas les disponibilités sportives, ne calcule pas les repos et ne choisit pas l'ordre des matchs.

## Validation et publication
La validation métier du planning précède sa publication. La publication crée les Occupations du tournoi. Si une Occupation est refusée, la publication complète échoue sans publication partielle.

Policies : CanScheduleMatchPolicy, HasSufficientRestPolicy, IsTeamAvailablePolicy, IsCourtAllowedPolicy et CanPublishPlanningPolicy.
