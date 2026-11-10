import { supabase } from "@/infrastructure/supabase/client";

export type ClubPaymentPolicy = {
  helloassoEnabled: boolean;
  cashEnabled: boolean;
  chequeEnabled: boolean;
  bankTransferEnabled: boolean;
  licenceConfirmation: "deferred" | "payment_required";
  tournamentConfirmation: "deferred" | "payment_required";
  tournamentHoldPlace: boolean;
  tournamentHoldHours: number;
};

type Row = {
  helloasso_enabled: boolean;
  cash_enabled: boolean;
  cheque_enabled: boolean;
  bank_transfer_enabled: boolean;
  licence_confirmation: ClubPaymentPolicy["licenceConfirmation"];
  tournament_confirmation: ClubPaymentPolicy["tournamentConfirmation"];
  tournament_hold_place: boolean;
  tournament_hold_hours: number;
};

export const clubPaymentPolicyService = {
  async get(): Promise<ClubPaymentPolicy> {
    const { data, error } = await supabase.rpc("admin_get_club_payment_policy");
    if (error) throw error;
    const row = (data as Row[] | null)?.[0];
    if (!row) throw new Error("Paramètres de paiement indisponibles.");
    return {
      helloassoEnabled: row.helloasso_enabled,
      cashEnabled: row.cash_enabled,
      chequeEnabled: row.cheque_enabled,
      bankTransferEnabled: row.bank_transfer_enabled,
      licenceConfirmation: row.licence_confirmation,
      tournamentConfirmation: row.tournament_confirmation,
      tournamentHoldPlace: row.tournament_hold_place,
      tournamentHoldHours: row.tournament_hold_hours,
    };
  },
  async save(value: ClubPaymentPolicy): Promise<void> {
    const { error } = await supabase.rpc("admin_save_club_payment_policy", {
      new_helloasso_enabled: value.helloassoEnabled,
      new_cash_enabled: value.cashEnabled,
      new_cheque_enabled: value.chequeEnabled,
      new_bank_transfer_enabled: value.bankTransferEnabled,
      new_licence_confirmation: value.licenceConfirmation,
      new_tournament_confirmation: value.tournamentConfirmation,
      new_tournament_hold_place: value.tournamentHoldPlace,
      new_tournament_hold_hours: value.tournamentHoldHours,
    });
    if (error) throw error;
  },
};
