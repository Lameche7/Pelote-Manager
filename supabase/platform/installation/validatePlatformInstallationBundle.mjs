import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLATFORM_INSTALLATION_BUNDLE } from "./platformInstallationManifest.mjs";

const CENTRAL_HEADER = "Base CENTRALE de Pelote Manager uniquement";
const FORBIDDEN_CONTENT = [
  /https:\/\/api\.supabase\.com/i,
  /https:\/\/api\.vercel\.com/i,
  /authorization:\s*Bearer\s+\S+/i,
  /sb_secret_/i,
  /eyJ[a-zA-Z0-9_-]{20,}/,
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readUtf8(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  requireCondition(
    fs.existsSync(absolutePath),
    `Fichier d’installation manquant : ${relativePath}`,
  );

  return {
    relativePath,
    absolutePath,
    content: fs.readFileSync(absolutePath, "utf8"),
  };
}

function validateMigration(file) {
  requireCondition(
    file.relativePath.startsWith("supabase/platform/migrations/"),
    `Migration hors du dossier central : ${file.relativePath}`,
  );
  requireCondition(
    !file.relativePath.startsWith("supabase/migrations/"),
    `Une migration de club ne peut pas appartenir au lot central : ${file.relativePath}`,
  );
  requireCondition(
    file.content.includes(CENTRAL_HEADER),
    `En-tête central obligatoire absent : ${file.relativePath}`,
  );
  requireCondition(
    /\bbegin;\s/i.test(file.content) && /\bcommit;\s*$/i.test(file.content),
    `Transaction complète obligatoire : ${file.relativePath}`,
  );
  requireCondition(
    !file.content.includes("A_REMPLACER_PAR_EMAIL_SUPER_ADMIN"),
    `Le bootstrap ne doit jamais être inclus dans une migration : ${file.relativePath}`,
  );

  for (const forbiddenPattern of FORBIDDEN_CONTENT) {
    requireCondition(
      !forbiddenPattern.test(file.content),
      `Contenu sensible ou appel fournisseur interdit : ${file.relativePath}`,
    );
  }
}

function validateBootstrap(file) {
  requireCondition(
    file.relativePath.startsWith("supabase/platform/bootstrap/"),
    "Le bootstrap propriétaire doit rester séparé des migrations.",
  );
  requireCondition(
    file.content.includes("A_REMPLACER_PAR_EMAIL_SUPER_ADMIN"),
    "Le bootstrap doit conserver son placeholder afin qu’aucun compte réel ne soit commité.",
  );
  requireCondition(
    file.content.includes("Remplacez platform_admin_email avant exécution"),
    "Le bootstrap doit refuser une exécution sans remplacement explicite de l’adresse.",
  );
}

export function validatePlatformInstallationBundle({
  rootDir = process.cwd(),
} = {}) {
  const migrationPaths = [...PLATFORM_INSTALLATION_BUNDLE.migrations];
  const sortedMigrationPaths = [...migrationPaths].sort();

  requireCondition(
    new Set(migrationPaths).size === migrationPaths.length,
    "Le manifeste central contient une migration en double.",
  );
  requireCondition(
    JSON.stringify(migrationPaths) === JSON.stringify(sortedMigrationPaths),
    "Les migrations centrales ne sont pas classées dans l’ordre chronologique.",
  );

  const migrationsDirectory = path.resolve(
    rootDir,
    "supabase/platform/migrations",
  );
  const discoveredMigrations = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => `supabase/platform/migrations/${fileName}`)
    .sort();

  requireCondition(
    JSON.stringify(discoveredMigrations) === JSON.stringify(migrationPaths),
    "Le contenu du dossier migrations ne correspond pas exactement au manifeste central.",
  );

  const migrationReports = migrationPaths.map((relativePath, index) => {
    const file = readUtf8(rootDir, relativePath);
    validateMigration(file);

    return Object.freeze({
      order: index + 1,
      path: relativePath,
      sha256: sha256(file.content),
    });
  });

  const bootstrap = readUtf8(
    rootDir,
    PLATFORM_INSTALLATION_BUNDLE.bootstrap,
  );
  validateBootstrap(bootstrap);

  return Object.freeze({
    valid: true,
    bundleVersion: PLATFORM_INSTALLATION_BUNDLE.bundleVersion,
    purpose: PLATFORM_INSTALLATION_BUNDLE.purpose,
    migrations: Object.freeze(migrationReports),
    bootstrap: Object.freeze({
      path: bootstrap.relativePath,
      sha256: sha256(bootstrap.content),
      mustBeCustomizedOutsideGit: true,
    }),
  });
}

function printReport(report) {
  console.log(`Lot ${report.bundleVersion} validé pour ${report.purpose}.`);
  for (const migration of report.migrations) {
    console.log(
      `${migration.order}. ${migration.path} — sha256:${migration.sha256}`,
    );
  }
  console.log(
    `Bootstrap séparé : ${report.bootstrap.path} — sha256:${report.bootstrap.sha256}`,
  );
  console.log("Aucune connexion réseau et aucune migration n’ont été exécutées.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  printReport(validatePlatformInstallationBundle());
}
