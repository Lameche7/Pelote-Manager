# Pelote Manager

Pelote Manager est une application web dédiée à l’organisation des compétitions de
pelote basque. Ce dépôt accueille le socle frontend du projet et prépare un cadre de
développement commun, testable et évolutif, sans implémenter de règles métier à ce
stade.

## Attribution du premier rôle administrateur

La migration des rôles attribue le rôle non privilégié `visitor` aux profils existants.
Après son application, un administrateur du projet Supabase doit promouvoir
explicitement le premier compte depuis le SQL Editor, en remplaçant l'adresse
générique ci-dessous par celle du compte concerné :

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

Vérifiez que la commande a mis à jour exactement une ligne avant d'ouvrir `/admin`.
Cette opération doit être réalisée avec les droits d'administration Supabase et ne
doit pas être exposée aux utilisateurs de l'application.

## Socle technique

- React et TypeScript pour construire l’interface ;
- Vite pour le développement local et la génération des livrables ;
- React Router pour gérer la navigation ;
- TanStack Query pour orchestrer les échanges asynchrones ;
- Supabase JS pour communiquer avec les services Supabase ;
- Zod pour contrôler la configuration de l’application ;
- Vitest, Testing Library et jsdom pour les tests ;
- Oxlint et Prettier pour maintenir la qualité du code.

## Préparer l’environnement local

### Prérequis

Installez Node.js 24 et npm, puis récupérez le dépôt.

### Installation

```bash
git clone <url-du-depot>
cd Pelote-Manager
npm ci
cp .env.example .env.local
```

Renseignez les valeurs nécessaires dans `.env.local`, puis lancez l’application :

```bash
npm run dev
```

## Variables d’environnement

Le client Supabase requiert exactement les deux variables publiques suivantes :

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- `VITE_SUPABASE_URL` désigne l’URL du projet Supabase.
- `VITE_SUPABASE_ANON_KEY` contient la clé anonyme publique utilisée par le client.

Le fichier `.env.example` sert de référence. Les valeurs locales doivent être
placées dans `.env.local`, qui n’est pas destiné à être versionné. La configuration
est validée avec Zod lors de l’initialisation du client Supabase.

## Commandes

| Commande               | Utilisation                                              |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Ouvre le serveur de développement.                       |
| `npm run build`        | Vérifie les types et construit la version de production. |
| `npm run preview`      | Prévisualise localement la version de production.        |
| `npm run typecheck`    | Lance le contrôle TypeScript.                            |
| `npm run lint`         | Analyse les sources avec Oxlint.                         |
| `npm run format`       | Formate les fichiers avec Prettier.                      |
| `npm run format:check` | Contrôle le formatage sans modifier les fichiers.        |
| `npm run test`         | Exécute la suite de tests une fois.                      |
| `npm run test:watch`   | Relance les tests en continu pendant le développement.   |

## Arborescence principale

```text
.
├── .github/workflows/          # Pipeline d’intégration continue
├── Docs/                       # Spécifications et décisions du projet
├── public/                     # Ressources statiques
├── src/
│   ├── app/                    # Assemblage, routeur et providers
│   ├── features/               # Fonctionnalités organisées par domaine
│   ├── infrastructure/         # Adaptateurs vers les services externes
│   ├── shared/                 # Éléments transverses réutilisables
│   ├── test/                   # Initialisation de l’environnement de test
│   └── main.tsx                # Point d’entrée React
├── .env.example                # Modèle de configuration
├── package.json                # Scripts et dépendances
├── vite.config.ts              # Configuration de la construction
└── vitest.config.ts            # Configuration des tests
```

Les répertoires partagés ont les responsabilités suivantes :

- `src/shared/config` centralise la configuration de l’application ;
- `src/shared/components` reçoit les composants génériques ;
- `src/shared/errors` regroupe les erreurs communes ;
- `src/shared/types` contient les types transverses.

## Documentation

Les documents de cadrage, d’architecture et de conception sont disponibles dans
[`Docs`](./Docs/). Les principales références techniques sont :

- [`Docs/01-Architecture-generale.md`](./Docs/01-Architecture-generale.md) ;
- [`Docs/13-Architecture-technique.md`](./Docs/13-Architecture-technique.md) ;
- [`Docs/14-Conventions-de-developpement.md`](./Docs/14-Conventions-de-developpement.md).
