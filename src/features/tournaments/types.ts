export type TournamentTeamStatus =
  "pending" | "accepted" | "rejected" | "withdrawn";

export type TournamentPlayerRole = "front" | "back";

export type TournamentAvailabilityKind =
  "unavailable" | "preferred" | "possible";

export type TournamentSeriesRegistration = {
  id: string;
  name: string;
  capacity: number;
  acceptedCount: number;
  remainingSlots: number;
  enabled?: boolean;
  reservedCount?: number;
};

export type TournamentPlayWindow = {
  id: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
};

export type TournamentAvailabilitySlot = {
  date: string;
  startsAt: string;
  endsAt: string;
};

export type TournamentTeamPlayer = {
  memberId?: string | null;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  emailFromMember?: boolean;
  phoneFromMember?: boolean;
  role: TournamentPlayerRole;
};

export type TournamentAvailabilityRule = {
  kind: TournamentAvailabilityKind;
  weekday: number;
  startsAt: string;
  endsAt: string;
};

export type TournamentRegistrationIdentity = {
  memberId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emailFromMember: boolean;
  phoneFromMember: boolean;
};

export type TournamentPartnerSuggestion = {
  id: string;
  firstName: string;
  lastName: string;
  clubName: string;
  hasEmail: boolean;
  hasPhone: boolean;
};

export type PublicTournamentSummary = {
  id: string;
  name: string;
  description: string;
  startsOn: string;
  endsOn: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  status: string;
  teamCount: number;
  series: TournamentSeriesRegistration[];
};

export type PublicTournamentTeam = {
  id: string;
  seriesId: string;
  seriesName: string;
  players: TournamentTeamPlayer[];
};

export type PublicTournamentDetail = PublicTournamentSummary & {
  rules: string;
  canRegister: boolean;
  playWindows: TournamentPlayWindow[];
  availableSlots: TournamentAvailabilitySlot[];
  minimumAvailabilitySlots: number;
  minimumWeekendAvailabilitySlots: number;
  slotDurationMinutes: number;
  teams: PublicTournamentTeam[];
};

export type MyTournamentRegistration = {
  id: string;
  seriesId: string;
  status: TournamentTeamStatus;
  contactEmail: string;
  contactPhone: string;
  comments: string;
  players: TournamentTeamPlayer[];
  availabilityRules: TournamentAvailabilityRule[];
  availabilitySlots: TournamentAvailabilitySlot[];
};

export type MyTournamentRegistrationDraft = {
  seriesId: string;
  submitterRole: TournamentPlayerRole;
  submitterFirstName: string;
  submitterLastName: string;
  partnerMemberId: string | null;
  partnerFirstName: string;
  partnerLastName: string;
  partnerEmail: string;
  partnerPhone: string;
  contactEmail: string;
  contactPhone: string;
  comments: string;
  availabilityRules: TournamentAvailabilityRule[];
  availabilitySlots: TournamentAvailabilitySlot[];
};

export type AdminTournamentTeam = {
  id: string;
  seriesId: string;
  seriesName: string;
  status: TournamentTeamStatus;
  contactEmail: string;
  contactPhone: string;
  comments: string;
  submittedBy: string | null;
  registeredAt: string;
  updatedAt: string;
  players: TournamentTeamPlayer[];
  availabilityRules: TournamentAvailabilityRule[];
  availabilitySlotCount: number;
  weekendAvailabilitySlotCount: number;
};

export type AdminTournamentTeamDraft = {
  seriesId: string;
  status: "pending" | "accepted";
  contactEmail: string;
  contactPhone: string;
  comments: string;
  players: TournamentTeamPlayer[];
  availabilityRules: TournamentAvailabilityRule[];
};

export type AdminTournamentTeamsPayload = {
  tournament: {
    id: string;
    name: string;
    status: string;
    registrationOpensAt: string;
    registrationClosesAt: string;
    minimumAvailabilitySlots: number;
    minimumWeekendAvailabilitySlots: number;
    availableSlotCount: number;
    availableWeekendSlotCount: number;
  };
  series: TournamentSeriesRegistration[];
  teams: AdminTournamentTeam[];
};

// Tournament DTOs intentionally mirror the secured RPC projections.
