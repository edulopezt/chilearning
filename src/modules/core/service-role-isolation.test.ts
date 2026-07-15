/**
 * Test de arquitectura: el cliente service-role (que BYPASSA RLS) solo puede
 * instanciarse dentro de tenant-guard.ts. Cualquier otro archivo que lea
 * SUPABASE_SERVICE_ROLE_KEY o cree un client con ella es una fuga potencial de
 * aislamiento entre tenants (regla dura del proyecto, CLAUDE.md).
 *
 * Deriva del hallazgo MEDIUM-3 de la revisión adversarial de la tarea 0.4.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ALLOWED = join("lib", "tenant-guard.ts");
// El worker de jobs (task 2.6) es la 2ª excepción SANCIONADA por la regla dura
// de CLAUDE.md ("service-role SOLO en worker y callbacks SENCE"): corre fuera
// de Next (no puede importar tenant-guard, que es `server-only`) y construye su
// propio client. Ruta ABSOLUTA exacta (revisión R-4: con endsWith, cualquier
// `src/**/worker/index.ts` futuro quedaba exento en silencio).
const ALLOWED_WORKER = join(SRC, "worker", "index.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("aislamiento del cliente service-role", () => {
  const files = walk(SRC).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("solo tenant-guard.ts referencia SUPABASE_SERVICE_ROLE_KEY", () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(ALLOWED) || f.endsWith(join("lib", "env.server.ts"))) return false;
      if (f === ALLOWED_WORKER) return false;
      return readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY");
    });
    expect(offenders, `Archivos que tocan la service-role key fuera de tenant-guard: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("ningún otro archivo llama a serverEnv() para crear un client service-role suelto", () => {
    // serverEnv() expone la service-role key; solo tenant-guard debería usarla.
    const offenders = files.filter((f) => {
      if (f.endsWith(ALLOWED)) return false;
      const src = readFileSync(f, "utf8");
      return src.includes("env.server") && src.includes("serverEnv");
    });
    expect(offenders, `Usan serverEnv() fuera de tenant-guard: ${offenders.join(", ")}`).toEqual([]);
  });
});
