import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const envExample = fs.readFileSync(".env.example", "utf8");
const clubConfig = fs.readFileSync("src/shared/config/club.ts", "utf8");
const clubLogo = fs.readFileSync(
  "src/shared/components/ClubLogo.tsx",
  "utf8",
);
const mainLayout = fs.readFileSync("src/app/layouts/MainLayout.tsx", "utf8");
const homePage = fs.readFileSync(
  "src/features/home/pages/HomePage.tsx",
  "utf8",
);
const homeStyles = fs.readFileSync(
  "src/features/home/pages/PremiumHomePage.css",
  "utf8",
);
const profilePage = fs.readFileSync(
  "src/features/user-space/profile/pages/MyProfilePage.tsx",
  "utf8",
);
const blankBootstrap = fs.readFileSync(
  "supabase/instance-template/01_configure_blank_instance.sql",
  "utf8",
);
const adminBootstrap = fs.readFileSync(
  "supabase/instance-template/02_attach_first_club_admin.sql",
  "utf8",
);
const instanceReadme = fs.readFileSync(
  "supabase/instance-template/README.md",
  "utf8",
);

test("chaque déploiement peut recevoir l’identité propre de son club", () => {
  for (const variable of [
    "VITE_CLUB_NAME",
    "VITE_CLUB_SHORT_NAME",
    "VITE_CLUB_LOCATION",
    "VITE_CLUB_VENUE_NAME",
    "VITE_CLUB_TAGLINE",
    "VITE_CLUB_FOUNDED_YEAR",
    "VITE_CLUB_DESCRIPTION",
    "VITE_CLUB_LOGO_URL",
    "VITE_CLUB_HERO_URL",
  ]) {
    assert.match(envExample, new RegExp(variable));
    assert.match(clubConfig, new RegExp(variable));
  }
});

test("les écrans principaux lisent la configuration de l’instance", () => {
  for (const source of [clubLogo, mainLayout, homePage, profilePage]) {
    assert.match(source, /CLUB_CONFIG/);
  }
  assert.match(homePage, /heroImageUrl/);
  assert.match(homeStyles, /--club-hero-image/);
  assert.doesNotMatch(mainLayout, /Pelotaris Club Lourdais/);
  assert.doesNotMatch(homePage, /Pelotaris Club Lourdais/);
  assert.doesNotMatch(profilePage, /Pelotaris Club Lourdais/);
});

test("le bootstrap vierge refuse toute instance contenant déjà des données", () => {
  for (const protectedTable of [
    "auth.users",
    "public.profiles",
    "public.club_memberships",
    "public.club_members",
    "public.reservations",
    "public.calendar_occupations",
    "public.payments",
    "public.events",
  ]) {
    assert.match(blankBootstrap, new RegExp(protectedTable.replace(".", "\\.")));
  }
  assert.match(blankBootstrap, /Instance non vierge/);
  assert.match(blankBootstrap, /delete from public\.reservable_resources/);
});

test("le premier administrateur est créé uniquement dans l’instance du club", () => {
  assert.match(adminBootstrap, /from auth\.users/);
  assert.match(adminBootstrap, /insert into public\.profiles/);
  assert.match(adminBootstrap, /insert into public\.club_memberships/);
  assert.match(adminBootstrap, /key = 'administrator'/);
  assert.doesNotMatch(adminBootstrap, /search.*global/i);
});

test("la documentation impose un projet Supabase distinct par club", () => {
  assert.match(instanceReadme, /propre projet Supabase/);
  assert.match(instanceReadme, /authentification indépendante/);
  assert.match(instanceReadme, /licenciés et comptes indépendants/);
  assert.match(instanceReadme, /ne doit jamais recevoir ces scripts/);
});
