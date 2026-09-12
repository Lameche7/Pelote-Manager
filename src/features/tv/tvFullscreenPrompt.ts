import "./tvFullscreenPrompt.css";

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const TV_PATH_PATTERN = /^\/tv\/[^/]+\/?$/;
const BUTTON_ID = "pelote-manager-tv-fullscreen";

function currentFullscreenElement() {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

export function setupTvFullscreenPrompt() {
  if (!TV_PATH_PATTERN.test(window.location.pathname)) return;
  if (document.getElementById(BUTTON_ID)) return;

  const target = document.documentElement as WebkitFullscreenElement;
  const requestFullscreen = target.requestFullscreen
    ? () => target.requestFullscreen()
    : target.webkitRequestFullscreen
      ? () => target.webkitRequestFullscreen?.()
      : null;

  if (!requestFullscreen) return;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "tv-fullscreen-prompt";
  button.textContent = "⛶ Plein écran";
  button.setAttribute("aria-label", "Afficher le Mode TV en plein écran");

  const updateVisibility = () => {
    button.hidden = Boolean(currentFullscreenElement());
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await requestFullscreen();
      updateVisibility();
    } catch {
      button.textContent = "Plein écran indisponible";
      window.setTimeout(() => {
        button.textContent = "⛶ Plein écran";
        button.disabled = false;
      }, 2_500);
      return;
    }
    button.disabled = false;
  });

  document.addEventListener("fullscreenchange", updateVisibility);
  document.addEventListener("webkitfullscreenchange", updateVisibility);
  document.body.append(button);
  updateVisibility();
}
