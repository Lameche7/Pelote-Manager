import type { SVGProps } from "react";

/** Referee: bust with one arm raised. */
export function WhistleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" {...props}>
      <circle cx="9" cy="6.2" r="3.1" />
      <path d="M3.6 21v-6.2c0-2.7 2.2-4.9 4.9-4.9h2.1c1.1 0 2.2.4 3 1l2.1-2.1V3.1c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v6.4c0 .5-.2.9-.5 1.2l-4.2 4.2V21H3.6Z" />
    </svg>
  );
}