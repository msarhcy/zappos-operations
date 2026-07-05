
# ZappOS — MVP Build Plan

ZappOS is a large product spec. To ship something stable and testable I'll build it in **4 phases**, each independently working and demoable. This response covers what I'll build, in what order, and where I need one decision from you before starting.

---

## One decision I need up front

**Theme:** The spec says "prioritize one polished theme over two incomplete themes." I'll build a **single polished dark operational theme** (like Linear / Datadog / control-room software) — high contrast, dense but readable, blue/teal accents, red/amber for attention states. If you want light-only or both, tell me now; otherwise I'll proceed with dark.

Everything else in the spec is clear — I'll follow it exactly.

---

## Phase 1 — Foundation (this build)

**Auth, tenancy, roles, onboarding, shell, design system.**

- Design system: dark ZappOS theme, tokens in `src/styles.css`, ZappOS wordmark, status badge system (available/in-use/maintenance/delayed/failed/critical/etc.), consistent buttons/cards/tables/forms/empty/loading/error/dialog primitives.
- Database schema (all core tables, RLS, GRANTs, `has_role` security-definer):
  - `profiles`, `companies`, `company_members` (multi-company membership), `user_roles` (per-company: admin, fleet_manager, dispatcher, driver, viewer)
  - `vehicles`, `drivers`, `customers`, `jobs`, `job_events` (activity timeline), `maintenance`, `incidents`, `documents` (company/vehicle/driver polymorphic), `notifications`
  - Enums: business_type, terminology, vehicle_type, vehicle_status, driver_status, job_status, job_priority, maintenance_type, maintenance_status, incident_type, incident_severity, incident_status, document_owner_type, notification_type
- Auth flows: sign up, sign in, forgot password, `/reset-password`, sign out. Google sign-in via Lovable managed OAuth + email/password (Cloud defaults). Onboarding wizard collects company name, business type, country, fleet size, terminology → creates company + admin membership.
- App shell: `_authenticated/` layout, desktop side nav (Dashboard / Operations / Dispatch / Vehicles / Drivers / Maintenance / Incidents / Documents / Customers / Notifications / Settings), mobile bottom nav that adapts to role. Role-gated routes. Terminology substitution helper (`useTerminology()` — Trips/Jobs/Deliveries/Loads/Orders).
- Storage buckets (private): `proof-of-completion`, `incident-photos`, `documents`, `maintenance-invoices`.
- PWA foundation: manifest, ZappOS icons, theme color, installable (no offline SW per PWA skill).
- Empty dashboard skeleton with Attention Required section.

**Deliverable:** you can register, onboard a company, sign in on desktop or phone, and see role-appropriate nav.

---

## Phase 2 — Operations core

- Vehicles: register + profile (overview / active job / recent jobs / maintenance / incidents / documents / activity).
- Drivers: register + profile, driver-specific mobile experience.
- Customers: lightweight CRUD + profile.
- Jobs/Operations: full CRUD, priority, status lifecycle, activity timeline (auto-emit `job_events`), search & filters.
- Dispatch workspace: desktop split view (unassigned / drivers / vehicles / active), Assign button + conflict detection ("driver already assigned", "vehicle in maintenance"), authorized override. Mobile card-based dispatch.
- Documents: CRUD, expiry classification (Valid / Expiring Soon / Expired), 30-day default threshold configurable per company.

## Phase 3 — Driver mobile + field workflows

- Driver home: current job, next job, primary action button that morphs by status (Accept → Start → Arrived → Complete).
- Proof of completion: camera capture, recipient name, signature pad, notes, GPS if permitted.
- Failed delivery flow.
- Incident reporting (mobile-first, camera-friendly).
- Maintenance CRUD + overdue calculation (date + odometer triggers), vehicle status auto-update on maintenance start/complete.

## Phase 4 — Cross-cutting & demo

- Live operations dashboard (counts + Attention Required feed pulling from delayed jobs / unaccepted / failed / critical incidents / overdue maintenance / expiring licences & docs). Each item deep-links.
- Notifications: in-app notification centre, unread badge, event emitters on assign/accept/start/complete/fail/incident/etc. Architecture ready for push/WhatsApp/SMS/email (typed channels, no provider integration).
- Realistic South African demo company seed (10 vehicles, 12 drivers, 5 customers, 20 jobs across all statuses, delayed trip, failed delivery, vehicle in maintenance, overdue maintenance, expiring driver licence, expiring vehicle doc, open critical incident, resolved incident). Callable "Load demo data" from settings.
- End-to-end workflow verification (the 19-step test in the spec).

---

## Technical notes (safe to skip)

- TanStack Start + Supabase, RLS everywhere, `has_role(user, company, role)` security-definer for policies to avoid recursion, all tenant tables carry `company_id` with policy `company_id IN (select company_id from company_members where user_id = auth.uid())`.
- Roles stored in `user_roles(user_id, company_id, role)` — never on profiles.
- Job status changes go through a server function that writes both the job row and a `job_events` row atomically.
- Dispatch conflict checks and role checks enforced in server functions, not just UI.
- Storage buckets private with per-company path prefixes and RLS policies on `storage.objects`.
- No AI, no GPS live tracking, no billing — deferred per spec.

---

## What I'll do right after you approve

Start **Phase 1** in a single build pass: migrations → auth pages → onboarding → app shell → design system → PWA manifest. I'll come back for Phase 2 confirmation before continuing so you can steer.

Reply "go" (dark theme, phased plan) or tell me what to change.
