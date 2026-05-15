import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const IconAny = Loader2Icon as unknown as React.ComponentType<React.ComponentProps<"svg"> & { role?: string; "aria-label"?: string }>
  return (
    <IconAny
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
