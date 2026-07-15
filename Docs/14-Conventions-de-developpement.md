# 14 - Conventions de développement

Version : 2.0

Ce document définit les conventions de développement applicables à l'ensemble du projet Pelote Manager.

Ces conventions garantissent une base de code homogène, lisible et maintenable.

Elles doivent être respectées par tous les développements, qu'ils soient réalisés manuellement ou assistés par une intelligence artificielle.

---

# Objectif

Le projet doit rester :

- simple ;
- cohérent ;
- lisible ;
- facilement maintenable.

La priorité n'est jamais d'écrire moins de code.

La priorité est d'écrire du code compréhensible.

---

# Philosophie

Chaque élément du projet possède une responsabilité unique.

La simplicité est toujours privilégiée.

Lorsque plusieurs solutions existent.

La plus simple est retenue.

---

# Langue

Toute la documentation est rédigée en français.

Le code source est rédigé en anglais.

Les noms des variables, fonctions, classes et fichiers utilisent exclusivement l'anglais.

Les textes affichés aux utilisateurs sont rédigés en français.

---

# Organisation des dossiers

Le projet est organisé par responsabilités.

Exemple :

src/

components/

pages/

features/

services/

engines/

hooks/

types/

utils/

Chaque dossier possède un rôle clairement identifié.

---

# Organisation des composants

Un composant React possède une seule responsabilité.

Il ne doit jamais contenir :

- de logique métier ;
- d'appel direct à Supabase ;
- de traitements complexes.

Il se limite à l'affichage et aux interactions utilisateur.

---

# Organisation des moteurs

Toute logique métier appartient à un moteur.

Les moteurs sont indépendants :

- de React ;
- de Supabase ;
- de l'interface utilisateur.

Ils doivent pouvoir être testés isolément.

---

# Organisation des services

Les services assurent la communication avec Supabase.

Ils centralisent :

- les requêtes ;
- les transformations de données ;
- les appels réseau.

Aucun composant React ne doit appeler directement Supabase.

---

# Fonctions

Une fonction possède une seule responsabilité.

Elle doit être :

- courte ;
- lisible ;
- facilement testable.

Une fonction complexe doit être découpée.

---

# Fichiers

Un fichier possède une responsabilité unique.

Les fichiers volumineux doivent être découpés.

Le découpage est préféré à la multiplication des responsabilités.

---

# Nommage

Les noms doivent être explicites.

Les abréviations sont évitées.

Exemples :

generatePoolPlan

calculateRanking

createReservation

Le nom doit permettre de comprendre immédiatement le rôle de l'élément.

---

# Commentaires

Le code doit être suffisamment clair pour limiter les commentaires.

Les commentaires expliquent le pourquoi.

Jamais le fonctionnement évident du code.

---

# Réutilisation

Toute logique utilisée plusieurs fois doit être factorisée.

Le copier-coller est interdit.

Une règle métier ne doit exister qu'à un seul endroit.

---

# Gestion des erreurs

Chaque erreur doit être :

- détectée ;
- interceptée ;
- expliquée.

Les messages techniques ne sont jamais affichés à l'utilisateur.

---

# Journalisation

Les journaux distinguent :

- informations ;
- avertissements ;
- erreurs.

Les journaux de développement sont supprimés avant la mise en production.

---

# TypeScript

Le typage est obligatoire.

L'utilisation de "any" est interdite sauf justification exceptionnelle.

Les interfaces et types doivent être privilégiés.

---

# Variables

Les variables doivent être déclarées au plus près de leur utilisation.

Les constantes sont privilégiées.

Les valeurs magiques sont interdites.

Toute valeur métier doit être nommée.

---

# Dépendances

Une bibliothèque n'est ajoutée qu'après validation.

Chaque dépendance doit répondre à un besoin réel.

Le projet privilégie les bibliothèques reconnues et maintenues.

---

# Tests

Toute logique métier importante doit être testée.

Les moteurs doivent pouvoir être exécutés indépendamment de l'interface.

---

# Documentation

Toute évolution importante implique la mise à jour :

- de la documentation ;
- des spécifications concernées ;
- des commentaires utiles.

La documentation fait partie intégrante du développement.

---

# Intelligence artificielle

Les outils d'assistance au développement sont autorisés.

Toutefois.

Le code généré doit être :

- relu ;
- compris ;
- validé.

Aucun code généré automatiquement ne doit être intégré sans vérification.

---

# Principe fondamental

Le code doit pouvoir être compris rapidement par un développeur découvrant le projet.

La lisibilité est une exigence.

La simplicité est une priorité.

La cohérence est une obligation.