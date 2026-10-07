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
  const {data:tournamentData,error:tournamentError}=await supabase.rpc("list_tournament_refereeing_matches");
  if(tournamentError)throw new Error(getSupabaseErrorMessage(tournamentError,"Impossible de charger les arbitrages des tournois."));
  const tournaments=Array.isArray(tournamentData)?tournamentData as RefereeingMatch[]:[];
  const ids=base.filter((x)=>x.source_type==="championship").map((x)=>x.match_id);
  if(ids.length===0)return [...base,...tournaments].sort((a,b)=>`${a.play_date??"9999"} ${a.play_time??""}`.localeCompare(`${b.play_date??"9999"} ${b.play_time??""}`));
  const {data:reservations}=await supabase.from("reservations").select("championship_match_id,starts_at,resource_id").in("championship_match_id",ids).in("status",["pending","confirmed"]);
  if(!reservations?.length)return [...base,...tournaments].sort((a,b)=>`${a.play_date??"9999"} ${a.play_time??""}`.localeCompare(`${b.play_date??"9999"} ${b.play_time??""}`));
  const resourceIds=Array.from(new Set(reservations.map((x)=>x.resource_id).filter(Boolean)));
  const {data:resources}=resourceIds.length?await supabase.from("reservable_resources").select("id,name,timezone").in("id",resourceIds):{data:[]};
  const resourceMap=new Map((resources??[]).map((x)=>[x.id,x]));
  const reservationMap=new Map(reservations.map((x)=>[x.championship_match_id,x]));
  const championships=base.map((x)=>{
   if(x.source_type!=="championship")return x;
   const reservation=reservationMap.get(x.match_id);
   if(!reservation)return x;
   const resource=resourceMap.get(reservation.resource_id);
   const instant=new Date(reservation.starts_at);
   const timezone=resource?.timezone??"Europe/Paris";
   const playDate=new Intl.DateTimeFormat("fr-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(instant);
   const playTime=new Intl.DateTimeFormat("fr-FR",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hour12:false}).format(instant).replace("h",":");
   return {...x,play_date:playDate,play_time:playTime,venue:resource?.name??x.venue};
  });
  return [...championships,...tournaments].sort((a,b)=>`${a.play_date??"9999"} ${a.play_time??""}`.localeCompare(`${b.play_date??"9999"} ${b.play_time??""}`));
 },
 async volunteer(match:RefereeingMatch){const {error}=await supabase.rpc("volunteer_for_refereeing",{target_source_type:match.source_type,target_match_id:match.match_id});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de prendre cet arbitrage."));},
 async withdraw(match:RefereeingMatch){const {error}=await supabase.rpc("withdraw_from_refereeing",{target_source_type:match.source_type,target_match_id:match.match_id});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de retirer cet arbitrage."));},
 async participation():Promise<RefereeingParticipation[]>{const {data,error}=await supabase.rpc("list_refereeing_participation");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les statistiques d’arbitrage."));return Array.isArray(data)?data as RefereeingParticipation[]:[];},
 async candidates():Promise<RefereeCandidate[]>{const {data,error}=await supabase.rpc("list_referee_candidates");if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible de charger les arbitres."));return Array.isArray(data)?data as RefereeCandidate[]:[];},
 async assign(match:RefereeingMatch,profileId:string|null){const {error}=await supabase.rpc("admin_set_referee",{target_source_type:match.source_type,target_match_id:match.match_id,target_profile_id:profileId});if(error)throw new Error(getSupabaseErrorMessage(error,"Impossible d’affecter cet arbitre."));}
};