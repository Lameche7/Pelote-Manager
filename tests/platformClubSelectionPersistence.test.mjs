import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/features/platform/components/PlatformClubSwitcher.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("la sélection visuelle est conservée en session et restaurée dans l'URL", () => {
  assert.match(source, /CLUB_PREFERENCE_KEY/);
  assert.match(source, /sessionStorage\.getItem\(CLUB_PREFERENCE_KEY\)/);
  assert.match(source, /sessionStorage\.setItem\(CLUB_PREFERENCE_KEY, slug\)/);
  assert.match(
    source,
    /navigate\([\s\S]*?pathname: location\.pathname,[\s\S]*?search: next\.toString\(\),[\s\S]*?hash: location\.hash,[\s\S]*?replace: true/,
  );
});

test("la sélection mémorisée est vérifiée par le catalogue serveur", () => {
  assert.match(
    source,
    /clubs\.some\(\(club\) => club\.slug === selectedSlug\)/,
  );
  assert.match(source, /if \(!isVerifiedAdmin \|\| !clubs\.length\) return/);
  assert.match(source, /if \(!valid && selectedSlug\)/);
});

test("une session absente ou un rôle révoqué efface la préférence", () => {
  assert.match(
    source,
    /if \(identityError \|\| !identity\.user\) \{\s*window\.sessionStorage\.removeItem/,
  );
  assert.match(
    source,
    /if \(roleError \|\| allowed !== true\) \{\s*window\.sessionStorage\.removeItem/,
  );
});

test("le changement de club ne donne aucun droit métier", () => {
  assert.match(
    source,
    /Aperçu uniquement : aucune donnée ni permission modifiée/,
  );
  assert.doesNotMatch(source, /service_role/);
});

test("la plateforme et le catalogue indisponibles révoquent le choix local", () => {
  assert.match(
    source,
    /if \(!client\) \{\s*window\.sessionStorage\.removeItem\(CLUB_PREFERENCE_KEY\)/,
  );
  assert.match(
    source,
    /if \(catalogueError \|\| !Array\.isArray\(data\?\.clubs\)\) \{\s*window\.sessionStorage\.removeItem\(CLUB_PREFERENCE_KEY\)/,
  );
  assert.match(source, /to=\{ROUTES\.platformLogin\}/);
});

test("la restauration du club efface aussi un ancien contexte admin", () => {
  assert.match(
    source,
    /if \(activeSlug === desired && !hasStaleAdminContext\) return;[\s\S]*?next\.delete\("adminClubId"\);[\s\S]*?navigate\(/,
  );
});

test("le contexte admin périmé est supprimé même sans changement de club", () => {
  assert.match(source, /new URLSearchParams\(location\.search\)\.has\(/);
  assert.match(source, /activeSlug === desired && !hasStaleAdminContext/);
});

test("changer le club visuel réinitialise tout contexte admin précédent", () => {
  assert.match(source, /next\.delete\("adminClubId"\)/);
  assert.match(source, /if \(slug\) next\.set\("club", slug\)/);
});
