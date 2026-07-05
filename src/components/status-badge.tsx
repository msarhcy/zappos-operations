import { cn } from "@/lib/utils";

type Tone = "available" | "in-use" | "warning" | "danger" | "critical" | "neutral";

const toneClasses: Record<Tone, string> = {
  available: "bg-status-available/15 text-status-available ring-status-available/30",
  "in-use": "bg-status-in-use/15 text-status-in-use ring-status-in-use/30",
  warning: "bg-status-warning/15 text-status-warning ring-status-warning/30",
  danger: "bg-status-danger/15 text-status-danger ring-status-danger/30",
  critical: "bg-status-critical/20 text-status-critical ring-status-critical/40",
  neutral: "bg-muted text-muted-foreground ring-border",
};

export interface StatusBadgeProps {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function StatusBadge({ tone = "neutral", children, className, dot = true }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        toneClasses[tone],
        className,
      )}
    >
      {dot ? (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-status-available": tone === "available",
            "bg-status-in-use": tone === "in-use",
            "bg-status-warning": tone === "warning",
            "bg-status-danger": tone === "danger",
            "bg-status-critical": tone === "critical",
            "bg-muted-foreground": tone === "neutral",
          })}
        />
      ) : null}
      {children}
    </span>
  );
}

/** Map ZappOS domain statuses to visual tones + label. */
export function jobStatusTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "unassigned": return { tone: "neutral", label: "Unassigned" };
    case "assigned": return { tone: "warning", label: "Assigned" };
    case "accepted": return { tone: "in-use", label: "Accepted" };
    case "in_progress": return { tone: "in-use", label: "In progress" };
    case "arrived": return { tone: "in-use", label: "Arrived" };
    case "completed": return { tone: "available", label: "Completed" };
    case "failed": return { tone: "danger", label: "Failed" };
    case "cancelled": return { tone: "neutral", label: "Cancelled" };
    default: return { tone: "neutral", label: status };
  }
}

export function vehicleStatusTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "available": return { tone: "available", label: "Available" };
    case "in_use": return { tone: "in-use", label: "In use" };
    case "maintenance": return { tone: "warning", label: "Maintenance" };
    case "out_of_service": return { tone: "danger", label: "Out of service" };
    default: return { tone: "neutral", label: status };
  }
}

export function driverStatusTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "available": return { tone: "available", label: "Available" };
    case "on_trip": return { tone: "in-use", label: "On trip" };
    case "off_duty": return { tone: "neutral", label: "Off duty" };
    case "suspended": return { tone: "danger", label: "Suspended" };
    default: return { tone: "neutral", label: status };
  }
}
