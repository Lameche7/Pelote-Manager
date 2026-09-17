const QUICKCHART_QR_HOST = "quickchart.io";
const QUICKCHART_QR_PATH = "/qr";
const TV_QR_PROXY_PATH = "/api/tv-qr";

export const toTvCompatibleQrUrl = (value: string) => {
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.hostname !== QUICKCHART_QR_HOST ||
      url.pathname !== QUICKCHART_QR_PATH
    ) {
      return value;
    }

    const text = url.searchParams.get("text");
    if (!text) return value;

    const proxyUrl = new URL(TV_QR_PROXY_PATH, window.location.origin);
    proxyUrl.searchParams.set("text", text);
    return `${proxyUrl.pathname}${proxyUrl.search}`;
  } catch {
    return value;
  }
};

const normalizeQrImage = (image: HTMLImageElement) => {
  const source = image.getAttribute("src");
  if (!source) return;

  const compatibleSource = toTvCompatibleQrUrl(source);
  if (compatibleSource !== source) image.setAttribute("src", compatibleSource);
};

const normalizeQrImages = (root: ParentNode) => {
  root
    .querySelectorAll<HTMLImageElement>('img[src*="quickchart.io/qr"]')
    .forEach(normalizeQrImage);
};

export const setupTvQrCompatibility = () => {
  if (!window.location.pathname.startsWith("/tv/")) return;

  normalizeQrImages(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof HTMLImageElement
      ) {
        normalizeQrImage(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          normalizeQrImage(node);
        } else if (node instanceof Element) {
          normalizeQrImages(node);
        }
      });
    });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"],
  });
};
