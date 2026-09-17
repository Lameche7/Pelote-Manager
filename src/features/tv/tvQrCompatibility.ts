const QUICKCHART_QR_HOST = "quickchart.io";
const QUICKCHART_QR_PATH = "/qr";

export const toTvCompatibleQrUrl = (value: string) => {
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.hostname !== QUICKCHART_QR_HOST ||
      url.pathname !== QUICKCHART_QR_PATH ||
      url.searchParams.get("format") !== "svg"
    ) {
      return value;
    }

    url.searchParams.set("format", "png");
    return url.toString();
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
