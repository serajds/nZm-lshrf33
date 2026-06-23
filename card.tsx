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
      <path d="M10 38V16L24 6L38 16V38H28V30H20V38H10Z" fill="currentColor" opacity="0.15" />
      <path d="M10 38V16L24 6L38 16V38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 38H20V30H28V38H38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="17" y="18" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="2" />
      <rect x="26" y="18" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="6" x2="24" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 42L36 46L44 37" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
