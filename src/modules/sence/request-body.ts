import "server-only";

import type { NextRequest } from "next/server";

/** Lee el body de una request como objeto, aceptando JSON o form-urlencoded. */
export async function readRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : "";
      return out;
    }
    const json = await request.json();
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
