import { SVGProps } from "react";

export function AppLogo({ className, ...props }: SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect x="8" y="18" width="20" height="22" rx="2" fill="currentColor" opacity="0.85" />
      <rect x="12" y="22" width="5" height="5" rx="1" fill="white" opacity="0.9" />
      <rect x="19" y="22" width="5" height="5" rx="1" fill="white" opacity="0.9" />
      <rect x="12" y="29" width="5" height="5" rx="1" fill="white" opacity="0.9" />
      <rect x="19" y="29" width="5" height="5" rx="1" fill="white" opacity="0.9" />
      <rect x="15" y="36" width="6" height="4" rx="0.5" fill="white" opacity="0.7" />
      <path d="M6 20L18 10L30 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <circle cx="35" cy="33" r="11" fill="currentColor" opacity="0.2" />
      <circle cx="35" cy="33" r="9" fill="white" />
      <circle cx="35" cy="33" r="8" fill="currentColor" opacity="0.15" />
      <path d="M30 33.5L33.5 37L40.5 29.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
