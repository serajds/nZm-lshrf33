import { ReactNode } from "react";
import { useLocation } from "wouter";

interface PageTransitionProps {
  children: ReactNode;
}

// Lightweight CSS transition: keeps page changes smooth without shipping the
// full animation runtime on the initial login route.
export function PageTransition({ children }: PageTransitionProps) {
  const [location] = useLocation();

  return (
    <div key={location} className="page-transition h-full w-full">
      {children}
    </div>
  );
}
