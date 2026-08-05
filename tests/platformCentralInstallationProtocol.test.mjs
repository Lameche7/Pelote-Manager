import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PLATFORM_INSTALLATION_BUNDLE } from "../supabase/platform/installation/platformInstallationManifest.mjs";
import { validatePlatformInstallationBundle } from "../supabase/platform/installation/validatePlatformInstallationBundle.mjs";

const runbook = fs.readFileSync(
  "docs/runbooks/PLATFORM_CENTRAL_INSTALLATION.md",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

function copyInstallationFixture() {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pelote-platform-installation-"),
  );

  for (const relativePath of [
    ...PLATFORM_INSTALLATION_BUNDLE.migrations,
    PLATFORM_INSTALLATION_BUNDLE.bootstrap,
  ]) {
    const destination = path.join(temporaryRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(relativePath, destination);
  }

  return temporaryRoot;
}

test("le lot central est ordonné, complet et vérifiable sans réseau", () => {
  const report = validatePlatformInstallationBundle();

  assert.equal(report.valid, true);
  assert.equal(report.purpose, "central-control-plane");
  assert.equal(report.migrations.length, 5);
  assert.deepEqual(
    report.migrations.map((migration) => migration.order),
    [1, 2, 3, 4, 5],
  );
  assert.ok(
    report.migrations.every((migration) =>
      /^[a-f0-9]{64}$/.test(migration.sha256),
    ),
  );
  assert.match(report.bootstrap.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.bootstrap.mustBeCustomizedOutsideGit, true);
});

test("une migration manquante ou non déclarée bloque le protocole", () => {
  const missingMigrationRoot = copyInstallationFixture();
  const extraMigrationRoot = copyInstallationFixture();

  try {
    fs.rmSync(
      path.join(
        missingMigrationRoot,
        PLATFORM_INSTALLATION_BUNDLE.migrations.at(-1),
      ),
    );
    assert.throws(
      () =>
        validatePlatformInstallationBundle({
          rootDir: missingMigrationRoot,
        }),
      /ne correspond pas exactement au manifeste central/i,
    );

    fs.writeFileSync(
      path.join(
        extraMigrationRoot,
        "supabase/platform/migrations/99999999999999_unlisted.sql",
      ),
      "-- Base CENTRALE de Pelote Manager uniquement.\nbegin;\ncommit;\n",
    );
    assert.throws(
      () =>
        validatePlatformInstallationBundle({
          rootDir: extraMigrationRoot,
        }),
      /ne correspond pas exactement au manifeste central/i,
    );
  } finally {
    fs.rmSync(missingMigrationRoot, { recursive: true, force: true });
    fs.rmSync(extraMigrationRoot, { recursive: true, force: true });
  }
});

test("le protocole interdit les bases de clubs, les secrets et le mode réel", () => {
  assert.match(runbook, /Production PCL et le projet Test restent exclus/i);
  assert.match(runbook, /Règles d’arrêt immédiat/);
  assert.match(runbook, /Aucune création n’est réalisée dans la PR43/);
  assert.match(
    runbook,
    /ne recevoir aucune migration provenant de `supabase\/migrations`/,
  );
  assert.match(runbook, /ne jamais consigner la clé `service_role`/i);
  assert.match(runbook, /Le mode `live` reste interdit/);
  assert.match(runbook, /domaines `\.invalid`/);
  assert.match(runbook, /La PR43 reste en brouillon/);
});

test("la commande de validation du lot reste purement locale", () => {
  assert.equal(
    packageJson.scripts["platform:validate-installation-bundle"],
    "node supabase/platform/installation/validatePlatformInstallationBundle.mjs",
  );

  const validator = fs.readFileSync(
    "supabase/platform/installation/validatePlatformInstallationBundle.mjs",
    "utf8",
  );
  assert.doesNotMatch(validator, /fetch\s*\(|https:\/\//i);
  assert.doesNotMatch(
    validator,
    /service_role|access_token|management_access_token/i,
  );
});
