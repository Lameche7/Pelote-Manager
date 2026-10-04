const ALLOWED_HOSTS = new Set(["lbpb.competition.ffpb.net"]);
const headersBase = { "user-agent": "PeloteManager/1.0 (+https://pelote-manager.vercel.app)", accept: "text/html,application/xhtml+xml,*/*" };
const fold = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
const decodeHtml = (value) => String(value ?? "").replace(/&nbsp;/giu," ").replace(/&amp;/giu,"&").replace(/&quot;/giu,'"').replace(/&#39;|&apos;/giu,"'").replace(/&lt;/giu,"<").replace(/&gt;/giu,">").replace(/&#(\d+);/gu,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/giu,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)));
const stripTags = (value) => decodeHtml(String(value ?? "").replace(/<[^>]+>/gu," ")).replace(/\s+/gu," ").trim();
const cookieFrom = (response) => { const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean); return values.map((value)=>String(value).split(";",1)[0]).join("; "); };
const mergeCookies = (...cookies) => { const values=new Map(); for(const cookie of cookies.filter(Boolean)){ for(const part of String(cookie).split(/;\s*/u)){ const index=part.indexOf("="); if(index>0) values.set(part.slice(0,index),part.slice(index+1)); }} return Array.from(values,([key,value])=>`${key}=${value}`).join("; "); };
const parseSelects = (html) => Array.from(html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/giu),(match)=>{ const attrs=match[1], body=match[2]; return { id:attrs.match(/\bid=["']([^"']+)["']/iu)?.[1]??null, name:attrs.match(/\bname=["']([^"']+)["']/iu)?.[1]??null, options:Array.from(body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu),(optionMatch)=>{ const optionAttrs=optionMatch[1]; return { value:decodeHtml(optionAttrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1]??""), label:stripTags(optionMatch[2]), selected:/\bselected\b/iu.test(optionAttrs) }; }) }; });
const parseFormValues = (html) => { const values=new Map(); for(const select of parseSelects(html)){ const selected=select.options.find((option)=>option.selected)??select.options[0]; if(select.name&&selected) values.set(select.name,selected.value); } for(const match of html.matchAll(/<input\b([^>]*)>/giu)){ const attrs=match[1]; const name=attrs.match(/\bname=["']([^"']+)["']/iu)?.[1]; if(!name) continue; const type=(attrs.match(/\btype=["']([^"']+)["']/iu)?.[1]??"text").toLowerCase(); if((type==="checkbox"||type==="radio")&&!/\bchecked\b/iu.test(attrs)) continue; values.set(name,decodeHtml(attrs.match(/\bvalue=["']([^"']*)["']/iu)?.[1]??"")); } return values; };
const sessionFrom = (html,cookie,origin) => { const actionRaw=decodeHtml(html.match(/<form[^>]*action=["']([^"']+)["']/iu)?.[1]??""); if(!actionRaw) throw new Error("Formulaire FFPB introuvable"); return {html,cookie,origin,action:new URL(actionRaw,origin)}; };
const openPublicSession = async(sourceUrl)=>{ const root=new URL("/FFPB_COMPETITION/",sourceUrl.origin); const response=await fetch(root,{redirect:"follow",headers:headersBase}); const html=await response.text(); if(!response.ok||!/<form\b/iu.test(html)) throw new Error("Page publique FFPB illisible"); return sessionFrom(html,cookieFrom(response),root.origin); };
const optionValue=(html,id,label)=>{ const target=fold(label); const select=parseSelects(html).find((item)=>item.id===id); return select?.options.find((option)=>fold(option.label)===target)?.value??null; };
const optionValueFlexible=(html,id,label)=>{ const exact=optionValue(html,id,label); if(exact) return exact; const target=fold(label).replace(/\bmasculin\b/gu,"").replace(/\bfeminin\b/gu,"feminine").replace(/\s+/gu," ").trim(); const select=parseSelects(html).find((item)=>item.id===id); return select?.options.find((option)=>fold(option.label).replace(/\s+/gu," ").trim()===target)?.value??null; };
const postForm=async(session,values)=>{ const body=new URLSearchParams(); for(const [key,value] of values) body.set(key,value); const response=await fetch(session.action,{method:"POST",redirect:"follow",headers:{...headersBase,"content-type":"application/x-www-form-urlencoded;charset=UTF-8",...(session.cookie?{cookie:session.cookie}:{}),referer:session.action.toString()},body}); const html=await response.text(); if(!response.ok) throw new Error("Réponse FFPB invalide"); return sessionFrom(html,mergeCookies(session.cookie,cookieFrom(response)),session.origin); };
const selectOption=async(session,fieldId,label,flexible=false)=>{ const value=flexible?optionValueFlexible(session.html,fieldId,label):optionValue(session.html,fieldId,label); if(!value) throw new Error(`Option introuvable ${fieldId}: ${label}`); const values=parseFormValues(session.html); values.set(fieldId,value); values.set("WD_ACTION_",""); values.set("WD_BUTTON_CLICK_",fieldId); return postForm(session,values); };
const describePage=(html)=>({
  title:stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]??""),
  headings:Array.from(html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/giu),(m)=>stripTags(m[1])).filter(Boolean).slice(0,40),
  buttons:Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/giu),(m)=>({id:m[1].match(/\bid=["']([^"']+)["']/iu)?.[1]??null,name:m[1].match(/\bname=["']([^"']+)["']/iu)?.[1]??null,text:stripTags(m[2])})).filter((x)=>x.text).slice(0,100),
  inputs:Array.from(html.matchAll(/<input\b([^>]*)>/giu),(m)=>({id:m[1].match(/\bid=["']([^"']+)["']/iu)?.[1]??null,name:m[1].match(/\bname=["']([^"']+)["']/iu)?.[1]??null,type:m[1].match(/\btype=["']([^"']+)["']/iu)?.[1]??null,value:decodeHtml(m[1].match(/\bvalue=["']([^"']*)["']/iu)?.[1]??"")})).slice(0,100),
  links:Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu),(m)=>({id:m[1].match(/\bid=["']([^"']+)["']/iu)?.[1]??null,href:decodeHtml(m[1].match(/\bhref=["']([^"']+)["']/iu)?.[1]??""),text:stripTags(m[2])})).filter((x)=>x.text).slice(0,100),
  selects:parseSelects(html).map((s)=>({id:s.id,name:s.name,selected:s.options.find((o)=>o.selected)?.label??null,options:s.options.map((o)=>o.label).slice(0,30)})).slice(0,30),
  text:stripTags(html).slice(0,6000)
});
export default async function handler(req,res){
  try{
    const sourceUrlRaw=String(req.query.sourceUrl??"").trim(); const sourceUrl=new URL(/^https?:\/\//iu.test(sourceUrlRaw)?sourceUrlRaw:`https://${sourceUrlRaw}`); if(!ALLOWED_HOSTS.has(sourceUrl.hostname)) throw new Error("sourceUrl invalide");
    const season=String(req.query.season??""); const competition=String(req.query.competition??""); const specialty=String(req.query.specialty??""); const division=String(req.query.division??"");
    let session=await openPublicSession(sourceUrl);
    session=await selectOption(session,"A34",season);
    const opts=parseSelects(session.html).find((item)=>item.id==="A33")?.options??[]; const folded=fold(competition); const comp=opts.find((o)=>fold(o.label)!=="toutes"&&folded.includes(fold(o.label))); if(!comp) throw new Error("Compétition introuvable");
    { const values=parseFormValues(session.html); values.set("A33",comp.value); values.set("WD_ACTION_",""); values.set("WD_BUTTON_CLICK_","A33"); session=await postForm(session,values); }
    session=await selectOption(session,"A36",division);
    session=await selectOption(session,"A38",specialty,true);
    const beforeSearch=describePage(session.html);
    { const values=parseFormValues(session.html); values.set("WD_ACTION_",""); values.set("WD_BUTTON_CLICK_","A32"); session=await postForm(session,values); }
    const afterSearch=describePage(session.html);
    res.status(200).json({beforeSearch,afterSearch});
  }catch(error){ res.status(500).json({error:error instanceof Error?error.message:"Erreur inconnue"}); }
}
