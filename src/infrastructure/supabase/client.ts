import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/infrastructure/supabase/database";
import { env } from "@/shared/config/env";

export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
);
