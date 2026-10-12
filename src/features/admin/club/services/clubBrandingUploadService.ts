import { supabase } from "@/infrastructure/supabase/client";

const BUCKET = "club-media";
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_SIZE = 2 * 1024 * 1024;

export type BrandingImageKind = "logo" | "hero";

export const clubBrandingUploadService = {
  async upload(
    clubId: string,
    kind: BrandingImageKind,
    file: File,
  ): Promise<string> {
    const extension = MIME_EXTENSIONS[file.type];
    if (!extension) throw new Error("Utilisez une image PNG, JPEG ou WebP.");
    if (!file.size || file.size > MAX_SIZE) {
      throw new Error("L'image doit peser moins de 2 Mo.");
    }
    const { data: authorizedClubId, error: identityError } = await supabase.rpc(
      "admin_current_club_id",
    );
    if (identityError || authorizedClubId !== clubId) {
      throw new Error("Vous n'avez pas l'autorisation de modifier ce club.");
    }
    const path = `${clubId}/dotation/branding-${kind}-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  },

  async discardUploadedImage(clubId: string, url: string): Promise<void> {
    const publicPrefix = supabase.storage.from(BUCKET).getPublicUrl("")
      .data.publicUrl;
    const prefix =ֻǱ˞