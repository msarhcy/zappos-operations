import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}

const sizeMap = {
  sm: { icon: "h-5 w-5", text: "text-base" },
  md: { icon: "h-6 w-6", text: "text-lg" },
  lg: { icon: "h-8 w-8", text: "text-2xl" },
};

export function Wordmark({ className, size = "md", showTagline = false }: WordmarkProps) {
  const s = sizeMap[size];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
        <Zap className={s.icon} strokeWidth={2.5} />
      </div>
      <div className="flex min-w-0 flex-col leading-none">
        <span className={cn("font-semibold tracking-tight", s.text)}>
          Zapp<span className="text-primary">OS</span>
        </span>
        {showTagline ? (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Transport Operations
          </span>
        ) : null}
      </div>
    </div>
  );
}
