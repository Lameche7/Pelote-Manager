import { supabase } from "@/infrastructure/supabase/client";

export type ClubTvMediaKind = "shop" | "partner";

export type ClubTvMedia = {
  id: string;
  clubId: string;
  kind: ClubTvMediaKind;
  storagePath: string;
  originalName: string;
  publicUrl: string;
};

const MEDIA_BUCKET = "club-tv-media";
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function currentClubId() {
  const { data, error } = await supabase.rpc("admin_current_club_id");
  if (error) throw error;
  return String(data);
}

const publicUrlFor = (storagePath: string) =>
  supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data.publicUrl;

const mapMedia = (row: Record<string, unknown>): ClubTvMedia => ({
  id: String(row.id),
  clubId: String(row.club_id),
  kind: row.kind as ClubTvMediaKind,
  storagePath: String(row.storage_path),
  originalName: String(row.original_name),
  publicUrl: publicUrlFor(String(row.storage_path)),
});

const validateFile = (file: File) => {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Formats acceptés : JPEG, PNG ou WebP.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Chaque image doit peser au maximum 8 Mo.");
  }
};

export const clubMediaService = {
  async list(): Promise<ClubTvMedia[]> {
    const clubId = await currentClubId();
    const { data, error } = await supabase
      .from("club_tv_media")
      .select("id, club_id, kind, storage_path, original_name, created_at")
      .eq("club_id", clubId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) => mapMedia(row as Record<string, unknown>));
  },

  async upload(kind: ClubTvMediaKind, file: File): Promise<ClubTvMedia> {
    validateFile(file);
    const clubId = await currentClubId();
    const extension = extensionByMimeType[file.type];
    const storagePath = `${clubId}/${kind}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data, error: insertError } = await supabase
      .from("club_tv_media")
      .insert({
        club_id: clubId,
        kind,
        storage_path: storagePath,
        original_name: file.name || `image.${extension}`,
        created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      })
      .select("id, club_id, kind, storage_path, original_name")
      .single();

    if (insertError) {
      await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
      throw insertError;
    }

    return mapMedia(data as Record<string, unknown>);
  },

  async remove(media: ClubTvMedia): Promise<void> {
    const { error: deleteError } = await supabase
      .from("club_tv_media")
      .delete()
      .eq("id", media.id)
      .eq("club_id", media.clubId);

    if (deleteError) throw deleteError;

    const { error: storageError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .remove([media.storagePath]);

    if (storageError) throw storageError;
  },
};
