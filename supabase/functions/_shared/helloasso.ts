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
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Authentification HelloAsso impossible (${response.status}).`);
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
    throw new Error(`Création du paiement HelloAsso impossible (${response.status}): ${details}`);
  }

  return (await response.json()) as HelloAssoCheckoutIntent;
}
