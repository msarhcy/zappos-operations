import { describe, expect, it } from "vitest";
import {
  buildCustomerTimeline,
  getCustomerVisibleDocuments,
  isProofAccessible,
  isShipmentShareLinkActive,
  isTrackingVisible,
  mapJobStatusToCustomerStatus,
} from "@/lib/customer-portal";

describe("phase 13 customer portal safety helpers", () => {
  it("maps internal job statuses to deterministic customer-safe statuses", () => {
    expect(mapJobStatusToCustomerStatus("completed")).toBe("delivered");
    expect(mapJobStatusToCustomerStatus("failed")).toBe("exception");
    expect(mapJobStatusToCustomerStatus("cancelled")).toBe("cancelled");
    expect(mapJobStatusToCustomerStatus("accepted")).toBe("assigned");
  });

  it("keeps customer timelines privacy-safe and deterministic", () => {
    const timeline = buildCustomerTimeline({
      jobStatus: "completed",
      proofAvailable: true,
      scheduledAt: "2026-01-01T10:00:00.000Z",
      startedAt: "2026-01-01T11:00:00.000Z",
      completedAt: "2026-01-01T12:00:00.000Z",
      events: [
        {
          event_type: "job_scheduled",
          message: "Shipment scheduled",
          created_at: "2026-01-01T10:01:00.000Z",
        },
        {
          event_type: "driver_dispatch",
          message: "Dispatcher assigned vehicle",
          created_at: "2026-01-01T10:02:00.000Z",
        },
      ],
    });

    expect(timeline[0]?.title).toBe("Scheduled");
    expect(timeline.some((entry) => entry.title.includes("Dispatcher"))).toBe(false);
    expect(timeline.some((entry) => entry.title === "Proof available")).toBe(true);
  });

  it("filters documents to the customer-visible set only", () => {
    const docs = [
      { id: "1", visibility: "customer_visible" },
      { id: "2", visibility: "internal" },
      { id: "3", visibility: "restricted" },
    ];
    expect(getCustomerVisibleDocuments(docs as Array<{ id: string; visibility: string }>)).toEqual([
      { id: "1", visibility: "customer_visible" },
    ]);
  });

  it("disables tracking for completed jobs and when visibility is off", () => {
    expect(isTrackingVisible({ jobStatus: "completed", visibility: "exact" })).toBe(false);
    expect(isTrackingVisible({ jobStatus: "in_progress", visibility: "disabled" })).toBe(false);
    expect(isTrackingVisible({ jobStatus: "in_progress", visibility: "approximate" })).toBe(true);
  });

  it("only allows proof access for finalized customer-visible proof", () => {
    expect(
      isProofAccessible({
        jobStatus: "completed",
        proofVisible: true,
        proofFinalized: true,
      }),
    ).toBe(true);
    expect(
      isProofAccessible({
        jobStatus: "in_progress",
        proofVisible: true,
        proofFinalized: true,
      }),
    ).toBe(false);
    expect(
      isProofAccessible({
        jobStatus: "completed",
        proofVisible: false,
        proofFinalized: true,
      }),
    ).toBe(false);
  });

  it("rejects expired or revoked share links", () => {
    expect(
      isShipmentShareLinkActive({
        status: "active",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxViews: 3,
        viewCount: 1,
      }),
    ).toBe(true);

    expect(
      isShipmentShareLinkActive({
        status: "revoked",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxViews: 3,
        viewCount: 1,
      }),
    ).toBe(false);

    expect(
      isShipmentShareLinkActive({
        status: "active",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        maxViews: 3,
        viewCount: 1,
      }),
    ).toBe(false);

    expect(
      isShipmentShareLinkActive({
        status: "active",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxViews: 2,
        viewCount: 2,
      }),
    ).toBe(false);
  });
});
