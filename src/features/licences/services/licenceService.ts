import { supabase } from "@/infrastructure/supabase/client";

export type LicenceRequestType = "renewal" | "first_application";
export type LicenceRequestStatus =
  | "pending_documents"
  | "pending_payment"
  | "ready_for_review"
  | "document_rejected"
  | "approved"
  | "licensed"
  | "cancelled";

export type LicencePayment = {
  id: string;
  status: string;
  amountCents: number;
  redirectUrl: string | null;
  paidAt: string | null;
  expiresAt: string;
};

export type LicencePortal = {
  campaign: null | {
    id: string;
    clubId: string;
    seasonId: string;
    seasonName: string;
    isOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
    renewalPriceCents: number;
    firstApplicationPriceCents: number;
    applicationFormPath: string | null;
    instructions: string | null;
  };
  member: null | {
    id: string;
    licenceNumber: string;
    firstName: string;
    lastName: string;
  };
  licensedForCampaign?: boolean;
  recommendedType: LicenceRequestType;
  request: null | {
    id: string;
    type: LicenceRequestType;
    status: LicenceRequestStatus;
    amountCents: number;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    gender: "male" | "female" | null;
    email: string;
    phone: string | null;
    documentPath: string | null;
    documentOriginalName: string | null;
    documentUploadedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
    payment: LicencePayment | null;
  };
};

export type AdminLicenceSettings = {
  clubId: string;
  seasons: Array<{
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
    isActive: boolean;
  }>;
  campaigns: Array<{
    id: string;
    seasonId: string;
    isOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
    renewalPriceCents: number;
    firstApplicationPriceCents: number;
    applicationFormPath: string | null;
    instructions: string | null;
    updatedAt: string;
  }>;
};

export type AdminLicenceRequest = {
  id: string;
  campaignId: string;
  seasonId: string;
  seasonName: string;
  profileId: string;
  memberId: string | null;
  type: LicenceRequestType;
  status: LicenceRequestStatus;
  amountCents: number;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  gender: string | null;
  email: string;
  phone: string | null;
  licenceNumber: string | null;
  documentPath: string | null;
  documentOriginalName: string | null;
  documentUploadedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  paymentStatus: string | null;
  paidAt: string | null;
};

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResult>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

const value = <T>({ data, error }: RpcResult): T => {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Réponse Supabase vide.");
  return data as T;
};

const signedUrl = async (path: string, expiresIn = 300) => {
  const { data, error } = await supabase.storage
    .from("licence-documents")
    .createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
};

export const licenceService = {
  getMyPortal: async () =>
    value<LicencePortal>(await rpc("get_my_licence_portal")),

  startMyRequest: async (payload: Record<string, unknown> = {}) =>
    value<string>(await rpc("start_my_licence_request", { payload })),

  uploadMyDocument: async (requestId: string, file: File) => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Connexion requise.");
    const path = `requests/${user.id}/${requestId}/document`;
    const { error: uploadError } = await supabase.storage
      .from("licence-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw new Error(uploadError.message);
    const result = await rpc("attach_my_licence_document", {
      target_request_id: requestId,
      target_path: path,
      original_name: file.name,
      mime_type: file.type,
    });
    if (result.error) throw new Error(result.error.message);
  },

  preparePayment: async (requestId: string) => {
    const result = value<Array<{ payment_id: string }>>(
      await rpc("prepare_my_licence_payment", {
        target_request_id: requestId,
      }),
    );
    const paymentId = result[0]?.payment_id;
    if (!paymentId) throw new Error("Paiement introuvable.");
    const { data, error } = await supabase.functions.invoke(
      "create-helloasso-checkout",
      { body: { paymentId } },
    );
    if (error) throw new Error(error.message);
    const redirectUrl = (data as { redirectUrl?: string } | null)?.redirectUrl;
    if (!redirectUrl) throw new Error("Lien HelloAsso introuvable.");
    return redirectUrl;
  },

  getTemplateUrl: (path: string) => signedUrl(path, 600),
  getDocumentUrl: (path: string) => signedUrl(path, 300),

  getAdminSettings: async () =>
    value<AdminLicenceSettings>(await rpc("admin_get_licence_settings")),

  saveCampaign: async (input: {
    seasonId: string;
    isOpen: boolean;
    renewalPriceCents: number;
    firstApplicationPriceCents: number;
    opensAt: string | null;
    closesAt: string | null;
    applicationFormPath: string | null;
    instructions: string | null;
  }) =>
    value<string>(
      await rpc("admin_save_licence_campaign", {
        target_season_id: input.seasonId,
        target_is_open: input.isOpen,
        target_renewal_price_cents: input.renewalPriceCents,
        target_first_application_price_cents:
          input.firstApplicationPriceCents,
        target_opens_at: input.opensAt,
        target_closes_at: input.closesAt,
        target_application_form_path: input.applicationFormPath,
        target_instructions: input.instructions,
      }),
    ),

  uploadTemplate: async (clubId: string, seasonId: string, file: File) => {
    const path = `templates/${clubId}/${seasonId}/application-form.pdf`;
    const { error } = await supabase.storage
      .from("licence-documents")
      .upload(path, file, {
        upsert: true,
        contentType: "application/pdf",
      });
    if (error) throw new Error(error.message);
    return path;
  },

  listAdminRequests: async () =>
    value<AdminLicenceRequest[]>(await rpc("admin_list_licence_requests")),

  review: async (
    requestId: string,
    action: "approve" | "reject" | "mark_licensed",
    reason?: string,
    licenceNumber?: string,
  ) => {
    const result = await rpc("admin_review_licence_request", {
      target_request_id: requestId,
      target_action: action,
      target_reason: reason ?? null,
      target_licence_number: licenceNumber ?? null,
    });
    if (result.error) throw new Error(result.error.message);
  },
};
