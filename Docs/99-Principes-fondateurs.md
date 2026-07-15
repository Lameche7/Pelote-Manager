# 99 - Principes fondateurs

Version : 2.0

Ce document définit les principes fondamentaux de Pelote Manager.

Ils constituent les règles immuables du projet.

Toute évolution, nouvelle fonctionnalité ou décision technique doit respecter ces principes.

En cas de contradiction avec un autre document, les principes décrits ici prévalent.
En cas de doute, la décision qui respecte le mieux ces principes doit toujours être privilégiée.
---

# 1. Le logiciel assiste l'organisateur

Pelote Manager n'a jamais vocation à remplacer l'organisateur.

Il automatise les tâches répétitives.

Il propose des solutions.

Il explique ses décisions.

La décision finale appartient toujours à l'administrateur.

---

# 2. Toute décision doit être explicable

Lorsqu'un moteur prend une décision.

Le logiciel doit être capable d'expliquer :

- pourquoi cette décision a été prise ;
- quelles contraintes ont été prises en compte ;
- quelles alternatives existaient éventuellement.

Le logiciel ne constitue jamais une boîte noire.

---

# 3. Une information n'est saisie qu'une seule fois

Une même donnée ne doit jamais être demandée plusieurs fois.

Lorsqu'une information existe déjà.

Elle est réutilisée.

Le logiciel évite toute double saisie.

---

# 4. Une seule source de vérité

Chaque donnée possède un emplacement unique.

Une information ne doit jamais être dupliquée inutilement.

Les calculs sont réalisés à partir des données de référence.

---

# 5. Les paramètres priment sur le code

Lorsqu'un comportement peut être configuré.

Il doit être défini dans les paramètres.

Le code ne doit jamais contenir de valeurs métier figées lorsque celles-ci peuvent être configurées.

---

# 6. La logique métier est indépendante

Les règles métier sont indépendantes :

- de l'interface utilisateur ;
- de la base de données ;
- des technologies utilisées.

Les moteurs métier doivent pouvoir fonctionner isolément.

---

# 7. Le calendrier est la référence unique

Toutes les occupations du trinquet utilisent un calendrier unique.

Un match.

Une réservation.

Une fermeture.

Une animation.

Sont tous représentés comme des événements du calendrier.

Cette approche garantit une cohérence globale.

---

# 8. La simplicité est une exigence

La solution la plus simple est toujours privilégiée.

Une fonctionnalité inutile n'est pas développée.

Une architecture complexe n'est jamais retenue sans justification.

---

# 9. La qualité prime sur la vitesse

Il est préférable de développer moins vite.

Mais de développer correctement.

La stabilité est prioritaire sur la quantité de fonctionnalités.

---

# 10. La documentation fait partie du logiciel

La documentation n'est pas optionnelle.

Toute évolution importante doit être documentée.

Le code et la documentation doivent rester synchronisés.

---

# 11. Les données importantes ne sont jamais perdues

Le logiciel privilégie :

- l'archivage ;
- la désactivation ;
- l'annulation.

Les suppressions définitives doivent rester exceptionnelles.

L'historique constitue une richesse.

---

# 12. L'utilisateur doit toujours comprendre

Le logiciel privilégie des messages simples.

Chaque erreur doit expliquer :

- ce qui s'est passé ;
- pourquoi ;
- comment résoudre le problème.

Le logiciel accompagne l'utilisateur.

Il ne le met jamais en difficulté.

---

# 13. Le logiciel fonctionne toute l'année

Pelote Manager n'est pas uniquement un logiciel de tournoi.

Il accompagne le club au quotidien.

Les tournois représentent une partie de son activité.

Les réservations, la communication et la vie du club en constituent une autre.

---

# 14. Chaque moteur possède une responsabilité unique

Le logiciel est construit autour de moteurs indépendants.

Notamment :

- Pool Engine ;
- Planning Engine ;
- Ranking Engine ;
- Reservation Engine.

Chaque moteur possède un rôle clairement défini.

Ils peuvent évoluer indépendamment.

---

# 15. Le projet doit rester durable

Chaque décision prise aujourd'hui doit permettre au logiciel d'évoluer demain.

Une évolution ne doit jamais remettre en cause les fondations du projet.

La pérennité est un objectif permanent.

---

# Principe fondamental

Pelote Manager est un assistant intelligent dédié à l'organisation de la vie d'un club de pelote.

Il automatise les tâches répétitives.

Il garantit la cohérence des données.

Il explique ses décisions.

Il accompagne les utilisateurs.

Il reste simple.

Fiable.

Évolutif.

Et laisse toujours l'humain maître des décisions.