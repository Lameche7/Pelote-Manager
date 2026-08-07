import { supabase } from "@/infrastructure/supabase/client";

export type ClubMediaKind = "dotation" | "partner";

export type ClubMediaAsset = {
  id: string;
  clubId: string;
  kind: ClubMediaKind;
  label: string;
  storagePath: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
};

const BUCKET = "club-media";
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const publicUrl = (storagePath: string) =>
  supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

const mapAsset = (row: Record<string, unknown>): ClubMediaAsset => ({
  id: String(row.id),
  clubId: String(row.club_id),
  kind: row.kind as ClubMediaKind,
  label: String(row.label ?? ""),
  storagePath: String(row.storage_path),
  imageUrl: publicUrl(String(row.storage_path)),
  sortOrder: Number(row.sort_order ?? 0),
  isActive: Boolean(row.is_active),
  createdAt: String(row.created_at),
});

async function currentClubId() {
  const { data, error } = await supabase.rpc("admin_current_club_id");
  if (error) throw error;
  return data as string;
}

function validateFile(file: File) {
  const extension = EXTENSION_BY_MIME[file.type];
  if (!extension) {
    throw new Error("Format non accepté. Utilisez une image JPEG, PNG ou WebP.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("L’image dépasse la taille maximale autorisée de 8 Mo.");
  }
  return extension;
}

export const clubMediaService = {
  async list(kind: ClubMediaKind): Promise<ClubMediaAsset[]> {
    const clubId = await currentClubId();
    const { data, error } = await supabase
      .from("club_media_assets")
      .select("*")
      .eq("club_id", clubId)
      .eq("kind", kind)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) => mapAsset(row as Record<string, unknown>));
  },

  async upload(
    kind: ClubMediaKind,
    file: File,
    label: string,
  ): Promise<ClubMediaAsset> {
    const extension = validateFile(file);
    const clubId = await currentClubId();

    const { data: latest, error: latestError } = await supabase
      .from("club_media_assets")
      .select("sort_order")
      .eq("club_id", clubId)
      .eq("kind", kind)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (latestError) throw latestError;

    const nextOrder = Number(latest?.[0]?.sort_order ?? 0) + 10;
    const storagePath = `${clubId}/${kind}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("club_media_assets")
      .insert({
        club_id: clubId,
        kind,
        label: label.trim().slice(0, 120),
        storage_path: storagePath,
        sort_order: nextOrder,
        is_active: true,
      })
      .select("*")
      .single();

    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }

    return mapAsset(data as Record<string, unknown>);
  },

  async update(
    asset: ClubMediaAsset,
    patch: Partial<Pick<ClubMediaAsset, "label" | "sortOrder" | "isActive">>,
  ) {
    const { error } = await supabase
      .from("club_media_assets")
      .update({
        ...(patch.label !== undefined
          ? { label: patch.label.trim().slice(0, 120) }
          : {}),
        ...(patch.sortOrder !== undefined
          ? { sort_order: patch.sortOrder }
          : {}),
        ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
      })
      .eq("id", asset.id)
      .eq("club_id", asset.clubId);

    if (error) throw error;
  },

  async remove(asset: ClubMediaAsset) {
    const { error } = await supabase
      .from("club_media_assets")
      .delete()
      .eq("id", asset.id)
      .eq("club_id", asset.clubId);
    if (error) throw error;

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([asset.storagePath]);
    if (storageError) throw storageError;
  },
};
