import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function getEnvValue(env: unknown, key: string) {
  if (env && typeof env === "object" && key in env) {
    const value = (env as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return typeof process !== "undefined" ? process.env?.[key] : undefined;
}

async function handleTomTomFlowProxy(request: Request, env: unknown) {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ unavailableReason: "Invalid coordinates" }, { status: 400 });
  }

  const apiKey = getEnvValue(env, "TOMTOM_API_KEY");
  if (!apiKey) {
    return Response.json({
      unavailableReason: "TOMTOM_API_KEY is not configured",
      retrievedAt: new Date().toISOString(),
    });
  }

  const providerUrl = new URL(
    "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json",
  );
  providerUrl.searchParams.set("point", `${latitude},${longitude}`);
  providerUrl.searchParams.set("unit", "KMPH");
  providerUrl.searchParams.set("key", apiKey);

  const response = await fetch(providerUrl);
  if (!response.ok) {
    return Response.json(
      { unavailableReason: `TomTom returned ${response.status}` },
      { status: 502 },
    );
  }
  const payload = await response.json();
  return Response.json({ ...payload, retrievedAt: new Date().toISOString() });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/providers/tomtom-flow") {
        return await handleTomTomFlowProxy(request, env);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
