import "server-only";

/**
 * Punto de entrada SERVER-ONLY de `buildZip` (task 3.12). La implementación
 * vive en `zip-core.ts` (SIN `server-only`, task 5.13) porque el worker de
 * exportación (`tenant-export-runner.ts`) también arma ZIPs y corre fuera de
 * Next. Este archivo existe para que los llamadores server-only actuales
 * (`expediente-service.ts`) no cambien su import ni su comportamiento.
 */
export { buildZip } from "./zip-core";
