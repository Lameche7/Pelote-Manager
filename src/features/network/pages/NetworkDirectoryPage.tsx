import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/infrastructure/supabase/client";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import "./NetworkDirectoryPage.css";

type Club = { name: string; slug: string; logo_url: string | null };
type TournamentListing = { club: Club; tournament: PublicTournamentSummary };

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export function NetworkDirectoryPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tournaments, setTournaments] = useState<TournamentListing[]>([]);
  const [specialties, setSpecialties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data, error: directoryError } = await supabase.rpc(
          "list_network_clubs_v2",
        );
        if (directoryError) throw directoryError;
        const directory = ((data ?? []) as Club[]).filter(
          (club) =>
            typeof club.slug === "string" && typeof club.name === "string",
        );
        const lists = await Promise.allSettled(
          directory.map((club) => tour￿ֻǱ˞￿