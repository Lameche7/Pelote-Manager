import type { SVGProps } from "react";
export function WhistleIcon(props:SVGProps<SVGSVGElement>){
 return <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
  <path d="M3 10h11l4-5h9l3 4v5l-4 4H14"/>
  <circle cx="9" cy="16" r="6"/>
  <circle cx="9" cy="16" r="2"/>
  <path d="M18 5v5h11"/>
 </svg>;
}