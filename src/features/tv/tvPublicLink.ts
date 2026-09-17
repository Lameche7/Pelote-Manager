export const PCL_TV_ALIAS = "pcl";
export const PCL_TV_TOKEN = "08008b4d-9825-487d-a156-8e69f7b8aaca";

export const resolvePublicTvToken = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS ? PCL_TV_TOKEN : value;

export const isPublicTvIdentifier = (value: string) =>
  value.toLowerCase() === PCL_TV_ALIAS ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
