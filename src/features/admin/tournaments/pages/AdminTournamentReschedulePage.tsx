import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminTournamentUnprogrammedPanel } from "../components/AdminTournamentUnprogrammedPanel";
import { AdminTournamentManualRescheduleForm } from "@/features/admin/tournaments/components/AdminTournamentManualRescheduleForm";
import {
  ADMIN_RESCHEDULE_APPLY_LABEL,
  adminTournamentRescheduleService,
  type AdminTournamentRescheduleRequest,
} from "@/features/admin/tournaments/services/adminTournamentRescheduleService";
import "./AdminTournamentReschedulePage.css";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const dateLabel = (value: string) =>
  shortDate.format(new Date(`${value}T12:00:00`));

const statusLabels: Record<AdminTournamentRescheduleRequest["status"], string> =
  {
    pending: "Accords en cours",
    approved: "Prêt à appliquer",
    rejected: "Refusé",
    cancelled: "Annulé",
    stale: "Expiré / obsolète",
    applied: "Appliqué",
  };

const decisionLabels = {
  pending: "En attente",
  approved: "Accepté",
  rejected: "Refusé",
} as const;

const staleReasonLabels: Record<string, string> = {
  request_expired: "La demande a dépassé son délai d’application.",
  tournament_stage_changed: "Le tournoi a changé d’étape.",
  source_planning_changed: "Le créneau d’origine a changé depuis la demande.",
  swap_planning_changed:
    "La partie proposée pour l’échange a changé depuis la demande.",
￿ֻǱ˞￿