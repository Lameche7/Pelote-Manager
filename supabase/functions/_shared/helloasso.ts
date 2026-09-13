export type HelloAssoEnvironment = "sandbox" | "production";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type HelloAssoCheckoutIntent = {
  id: number;
  redirectUrl: string;
};

function baseUrls(environment: HelloAssoEnvironment) {
  if (environment === "production") {
    return {
      oauth: "https://api.helloasso.com/oauth2/token",
      api: "https://api.helloasso.com/v5",
    };
  }

  return {
    oauth: "https://api.helloasso-sandbox.com/oauth2/token",
    api: "https://api.helloasso-sandbox.com/v5",
  };
}

function helloAssoErrorDetails(response: Response, rawBody: string): string | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const detail = [payload.error_description, payload.error, payload.message].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (detail) return detail.trim().slice(0, 500);
  } catch {
    // Certaines protections réseau renvoient une page HTML plutôt qu'un JSON API.
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("text/html") ||
    /cloudflare|enable javascript|verify your connection|vérifier votre connexion|attention required/i.test(
      trimmed,
    )
  ) {
    return "La protection de sécurité HelloAsso/Cloudflare a bloqué la connexion du serveur.";
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 500);
}

export async function getHelloAssoAccessToken(input: {
  environment: HelloAssoEnvironment;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const urls = baseUrls(input.environment);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });

  const response = await fetch(urls.oauth, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = helloAssoErrorDetails(response, await response.text());
    throw new Error(
      `Authentification HelloAsso impossible (${response.status})${
        details ? ` : ${details}` : "."
      }`,
    );
  }

  const token = (await response.json()) as TokenResponse;
  return token.access_token;
}

export async function createHelloAssoCheckout(input: {
  environment: HelloAssoEnvironment;
  accessToken: string;
  organizationSlug: string;
  amountCents: number;
  itemName: string;
  payer?: { firstName?: string; lastName?: string; email?: string };
  metadata: Record<string, string>;
  backUrl: string;
  errorUrl: string;
  returnUrl: string;
}): Promise<HelloAssoCheckoutIntent> {
  const urls = baseUrls(input.environment);
  const response = await fetch(
    `${urls.api}/organizations/${encodeURIComponent(input.organizationSlug)}/checkout-intents`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        totalAmount: input.amountCents,
        initialAmount: input.amountCents,
        itemName: input.itemName,
        backUrl: input.backUrl,
        errorUrl: input.errorUrl,
        returnUrl: input.returnUrl,
        containsDonation: false,
        payer: input.payer,
        metadata: input.metadata,
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Création du paiement HelloAsso impossible (${response.status}): ${details}`,
    );
  }

  return (await response.json()) as HelloAssoCheckoutIntent;
}
