/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

const PAGE_SIZE = 20;
const categories = [
  "operations",
  "maintenance",
  "incident",
  "customer",
  "field",
  "hardware",
  "brain",
];
const labels: Record<string, string> = {
  operations: "Operations",
  maintenance: "Maintenance",
  incident: "Incidents",
  customer: "Customer Requests",
  field: "Field Deployment",
  hardware: "Hardware",
  brain: "Brain",
};

function NotificationsPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const { user } = useSession();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const permitted = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer", "driver"]);

  useEffect(() => {
    if (!activeCompany || !user || !permitted) return;
    setLoading(true);
    void (supabase as any)
      .from("command_centre_notifications")
      .select("*")
      .eq("company_id", activeCompany.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: any[] | null }) => {
        setItems(data ?? []);
        setLoading(false);
      });
  }, [activeCompany?.id, user?.id, permitted]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (status === "all" || item.status === status) &&
          (category === "all" || item.source === category) &&
          `${item.title} ${item.source} ${item.priority}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [items, status, category, query],
  );
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageItems = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => setPage(0), [query, status, category]);

  const update = async (id: string, nextStatus: string) => {
    if (nextStatus === "acknowledged" && items.find((item) => item.id === id)?.source === "brain")
      return;
    await (supabase as any)
      .from("command_centre_notifications")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", id);
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status: nextStatus } : item)),
    );
  };

  if (!permitted)
    return (
      <div className="p-6">
        <Card className="p-6">Notifications are not available for this role.</Card>
      </div>
    );
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 lg:p-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Operations workspace
        </p>
        <h1 className="text-3xl font-semibold">Notifications</h1>
      </div>
      <Card className="p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_10rem_12rem]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notifications"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((item) => (
                <SelectItem key={item} value={item}>
                  {labels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
      <section aria-live="polite" className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Loading notifications…
          </Card>
        ) : null}
        {!loading && pageItems.length === 0 ? (
          <Card className="p-8 text-center">
            <Bell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No notifications found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Notifications appear here only when an integrated system creates one.
            </p>
          </Card>
        ) : null}
        {pageItems.map((item) => (
          <Card
            key={item.id}
            className={`p-4 ${item.status === "unread" ? "border-primary/50" : ""}`}
          >
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{item.title}</h2>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs capitalize">
                    {item.priority}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    {labels[item.source] ?? item.source}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()} · {item.status}
                </p>
                {item.source === "brain" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Brain notifications are read-only.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {item.status === "unread" && (
                  <Button size="sm" variant="outline" onClick={() => void update(item.id, "read")}>
                    Mark read
                  </Button>
                )}
                {item.source !== "brain" && item.status !== "acknowledged" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void update(item.id, "acknowledged")}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Acknowledge
                  </Button>
                )}
                {item.source !== "brain" && item.status !== "dismissed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Dismiss ${item.title}`}
                    onClick={() => void update(item.id, "dismissed")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </section>
      {!loading && visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {visible.length} notifications · Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
