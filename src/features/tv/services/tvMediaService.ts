import { supabase } from "@/infrastructure/supabase/client";

export type TvMediaAsset = {
  id: string;
  label: string;
  storagePath: string;
  imageUrl: string;
};

export type TvMedia = {
  dotations: TvMediaAsset[];
  partners: TvMediaAsset[];
};

const BUCKET = "club-media";

const publicUrl = (storagePath: string) =>
  supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

const mapAsset = (row: Record<string, unknown>): TvMediaAsset => {
  const storagePath = String(row.storage_path ?? "");
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    storagePath,
    imageUrl: publicUrl(storagePath),
  };
};

const mapAssets = (value: unknown): TvMediaAsset[] =>
  Array.isArray(value)
    ? value.map((row) => mapAsset(row as Record<string, unknown>))
    : [];

export const tvMediaService = {
  async getMedia(token: string): Promise<TvMedia> {
    const { data, error } = await supabase.rpc("get_public_tv_media", {
      target_token: token,
    });

    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      dotations: mapAssets(payload.dotations),
      partners: mapAssets(payload.partners),
    };
  },
};
