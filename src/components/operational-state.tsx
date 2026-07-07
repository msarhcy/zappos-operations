import type { ComponentType } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface OperationalStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ComponentType<{ className?: string }>;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <Card className="grid min-h-56 place-items-center p-8 text-center">
      <div>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = AlertTriangle,
}: OperationalStateProps) {
  return (
    <Card className="grid min-h-56 place-items-center p-8 text-center">
      <div className="max-w-sm">
        <Icon className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        {actionLabel && onAction ? (
          <Button className="mt-4" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function ErrorState({
  title = "Could not load data",
  description,
  actionLabel = "Retry",
  onAction,
}: OperationalStateProps) {
  return (
    <Card className="grid min-h-56 place-items-center border-status-error/30 bg-status-error/5 p-8 text-center">
      <div className="max-w-sm">
        <AlertTriangle className="mx-auto h-7 w-7 text-status-error" />
        <p className="mt-3 text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        {onAction ? (
          <Button className="mt-4" size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
