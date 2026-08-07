import { supabase } from "@/infrastructure/supabase/client";

export type TvMediaKind = "shop" | "partner";

export type TvMediaAsset = {
  id: string;
  kind: TvMediaKind;
  storagePath: string;
  originalName: string;
  publicUrl: string;
};

const MEDIA_BUCKET = "club-tv-media";

const publicUrlFor = (storagePath: string) =>
  supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data.publicUrl;

export const tvMediaService = {
  async list(token: string): Promise<TvMediaAsset[]> {
    const { data, error } = await supabase.rpc("list_public_tv_media", {
      target_token: token,
    });

    if (error) throw error;

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      kind: row.kind as TvMediaKind,
      storagePath: String(row.storage_path),
      originalName: String(row.original_name),
      publicUrl: publicUrlFor(String(row.storage_path)),
    }));
  },
};
