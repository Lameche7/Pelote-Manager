import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canCleanupMemberRegistration } from "../_shared/memberRegistrationCleanup.ts";

Deno.serve(async (request) => {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return new Response("Unauthorized", { status: 401 });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) return new Response("Unauthorized", { status: 401 });

  let registrationToken: unknown;
  try {
    registrationToken = (await request.json()).registrationToken;
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("member_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError)
    return new Response("Cleanup check failed", { status: 500 });

  if (
    !canCleanupMemberRegistration(
      data.user.user_metadata,
      registrationToken,
      profile?.member_id ?? null,
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const { error: deletionError } = await admin.auth.admin.deleteUser(
    data.user.id,
  );
  if (deletionError) return new Response("Cleanup failed", { status: 500 });
  return new Response(null, { status: 204 });
});
