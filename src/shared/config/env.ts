import { z } from "zod";

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url("VITE_SUPABASE_URL doit être une URL valide."),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "VITE_SUPABASE_ANON_KEY est obligatoire."),
});

export const env = envSchema.parse(import.meta.env);
