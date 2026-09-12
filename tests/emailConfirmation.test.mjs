import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [authService, loginPage, memberService] = await Promise.all([
  read("src/infrastructure/auth/authService.ts"),
  read("src/features/auth/pages/LoginPage.tsx"),
  read("src/features/members/services/memberService.ts"),
]);

test("les inscriptions peuvent exiger la confirmation email Supabase", () => {
  assert.match(authService, /emailRedirectTo: currentApplicationOrigin\(\)/);
  assert.match(authService, /return "confirmation_required"/);
  assert.match(memberService, /emailRedirectTo: currentApplicationOrigin\(\)/);
  assert.match(memberService, /confirmation_required/);
});

test("la connexion permet de renvoyer l'email de confirmation", () => {
  assert.match(authService, /supabase\.auth\.resend\(/);
  assert.match(authService, /type: "signup"/);
  assert.match(loginPage, /Renvoyer l’email de confirmation/);
  assert.match(loginPage, /Vérifiez aussi vos courriers indésirables/);
  assert.match(loginPage, /confirmer votre adresse email/);
});
