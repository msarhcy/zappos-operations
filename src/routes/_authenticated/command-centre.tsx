/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  HeartPulse,
  Search,
  ShieldAlert,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
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
import {
  fleetHealth,
  filterCommandTimeline,
  mergeCommandTimeline,
  type CommandTimelineItem,
} from "@/lib/command-centre";

export const Route = createFileRoute("/_authenticated/command-centre")({
  component: CommandCentre,
});
const active = ["assigned", "accepted", "in_progress", "arrived"];
type WatchTone = "available" | "in-use" | "warning" | "danger" | "critical" | "neutral";
interface GlobalResult {
  id: string;
  label: string;
  detail: string;
  path: "/operations" | "/vehicles" | "/drivers" | "/customers" | "/hardware-readiness" | "/route-intelligence";
}

function watchStatus(status: string): { label: string; tone: WatchTone } {
  const label = status.replaceAll("_", " ");
  if (["available", "active", "completed", "tracked"].includes(status))
    return { label, tone: "available" };
  if (["assigned", "accepted", "in_progress", "arrived", "in_use", "on_trip"].includes(status))
    return { label, tone: "in-use" };
  if (["maintenance", "degraded", "unprovisioned"].includes(status))
    return { label, tone: "warning" };
  if (["failed", "suspended", "out_of_service", "blocked"].includes(status))
    return { label, tone: "danger" };
  return { label, tone: "neutral" };
}

function priorityTone(priority: string): WatchTone {
  if (priority === "critical") return "critical";
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  return "neutral";
}
function highlight(value: string, query: string) {
  const at = value.toLowerCase().indexOf(query.toLowerCase());
  if (!query || at < 0) return value;
  return (
    <>
      {value.slice(0, at)}
      <mark>{value.slice(at, at + query.length)}</mark>
      {value.slice(at + query.length)}
    </>
  );
}

function CommandCentre() {
  const { activeCompany, hasAnyRole } = useCompany();
  const { user } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<any>({
    jobs: [],
    vehicles: [],
    drivers: [],
    incidents: [],
    maintenance: [],
    alerts: [],
    events: [],
    requests: [],
    customers: [],
    devices: [],
    routes: [],
    notifications: [],
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [widgetOrder, setWidgetOrder] = useState<string[]>([
    "health",
    "notifications",
    "watchlist",
    "timeline",
    "evidence",
    "analytics",
  ]);
  const [widgetSizes, setWidgetSizes] = useState<Record<string, "compact" | "wide">>({});
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [notificationSearch, setNotificationSearch] = useState("");
  const [selectedSearch, setSelectedSearch] = useState(0);
  const allowed = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  useEffect(() => {
    if (!activeCompany || !allowed || !user) return;
    void (async () => {
      setLoading(true);
      const c = activeCompany.id;
      const [
        jobs,
        vehicles,
        drivers,
        incidents,
        maintenance,
        alerts,
        events,
        requests,
        notifications,
        layout,
        watchlist,
        customers,
        devices,
        routes,
      ] = await Promise.all([
        supabase
          .from("jobs")
          .select("id,reference,status,updated_at,driver_id,vehicle_id")
          .eq("company_id", c)
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("vehicles")
          .select("id,registration,status,updated_at")
          .eq("company_id", c)
          .limit(100),
        supabase
          .from("drivers")
          .select("id,full_name,status,updated_at")
          .eq("company_id", c)
          .limit(100),
        supabase
          .from("incidents")
          .select("id,description,severity,status,created_at")
          .eq("company_id", c)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("maintenance")
          .select("id,title,status,scheduled_date,created_at")
          .eq("company_id", c)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("operational_alerts")
          .select("id,alert_type,status,escalation_level,created_at")
          .eq("company_id", c)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("job_events")
          .select("id,event_type,message,created_at")
          .eq("company_id", c)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("customer_service_requests")
          .select("id,subject,status,priority,created_at")
          .eq("company_id", c)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("command_centre_notifications")
          .select("*")
          .eq("company_id", c)
          .eq("user_id", user.id)
          .neq("status", "dismissed")
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("command_centre_layouts")
          .select("collapsed_widgets,widget_order,widget_sizes")
          .eq("company_id", c)
          .eq("user_id", user.id)
          .maybeSingle(),
        (supabase as any)
          .from("command_centre_watchlists")
          .select("id,entity_type,entity_id,position,created_at")
          .eq("company_id", c)
          .eq("user_id", user.id)
          .order("position")
          .limit(100),
        supabase.from("customers").select("id,name,updated_at").eq("company_id", c).limit(100),
        (supabase as any)
          .from("devices")
          .select("id,serial_number,status,last_seen_at,updated_at")
          .eq("company_id", c)
          .limit(100),
        (supabase as any)
          .from("route_segment_baselines")
          .select("id,route_key,updated_at")
          .eq("company_id", c)
          .limit(100),
      ]);
      setData({
        jobs: jobs.data ?? [],
        vehicles: vehicles.data ?? [],
        drivers: drivers.data ?? [],
        incidents: incidents.data ?? [],
        maintenance: maintenance.data ?? [],
        alerts: alerts.data ?? [],
        events: events.data ?? [],
        requests: requests.data ?? [],
        notifications: notifications.data ?? [],
        customers: customers.data ?? [],
        devices: devices.data ?? [],
        routes: routes.data ?? [],
      });
      setCollapsed(layout.data?.collapsed_widgets ?? []);
      setWidgetSizes(layout.data?.widget_sizes ?? {});
      setWidgetOrder(
        layout.data?.widget_order?.length
          ? layout.data.widget_order
          : ["health", "notifications", "watchlist", "timeline", "evidence", "analytics"],
      );
      setWatchlists(watchlist.data ?? []);
      setLoading(false);
    })();
  }, [activeCompany?.id, allowed, user?.id]);
  const health = fleetHealth({
    openIncidents: data.incidents.filter((x: any) => x.status !== "resolved").length,
    criticalIncidents: data.incidents.filter(
      (x: any) => x.status !== "resolved" && x.severity === "critical",
    ).length,
    maintenanceDue: data.maintenance.filter((x: any) => x.status !== "completed").length,
    poorTelemetry: 0,
    unavailableDrivers: data.drivers.filter((x: any) => x.status !== "available").length,
    openAlerts: data.alerts.filter((x: any) => x.status !== "resolved").length,
  });
  const timeline = useMemo(
    () =>
      mergeCommandTimeline(
        data.events.map((x: any) => ({
          id: x.id,
          source: "dispatch",
          title: x.message || x.event_type,
          timestamp: x.created_at,
          priority: "low",
        })),
        data.incidents.map((x: any) => ({
          id: x.id,
          source: "incident",
          title: x.description,
          timestamp: x.created_at,
          priority: x.severity,
        })),
        data.maintenance.map((x: any) => ({
          id: x.id,
          source: "maintenance",
          title: x.title,
          timestamp: x.created_at,
          priority: "medium",
        })),
        data.requests.map((x: any) => ({
          id: x.id,
          source: "customer",
          title: x.subject,
          timestamp: x.created_at,
          priority: x.priority,
        })),
      ),
    [data],
  );
  const visibleTimeline = filterCommandTimeline(timeline, search, source);
  const globalResults: GlobalResult[] = [
    ...data.jobs.map((x: any) => ({ id: `job-${x.id}`, label: x.reference, detail: "Job", path: "/operations" as const })),
    ...data.vehicles.map((x: any) => ({ id: `vehicle-${x.id}`, label: x.registration, detail: "Vehicle", path: "/vehicles" as const })),
    ...data.drivers.map((x: any) => ({ id: `driver-${x.id}`, label: x.full_name, detail: "Driver", path: "/drivers" as const })),
    ...data.customers.map((x: any) => ({ id: `customer-${x.id}`, label: x.name, detail: "Customer", path: "/customers" as const })),
    ...data.devices.map((x: any) => ({ id: `device-${x.id}`, label: x.serial_number, detail: "Device", path: "/hardware-readiness" as const })),
    ...data.routes.map((x: any) => ({ id: `route-${x.id}`, label: x.route_key, detail: "Route", path: "/route-intelligence" as const })),
    ...data.requests.map((x: any) => ({ id: `request-${x.id}`, label: x.subject, detail: "Customer request", path: "/customers" as const })),
  ]
    .filter((x) => `${x.label} ${x.detail}`.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12);
  const openSearchResult = (result: GlobalResult | undefined) => {
    if (!result) return;
    setSearch("");
    void navigate({ to: result.path });
  };
  if (!allowed)
    return (
      <div className="p-6">
        <Card className="p-6">
          Command Centre access is restricted to operations roles. Drivers cannot access this
          workspace.
        </Card>
      </div>
    );
  const toggle = (name: string) =>
    setCollapsed((current) => {
      const next = current.includes(name) ? current.filter((x) => x !== name) : [...current, name];
      void (supabase as any).from("command_centre_layouts").upsert({
        user_id: user?.id,
        company_id: activeCompany?.id,
        collapsed_widgets: next,
        widget_order: widgetOrder,
        widget_sizes: widgetSizes,
      });
      return next;
    });
  const moveWidget = (name: string, direction: number) => {
    const index = widgetOrder.indexOf(name);
    const target = index + direction;
    if (target < 0 || target >= widgetOrder.length) return;
    const next = [...widgetOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setWidgetOrder(next);
    void (supabase as any).from("command_centre_layouts").upsert({
      user_id: user?.id,
      company_id: activeCompany?.id,
      widget_order: next,
      collapsed_widgets: collapsed,
      widget_sizes: widgetSizes,
    });
  };
  const addWatch = async (entity_type: string, entity_id: string) => {
    if (!user || !activeCompany) return;
    const { data: inserted, error } = await (supabase as any)
      .from("command_centre_watchlists")
      .insert({
        user_id: user.id,
        company_id: activeCompany.id,
        entity_type,
        entity_id,
        position: watchlists.length,
      })
      .select("id,entity_type,entity_id,position,created_at")
      .single();
    if (error || !inserted) return;
    setWatchlists((x) => [...x, inserted]);
  };
  const removeWatch = async (id: string) => {
    await (supabase as any).from("command_centre_watchlists").delete().eq("id", id);
    setWatchlists((x) => x.filter((item) => item.id !== id));
  };
  const reorderWatch = async (id: string, direction: number) => {
    const index = watchlists.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= watchlists.length) return;
    const next = [...watchlists];
    [next[index], next[target]] = [next[target], next[index]];
    const positioned = next.map((item, position) => ({ ...item, position }));
    setWatchlists(positioned);
    await Promise.all(
      positioned.map((item) =>
        (supabase as any)
          .from("command_centre_watchlists")
          .update({ position: item.position })
          .eq("id", item.id),
      ),
    );
  };
  const watchEntity = (item: any) => {
    const rows: Record<string, any[]> = {
      vehicle: data.vehicles,
      driver: data.drivers,
      customer: data.customers,
      device: data.devices,
      route: data.routes,
      job: data.jobs,
    };
    const row = rows[item.entity_type]?.find((candidate) => candidate.id === item.entity_id);
    const label =
      row?.registration ??
      row?.full_name ??
      row?.name ??
      row?.serial_number ??
      row?.route_key ??
      row?.reference ??
      item.entity_id;
    const status = row?.status ?? (item.entity_type === "route" ? "tracked" : "unknown");
    const activity = row?.last_seen_at ?? row?.updated_at ?? item.created_at;
    const paths: Record<string, string> = {
      vehicle: "/vehicles",
      driver: "/drivers",
      customer: "/customers",
      device: "/hardware-readiness",
      route: "/route-intelligence",
      job: "/operations",
    };
    return { label, status, activity, path: paths[item.entity_type] };
  };
  const notificationRows = data.notifications
    .filter(
      (item: any) =>
        (notificationFilter === "all" ||
          item.source === notificationFilter ||
          item.status === notificationFilter) &&
        `${item.title} ${item.source}`.toLowerCase().includes(notificationSearch.toLowerCase()),
    )
    .slice(0, 25);
  const updateNotification = async (id: string, status: string) => {
    await (supabase as any)
      .from("command_centre_notifications")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    setData((current: any) => ({
      ...current,
      notifications: current.notifications.map((item: any) =>
        item.id === id ? { ...item, status } : item,
      ),
    }));
  };
  const widget = (name: string, title: string, children: React.ReactNode) => (
    <Card
      className={`min-w-0 p-4 ${widgetSizes[name] === "wide" ? "lg:col-span-2" : ""}`}
      style={{ order: widgetOrder.indexOf(name) }}
    >
      <div className="flex justify-between">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${title} up`}
            onClick={() => moveWidget(name, -1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${title} down`}
            onClick={() => moveWidget(name, 1)}
          >
            ↓
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggle(name)}>
            {collapsed.includes(name) ? "Expand" : "Collapse"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Resize ${title}`}
            onClick={() => {
              const next: Record<string, "compact" | "wide"> = {
                ...widgetSizes,
                [name]: widgetSizes[name] === "wide" ? "compact" : "wide",
              };
              setWidgetSizes(next);
              void (supabase as any).from("command_centre_layouts").upsert({
                user_id: user?.id,
                company_id: activeCompany?.id,
                collapsed_widgets: collapsed,
                widget_order: widgetOrder,
                widget_sizes: next,
              });
            }}
          >
            ↔
          </Button>
        </div>
      </div>
      {!collapsed.includes(name) && <div className="mt-3">{children}</div>}
    </Card>
  );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 lg:p-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Operations workspace
        </p>
        <h1 className="text-3xl font-semibold">Fleet Command Centre</h1>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          role="combobox"
          aria-expanded={Boolean(search)}
          aria-controls="command-centre-search-results"
          aria-activedescendant={
            search ? `command-centre-result-${globalResults[selectedSearch]?.id}` : undefined
          }
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedSearch(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedSearch((value) =>
                Math.min(value + 1, Math.max(0, globalResults.length - 1)),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedSearch((value) => Math.max(value - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              openSearchResult(globalResults[selectedSearch]);
            }
            if (event.key === "Escape") setSearch("");
          }}
          placeholder="Search accessible vehicles, drivers, customers, jobs, devices and routes"
        />
        {search && (
          <Card id="command-centre-search-results" role="listbox" className="absolute z-10 mt-1 w-full p-2">
            {loading ? (
              <p className="p-2 text-sm text-muted-foreground">Searching accessible records…</p>
            ) : globalResults.length ? (
              globalResults.map((result, index) => (
                <button
                  type="button"
                  id={`command-centre-result-${result.id}`}
                  role="option"
                  aria-selected={index === selectedSearch}
                  key={result.id}
                  className={`block w-full rounded p-2 text-left text-sm ${index === selectedSearch ? "bg-muted" : ""}`}
                  onMouseEnter={() => setSelectedSearch(index)}
                  onClick={() => openSearchResult(result)}
                >
                  <span className="mr-2 text-xs text-muted-foreground">{result.detail}</span>
                  {highlight(result.label, search)}
                </button>
              ))
            ) : (
              <p className="p-2 text-sm text-muted-foreground">
                No accessible operational results.
              </p>
            )}
          </Card>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          [
            "Fleet online",
            data.vehicles.filter((x: any) => x.status !== "out_of_service").length,
            Truck,
          ],
          ["Jobs active", data.jobs.filter((x: any) => active.includes(x.status)).length, Truck],
          [
            "Drivers available",
            data.drivers.filter((x: any) => x.status === "available").length,
            Users,
          ],
          [
            "Open incidents",
            data.incidents.filter((x: any) => x.status !== "resolved").length,
            ShieldAlert,
          ],
          [
            "Maintenance due",
            data.maintenance.filter((x: any) => x.status !== "completed").length,
            Wrench,
          ],
          [
            "Open alerts",
            data.alerts.filter((x: any) => x.status !== "resolved").length,
            AlertTriangle,
          ],
          ["Requests", data.requests.filter((x: any) => x.status !== "closed").length, Bell],
        ].map(([label, value, Icon]: any) => (
          <Card key={label} className="p-3">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <p className="mt-2 text-xl font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {widget(
          "health",
          "Fleet health",
          <div className="flex items-center gap-3">
            <HeartPulse className="h-8 w-8" />
            <div>
              <p className="text-2xl font-semibold">{health.score}/100</p>
              <p className="capitalize text-muted-foreground">
                {health.level} — deterministic current-state score
              </p>
            </div>
          </div>,
        )}
        {widget(
          "notifications",
          "Notifications",
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={notificationSearch}
                onChange={(e) => setNotificationSearch(e.target.value)}
                placeholder="Search notifications"
              />
              <Select value={notificationFilter} onValueChange={setNotificationFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="incident">Incidents</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="field">Field</SelectItem>
                  <SelectItem value="hardware">Hardware</SelectItem>
                  <SelectItem value="brain">Brain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {notificationRows.map((x: any) => (
              <div key={x.id} className="rounded border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <b>{x.title}</b>
                  <StatusBadge tone={priorityTone(x.priority)}>{x.priority}</StatusBadge>
                  <StatusBadge tone={x.status === "unread" ? "warning" : "neutral"}>
                    {x.status}
                  </StatusBadge>
                  <span className="capitalize text-muted-foreground">{x.source}</span>
                </div>
                <div className="mt-2 flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void updateNotification(x.id, "read")}
                  >
                    Read
                  </Button>
                  {x.source !== "brain" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void updateNotification(x.id, "acknowledged")}
                      >
                        Acknowledge
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void updateNotification(x.id, "dismissed")}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {data.notifications.length === 0 && (
              <p className="text-sm text-muted-foreground">No notifications.</p>
            )}
          </div>,
        )}
        {widget(
          "watchlist",
          "Watchlists",
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["vehicle", data.vehicles],
                ["driver", data.drivers],
                ["customer", data.customers],
                ["device", data.devices],
                ["route", data.routes],
                ["job", data.jobs],
              ].map(([type, rows]: any) => (
                <Select key={type} onValueChange={(id) => void addWatch(type, id)}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Pin ${type}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {rows.slice(0, 50).map((row: any) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.registration ??
                          row.full_name ??
                          row.name ??
                          row.serial_number ??
                          row.route_key ??
                          row.reference}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
            {["vehicle", "driver", "customer", "route", "device", "job"].map((type) => (
              <div key={type}>
                <p className="text-xs font-medium uppercase text-muted-foreground">{type}s</p>
                {watchlists
                  .filter((item) => item.entity_type === type)
                  .map((item) => (
                    <div
                      className="mt-1 flex items-center justify-between rounded border p-2 text-sm"
                      key={item.id}
                    >
                      <div className="min-w-0">
                        <a className="font-medium underline" href={watchEntity(item).path}>
                          {watchEntity(item).label}
                        </a>
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="capitalize">{watchEntity(item).status}</span> · Last
                          activity {new Date(watchEntity(item).activity).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${watchEntity(item).label} up`}
                          onClick={() => void reorderWatch(item.id, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${watchEntity(item).label} down`}
                          onClick={() => void reorderWatch(item.id, 1)}
                        >
                          ↓
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void removeWatch(item.id)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>,
        )}
        {widget(
          "timeline",
          "Cross-system timeline",
          <>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="dispatch">Dispatch</SelectItem>
                <SelectItem value="incident">Incidents</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
            <div className="mt-3 max-h-96 space-y-2 overflow-auto">
              {visibleTimeline.map((x: CommandTimelineItem) => (
                <div key={`${x.source}-${x.id}`} className="rounded border p-2 text-sm">
                  <b>{x.source}</b> · {x.title}
                  <span className="float-right text-xs text-muted-foreground">
                    {new Date(x.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </>,
        )}
        {widget(
          "evidence",
          "Evidence workspace",
          <p className="text-sm text-muted-foreground">
            Read-only evidence is available from the existing Documents, Proof of Delivery,
            Incidents and Field Deployment screens. Storage paths are never shown here.
          </p>,
        )}
        {widget(
          "analytics",
          "Operational analytics",
          <div className="grid grid-cols-3 gap-3 text-sm">
            <p>Jobs today: {data.jobs.filter((x: any) => x.status === "completed").length}</p>
            <p>Incidents: {data.incidents.length}</p>
            <p>Customer requests: {data.requests.length}</p>
          </div>,
        )}
      </div>
    </main>
  );
}
