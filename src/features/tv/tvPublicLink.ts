export const PCL_TV_ALIAS = "pcl";
export const PCL_TV_TOKEN = "08008b4d-9825-487d-a156-8e69f7b8aaca";

const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const resolvePublicTvToken = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS ? PCL_TV_TOKEN : value;

export const isPublicTvIdentifier = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS || tokenPattern.test(value);

export const canonicalizePclTvUrl = (value: string) => {
  if (value !== PCL_TV_TOKEN) return;

  const suffix = `${window.location.search}${window.location.hash}`;
  window.history.replaceState(
    window.history.state,
    "",
    `/tv/${PCL_TV_ALIAS}${suffix}`,
  );
};
