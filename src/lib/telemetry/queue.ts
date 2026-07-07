import type { QueuedTelemetryPoint, QueueState, TelemetryPoint } from "./types";

const DB_NAME = "zappos-telemetry";
const DB_VERSION = 1;
const STORE = "points";

function openTelemetryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "telemetry_point_id" });
        store.createIndex("session_state_sequence", [
          "tracking_session_id",
          "queue_state",
          "sequence_number",
        ]);
        store.createIndex("queue_state", "queue_state");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openTelemetryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = callback(store);
    let result: T | undefined;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function enqueueTelemetryPoint(point: TelemetryPoint) {
  const queued: QueuedTelemetryPoint = {
    ...point,
    queue_state: "pending",
    attempts: 0,
    queued_at: new Date().toISOString(),
    last_attempt_at: null,
    last_error: null,
  };
  await withStore("readwrite", (store) => store.put(queued));
}

export async function getPendingTelemetryPoints(
  trackingSessionId?: string,
  limit = 30,
): Promise<QueuedTelemetryPoint[]> {
  const db = await openTelemetryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const request = store.openCursor();
    const points: QueuedTelemetryPoint[] = [];
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || points.length >= limit) return;
      const value = cursor.value as QueuedTelemetryPoint;
      if (
        value.queue_state !== "acknowledged" &&
        value.queue_state !== "batched" &&
        (!trackingSessionId || value.tracking_session_id === trackingSessionId)
      ) {
        points.push(value);
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve(points.sort((a, b) => a.sequence_number - b.sequence_number).slice(0, limit));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function updateTelemetryQueueState(
  ids: string[],
  state: QueueState,
  error: string | null = null,
) {
  const db = await openTelemetryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const value = request.result as QueuedTelemetryPoint | undefined;
        if (!value) return;
        value.queue_state = state;
        value.last_attempt_at = new Date().toISOString();
        value.last_error = error;
        if (state === "failed" || state === "batched") value.attempts += 1;
        store.put(value);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function acknowledgeTelemetryPoints(ids: string[]) {
  const db = await openTelemetryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getTelemetryQueueStats() {
  const points = await getPendingTelemetryPoints(undefined, Number.MAX_SAFE_INTEGER);
  return {
    pending: points.filter((point) => point.queue_state === "pending").length,
    failed: points.filter((point) => point.queue_state === "failed").length,
    total: points.length,
  };
}
