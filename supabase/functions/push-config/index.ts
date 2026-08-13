const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "";

  return Response.json(
    {
      enabled: publicKey.length > 0,
      publicKey: publicKey || null,
    },
    { headers: corsHeaders },
  );
});
