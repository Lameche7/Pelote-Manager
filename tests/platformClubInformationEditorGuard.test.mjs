import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(
  "src/features/admin/club/pages/PlatformClubInformationEditor.tsx",
  "utf8",
);
const service = readFileSync(
  "src/features/admin/club/services/clubAdminService.ts",
  "utf8",
);
const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);

test("la fiche inter-clubs utilise uniquement les RPC avec club explicite", () => {
  assert.match(editor, /getClubForPlatformLease\(clubId\)/);
  assert.match(editor, /updateClubForPlatformLease\(club\)/);
  assert.match(service, /"platform_admin_get_club_information"/);
  assert.match(service, /"platform_admin_update_club_information"/);
  assert.match(service, /target_club_id: club\.id/);
});

test("une réponse tardive ne remplace jamais la fiche d'un autre club", () => {
  assert.match(editor, /currentClubId\.current = clubId/);
  assert.match(editor, /if \(currentClubId\.current !== clubId\) return/);
  assert.match(editor, /if \(active\) setClub\(result\)/);
  assert.match(editor, /setSaving\(false\);\s*setLoading\(true\)/);
});

test("la fiche n'ouvre pas les autres modules administratifs", () => {
  assert.doesNotMatch(editor, /updateClub\(club\)/);
  assert.doesNotMatch(
    editor,
    /\b(?:uploadFile|uploadImage|service_role)\s*\(/i,
  );
  assert.match(shell, /if \(requestedClubId\) \{/);
});
