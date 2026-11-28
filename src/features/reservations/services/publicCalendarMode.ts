import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

export type CalendarMode = "reservations" | "planning" | "disabled";

export function usePublicCalendarMode(clubSlug: string | null) {
  const [state, setState] = useState<{
    slug: string | null;
    mode: CalendarMode | null;
    error: boolean;
  }>({ slug: clubSlug, mode: null, error: false });

  useEffect(() => {
    let active = true;
    setState({ slug: clubSlug, mode: null, error: false });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc(
          "get_public_club_calendar_mode",
          { target_slug: clubSlug },
        );
        if (
          error ||
          (data !== "reservations" &&
            data !== "planning" &&
            data !== "disabled")
        ) {
          throw new Error("Calendar mode unavailable");
        }
        if (active) setState({ slug: clubSlug, mode: data, error: false });
      } catch {
        if (active) setState({ slug: clubSlug, mode: null, error: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [clubSlug]);

  return state.slug === clubSlug
    ? state
    : { slug: clubSlug, mode: null, error: false };
}
