import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "[Supabase] La variable VITE_SUPABASE_URL est absente du fichier .env.local."
  );
}

if (!supabasePublishableKey) {
  throw new Error(
    "[Supabase] La variable VITE_SUPABASE_PUBLISHABLE_KEY est absente du fichier .env.local."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);