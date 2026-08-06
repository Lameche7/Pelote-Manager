# 15 — Roadmap produit

Version : 2.1  
Mise à jour : 5 août 2026

Cette roadmap présente les orientations produit de Pelote Manager. Elle distingue clairement les fonctions déjà disponibles, celles encore en construction et les idées futures.

## Principes

Pelote Manager évolue par ensembles cohérents, testés et utilisables. La stabilité, l’isolation des données de chaque club et la simplicité d’usage sont prioritaires.

Une fonction préparée techniquement mais désactivée n’est pas considérée comme commercialement disponible.

---

## Version 2.0 — Socle fonctionnel du club

**Statut : en cours, avec plusieurs blocs déjà opérationnels.**

### Disponible

- accueil et identité visuelle du club ;
- comptes, connexion et profils ;
- espace utilisateur ;
- gestion des licenciés ;
- calendrier et réservations ;
- tarifs licencié et visiteur ;
- paiement simulé ;
- administration des réservations ;
- informations, horaires, fermetures, saisons et tarifs du club ;
- événements ;
- permissions modulaires du Back Office ;
- socle d’instances de clubs techniquement isolées ;
- plateforme centrale super administrateur validée en simulation.

### À terminer pour la V2.0

- gestion complète des tournois ;
- séries, équipes, inscriptions et disponibilités ;
- Pool Engine ;
- Planning Engine ;
- Ranking Engine et résultats ;
- pages publiques de planning, résultats et classements ;
- Mode TV ;
- finalisation ergonomique et documentaire.

### Limites actuelles assumées

- le provisionnement réel d’un nouveau club est désactivé ;
- aucune ressource Supabase ou Vercel n’est créée automatiquement ;
- aucun compte, licencié ou dossier métier n’est partagé entre clubs ;
- le futur réseau de tournois et le passeport joueur ne sont pas implémentés.

---

## Version 2.1 — Optimisation et confort

Envisagé après stabilisation de la V2.0 :

- optimisation des moteurs de poules et de planning ;
- aide au choix de créneaux alternatifs ;
- statistiques enrichies ;
- personnalisation avancée du Mode TV ;
- améliorations d’ergonomie issues des retours des clubs pilotes.

---

## Version 2.2 — Paiements et notifications

Fonctions envisagées :

- paiement réel des réservations et inscriptions ;
- gestion des remboursements ;
- abonnements ou forfaits ;
- notifications automatiques par email ;
- rappels de matchs et de réservations.

Ces fonctions nécessiteront une étude de coûts, de conformité et de sécurité avant développement.

---

## Version 2.3 — Rapports et exploitation

Fonctions envisagées :

- tableau de bord statistique avancé ;
- exports PDF et Excel ;
- feuilles de match ;
- rapports de tournoi ;
- outils de suivi administratif et financier.

---

## Version 3.0 — Réseau et extensions

Orientations futures, non planifiées à ce jour :

- passeport joueur minimal pour les inscriptions interclubs ;
- réseau de tournois ouverts ;
- application mobile ;
- notifications Push ;
- synchronisations externes ;
- API publique contrôlée.

Le réseau restera séparé du registre commercial central. Les bases des clubs resteront indépendantes et aucun club n’aura accès au fichier complet d’un autre club.

---

## Architecture commerciale multi-instance

Le socle technique permet de viser plusieurs clubs tout en conservant :

- un seul produit et un seul dépôt de code ;
- une instance Supabase et un déploiement propres à chaque club ;
- une plateforme centrale limitée aux clients, abonnements, versions et états techniques ;
- aucune donnée de licencié, réservation, paiement ou tournoi dans le registre commercial.

La création automatique d’instances réelles ne sera activée qu’après un besoin commercial concret, une validation des coûts et une campagne de tests spécifique.

---

## Priorisation

- **Critique** : sécurité, perte de données ou blocage d’utilisation.
- **Importante** : fonction indispensable au fonctionnement quotidien du club.
- **Confort** : amélioration significative de l’expérience.
- **Future** : idée retenue mais non planifiée.

La prochaine priorité après la sécurisation des habilitations administrateur sera décidée séparément. Cette roadmap ne déclenche automatiquement aucun nouveau chantier.
