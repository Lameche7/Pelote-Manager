import fs from "node:fs";

const path = "supabase/migrations/20260814161500_configure_tournament_finals_availability_minimum.sql";
let source = fs.readFileSync(path, "utf8");
const fromDeclare = `  previous_minimum integer;\nbegin`;
const toDeclare = `  previous_minimum integer;\n  active_team_id uuid;\nbegin`;
if (!source.includes(fromDeclare)) throw new Error("declare pattern missing");
source = source.replace(fromDeclare, toDeclare);
const fromUpdate = `  update public.tournaments\n  set\n    minimum_finals_availability_slots = target_minimum,\n    updated_by = auth.uid(),\n    updated_at = now()\n  where id = target_id;\n\n  if previous_minimum is distinct from target_minimum then`;
const toUpdate = `  update public.tournaments\n  set\n    minimum_finals_availability_slots = target_minimum,\n    updated_by = auth.uid(),\n    updated_at = now()\n  where id = target_id;\n\n  for active_team_id in\n    select team.id\n    from public.tournament_teams as team\n    where team.tournament_id = target_id\n      and team.status in ('pending', 'accepted')\n  loop\n    perform public.assert_tournament_team_finals_availability(active_team_id);\n  end loop;\n\n  if previous_minimum is distinct from target_minimum then`;
if (!source.includes(fromUpdate)) throw new Error("update pattern missing");
source = source.replace(fromUpdate, toUpdate);
source = source.replace("\n grant execute on function public.admin_get_tournament_with_finals_minimum(uuid)", "\ngrant execute on function public.admin_get_tournament_with_finals_minimum(uuid)");
fs.writeFileSync(path, source, "utf8");

if (fs.existsSync(".github/workflows/tmp-harden-finals-minimum.yml")) {
  fs.unlinkSync(".github/workflows/tmp-harden-finals-minimum.yml");
}
fs.unlinkSync("scripts/tmp-harden-finals-minimum.mjs");
