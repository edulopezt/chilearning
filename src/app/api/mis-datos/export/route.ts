import { NextResponse } from "next/server";

import { getPrincipal } from "@/modules/core/auth/session";
import { exportMyData } from "@/modules/core/privacy-service";

/** Export del titular en JSON legible por máquina (task 3.5, HU-2.4: acceso +
 *  portabilidad). Solo los datos del propio usuario (auditado). */
export async function GET(): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const bundle = await exportMyData(principal);
  if (!bundle) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="mis-datos-${principal.userId}.json"`,
      "cache-control": "no-store",
    },
  });
}
