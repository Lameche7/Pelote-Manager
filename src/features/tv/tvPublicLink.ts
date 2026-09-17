export const PCL_TV_ALIAS = "pcl";
export const PCL_TV_TOKEN = "08008b4d-9825-487d-a156-8e69f7b8aaca";

const canonicalPath = `/tv/${PCL_TV_ALIAS}`;
const internalPath = `/tv/${PCL_TV_TOKEN}`;

export const resolvePublicTvToken = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS ? PCL_TV_TOKEN : value;

export const isPublicTvIdentifier = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const currentSuffix = () => `${window.location.search}${window.location.hash}`;

const replaceVisiblePath = (pathname: string) => {
  window.history.replaceState(
    window.history.state,
    "",
    `${pathname}${currentSuffix()}`,
  );
};

/**
 * React Router doit continuer à recevoir le token UUID historique, mais l'adresse
 * visible du Mode TV PCL doit rester /tv/pcl. On présente donc brièvement le
 * chemin interne avant le premier rendu, puis on restaure l'URL canonique juste
 * après que le routeur a lu sa localisation initiale.
 */
export const preparePclTvCanonicalUrl = () => {
  const pathname = window.location.pathname.replace(/\/+$/u, "") || "/";

  if (pathname !== canonicalPath && pathname !== internalPath) {
    return () => undefined;
  }

  if (pathname === canonicalPath) replaceVisiblePath(internalPath);

  return () => replaceVisiblePath(canonicalPath);
};
