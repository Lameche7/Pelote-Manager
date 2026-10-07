import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
export type RefereeingMatch={match_id:string;club_id:string;source_type:"championship"|"tournament";competition_label:string;team1_label:string;team2_label:string;play_date:string|null;play_time:string|null;venue:string|null;referee_profile_id:string|null;referee_name:string|null;is_mine:boolean;my_count:number};
export type RefereeCandidate={id:string;name:string;count:number};
export const refereeingService={
 async list():Promise<RefereeingMatch[]>{const {data,error}=await supabase.rpc("get_refereeing_workspace");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les arbitrages."));return Array.isArray(data)?data as RefereeingMatch[]:[];},
 async volunteer(match:RefereeingMatch){const {error}=await supabase.rpc("volunteer_for_refereeing",{target_source_type:match.source_type,target_match_id:match.match_id});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de prendre cet arbitrage."));},
 async candidates():Promise<RefereeCandidate[]>{const {data,error}=await supabase.rpc("list_referee_candidates");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les arbitres."));return Array.isArray(data)?data as RefereeCandidate[]:[];},
 async assign(match:RefereeingMatch,profileId:string|null){const {error}=await supabase.rpc("admin_set_referee",{target_source_type:match.source_type,target_match_id:match.match_id,target_profile_id:profileId});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible d’affecter cet arbitre."));}
};