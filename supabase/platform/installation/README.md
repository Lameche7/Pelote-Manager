# Lot d’installation central

Ce dossier ne déploie rien et ne contacte aucun fournisseur.

Le manifeste `platformInstallationManifest.mjs` fixe l’ordre exact des migrations centrales. Le validateur `validatePlatformInstallationBundle.mjs` vérifie le lot et affiche les empreintes SHA-256 à conserver dans le compte rendu.

Commande de contrôle :

```bash
npm run platform:validate-installation-bundle
```

Le protocole humain complet se trouve dans `docs/runbooks/PLATFORM_CENTRAL_INSTALLATION.md`.

Aucun fichier de ce dossier ne doit être appliqué à la Production PCL, au projet Test ou à une instance de club.
