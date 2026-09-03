# Pilote PCL 2026 — socle RGPD et administratif

Ce document prépare le lancement grandeur nature de Pelote Manager pour le tournoi du Pelotaris Club Lourdais à partir du 21 septembre 2026.

## Répartition des rôles

- **Organisateur / responsable des traitements du pilote** : Pelotaris Club Lourdais pour les finalités liées à l’organisation du tournoi et aux services du club.
- **Pelote Manager** : application utilisée pour mettre en œuvre ces traitements.
- **Prestataires techniques** : Supabase (base de données, authentification et services associés) et Vercel (hébergement/déploiement de l’application).
- **Administrateurs** : accès limité au strict besoin de leur mission ; les niveaux de droits sont à arrêter avant l’ouverture du tournoi.

## Fiche de registre — tournoi PCL

| Rubrique | Contenu de travail |
| --- | --- |
| Finalités | inscriptions et rattachements, disponibilités, planning, résultats, reports, notifications, suivi du tournoi |
| Personnes concernées | joueurs PCL, joueurs d’autres clubs, organisateurs, administrateurs habilités |
| Données principales | nom, prénom, email de compte, données de licence si rattachement volontaire, équipe, partenaire, poste, série, disponibilités, matchs, résultats, actions utilisateur |
| Données importées | identité sportive issue de l’inscription au tournoi ; les coordonnées importées ne servent pas de preuve d’identité |
| Destinataires | organisateurs habilités, participants pour les informations nécessaires au tournoi, prestataires techniques |
| Sécurité | authentification, RLS Supabase, permissions club, rattachement explicite du compte aux participations, journalisation technique |
| Sous-traitants techniques | Supabase, Vercel |
| Contact droits | **À compléter avant ouverture publique** |
| Adresse officielle du responsable | **À compléter avant ouverture publique** |

## Durées de conservation à valider avant le 21/09

Proposition de départ à confirmer avec le PCL :

- identités importées non réclamées : suppression ou anonymisation dans les 3 mois suivant la clôture du tournoi ;
- comptes sans aucun rattachement ni activité : purge après 24 mois d’inactivité ;
- données opérationnelles de tournoi : conservation 24 mois pour gestion des contestations et bilan, puis réduction aux seules données sportives utiles à l’historique ;
- résultats/classements : conservation possible comme archive sportive du tournoi ;
- journaux techniques et de sécurité : 12 mois maximum sauf nécessité de sécurité ou obligation particulière.

Ces durées sont des choix de politique interne, pas des valeurs automatiques du RGPD. Elles doivent être cohérentes avec les usages réels et la minimisation des données.

## Information des joueurs

Avant le lancement :

1. mentions légales, politique de confidentialité et conditions d’utilisation accessibles publiquement ;
2. explication claire de la provenance d’une participation importée ;
3. rappel qu’une coordonnée saisie par un partenaire n’est jamais une preuve d’identité ;
4. point de contact unique pour accès, rectification, suppression et opposition lorsque celle-ci est applicable ;
5. pas de case générique de consentement utilisée comme justification de tous les traitements.

## Procédure incident

En cas de suspicion de fuite ou d’accès indu :

1. limiter immédiatement l’accès concerné sans détruire les traces utiles ;
2. noter heure, périmètre, données et personnes potentiellement touchées ;
3. prévenir le responsable désigné du PCL ;
4. évaluer le risque pour les personnes ;
5. si la violation présente un risque, préparer la notification CNIL dans le délai réglementaire ;
6. informer les personnes si le niveau de risque l’exige ;
7. corriger la cause et documenter les mesures prises.

## Checklist avant ouverture du tournoi

- [ ] renseigner l’adresse officielle du siège du PCL ;
- [ ] renseigner l’adresse email de contact / droits RGPD ;
- [ ] valider les durées de conservation ;
- [ ] nettoyer les tournois de test ;
- [ ] supprimer les comptes de test non liés après inventaire ;
- [ ] définir la liste nominative des administrateurs ;
- [ ] attribuer à chacun le niveau de droits nécessaire ;
- [ ] faire un test joueur extérieur complet sur la production propre ;
- [ ] faire un test de restauration/retour arrière des données critiques avant J-1.
