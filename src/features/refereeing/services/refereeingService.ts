import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
export type RefereeingMatch={match_id:string;club_id:string;source_type:"championship"|"tournament";competition_label:string;team1_label:string;team2_label:string;play_date:string|null;play_time:string|null;venue:string|null;referee_profile_id:string|null;referee_name:string|null;is_mine:boolean;my_count:number};
export type RefereeCandidate={id:string;name:string;count:number};
export type RefereeingParticipation={member_id:string;player_name:string;arbitration_count:number;total_licensed:number;different_referees:number};
export const refereeingService={
 async list():Promise<RefereeingMatch[]>{
  const {data,error}=await supabase.rpc("get_refereeing_workspace");
  if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les arbitrages."));
  const base=Array.isArray(data)?data as RefereeingMatch[]:[];
  return base.sort((a,b)=>`${a.play_date??"9999"} ${a.play_time??""}`.localeCompare(`${b.play_date??"9999"} ${b.play_time??""}`));
 },
 async volunteer(match:RefereeingMatch){const {error}=await supabase.rpc("volunteer_for_refereeing",{target_source_type:match.source_type,target_match_id:match.match_id});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de prendre cet arbitrage."));},
 async withdraw(match:RefereeingMatch){const {error}=await supabase.rpc("withdraw_from_refereeing",{target_source_type:match.source_type,target_match_id:match.match_id});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de retirer cet arbitrage."));},
 async participation():Promise<RefereeingParticipation[]>{const {data,error}=await supabase.rpc("list_refereeing_participation");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les statistiques d’arbitrage."));return Array.isArray(data)?data as RefereeingParticipation[]:[];},
 async candidates():Promise<RefereeCandidate[]>{const {data,error}=await supabase.rpc("list_referee_candidates");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les arbitres."));return Array.isArray(data)?data as RefereeCandidate[]:[];},
 async assign(match:RefereeingMatch,profileId:string|null){const {error}=await supabase.rpc("admin_set_referee",{target_source_type:match.source_type,target_match_id:match.match_id,target_profile_id:profileId});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible d’affecter cet arbitre."));},
 async alertMembers(missingCount:number):Promise<void>{const body=`Attention : ${missingCount} partie${missingCount>1?"s":""} à venir ${missingCount>1?"sont":"est"} encore sans arbitre. Consultez l’espace Arbitrage pour vous positionner.`;const {data:id,error:saveError}=await supabase.rpc("admin_save_communication",{payload:{title:"Arbitrage — parties à pourvoir",body,priority:"important",show_on_home:true}});if(saveError)throw new Error(getSupabaseErrorMessage(saveError,"Impossible de préparer la notification."));const {error:publishError}=await supabase.rpc("admin_publish_communication",{target_id:id});if(publishError)throw new Error(getSupabaseErrorMessage(publishError,"Impossible d’envoyer la notification."));}
};