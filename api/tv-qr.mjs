const QUICKCHART_QR_ENDPOINT = "https://quickchart.io/qr";
const MAX_QR_TEXT_LENGTH = 2048;

const readQueryText = (request) => {
  const raw = request.query?.text;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const text = readQueryText(request);
  if (!text || text.length > MAX_QR_TEXT_LENGTH) {
    return response.status(400).json({ error: "Invalid QR content" });
  }

  try {
    const url = new URL(QUICKCHART_QR_ENDPOINT);
    url.searchParams.set("text", text);
    url.searchParams.set("format", "png");
    url.searchParams.set("size", "280");
    url.searchParams.set("margin", "2");
    url.searchParams.set("ecLevel", "M");
    url.searchParams.set("dark", "000000");
    url.searchParams.set("light", "ffffff");

    const qrResponse = await fetch(url, {
      headers: {
        accept: "image/png",
        "user-agent": "PILOTOKI-TV/1.0",
      },
    });

    if (!qrResponse.ok) {
      return response.status(502).json({ error: "QR provider unavailable" });
    }

    const contentType = qrResponse.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("image/png")) {
      return response.status(502).json({ error: "Unexpected QR response" });
    }

    const image = Buffer.from(await qrResponse.arrayBuffer());

    response.setHeader("Content-Type", "image/png");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    );
    return response.status(200).send(image);
  } catch {
    return response.status(502).json({ error: "QR generation failed" });
  }
}
