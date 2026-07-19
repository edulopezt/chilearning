"use client";

// "use client" — JUSTIFICACIÓN: scorm-again necesita instalar
// `window.API`/`window.API_1484_11` ANTES de que el iframe cargue (el SCO los
// busca al inicializar subiendo por `window.parent`) y escuchar eventos de
// commit del SCO durante todo el ciclo de vida de la pestaña (autosave,
// `pagehide`) — eso exige el DOM/ventana real del navegador, imposible de
// modelar en un Server Component.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Scorm12API, Scorm2004API } from "scorm-again";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import { createSaveQueue } from "@/modules/contenido/domain/scorm-save-queue";

const DEBOUNCE_MS = 2000;
const AUTOSAVE_MS = 30_000;

type ScormApiInstance = Scorm12API | Scorm2004API;
type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ScormPlayerProps {
  readonly lessonId: string;
  readonly packageId: string;
  readonly scormVersion: "1.2" | "2004";
  readonly entryHref: string;
  readonly initialCmi: Record<string, unknown>;
}

/** Cada segmento del entryHref se codifica por separado: la ruta puede traer
 *  espacios/acentos (frecuente en la salida de Storyline/Rise) y no debe
 *  romper el "/" que separa carpetas. */
function buildAssetSrc(packageId: string, entryHref: string): string {
  const segments = entryHref.split("/").map((segment) => encodeURIComponent(segment));
  return `/api/scorm/${encodeURIComponent(packageId)}/${segments.join("/")}`;
}

export function ScormPlayer({ lessonId, packageId, scormVersion, entryHref, initialCmi }: ScormPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ScormApiInstance | null>(null);
  // Serializa los envíos no-beacon (corrección 4-ojos MED "correctitud-cmi"):
  // el commit del SCO, el heartbeat de 30 s y el finish/terminate disparan el
  // mismo flush de forma independiente entre sí; sin esto, dos POST
  // concurrentes pueden resolver fuera de orden en la red y el `upsert` del
  // servidor (sin comparación de versión) deja ganar al ÚLTIMO EN LLEGAR, no
  // al más reciente — ver `scorm-save-queue.ts`.
  const saveQueueRef = useRef(createSaveQueue());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const iframeSrc = useMemo(() => buildAssetSrc(packageId, entryHref), [packageId, entryHref]);
  const cmiEndpoint = `/api/scorm/cmi/${lessonId}`;

  // Ref con la función de envío ACTUAL ("latest ref"): se reasigna en un
  // efecto (NUNCA durante el render, `react-hooks/refs`) para cerrar sobre el
  // `cmiEndpoint` vigente, pero la identidad de `sendNowRef` es estable —
  // permite el reintento coalescido (llamarse a sí misma al terminar) sin la
  // auto-referencia dentro del mismo `useCallback` que
  // `react-hooks/immutability` rechaza.
  const sendNowRef = useRef<() => void>(() => {});
  useEffect(() => {
    sendNowRef.current = () => {
      const api = apiRef.current;
      if (!api) {
        saveQueueRef.current.finish();
        return;
      }
      const body = JSON.stringify({ cmi: api.renderCMIToJSONObject() });
      setStatus("saving");
      fetch(cmiEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`scorm cmi POST → ${res.status}`);
          setStatus("saved");
          setSavedAt(Date.now());
        })
        .catch(() => setStatus("error"))
        .finally(() => {
          // Único envío en curso a la vez (corrección 4-ojos MED): si terminó
          // con un pendiente coalescido en la cola, reenvía de inmediato.
          if (saveQueueRef.current.finish() === "retry") sendNowRef.current();
        });
    };
  }, [cmiEndpoint]);

  /** Envía el estado CMI actual. `useBeacon`: flush final en descarga de página (no espera respuesta). */
  const flush = useCallback(
    (useBeacon: boolean) => {
      const api = apiRef.current;
      if (!api) return;

      if (useBeacon) {
        const body = JSON.stringify({ cmi: api.renderCMIToJSONObject() });
        // sendBeacon solo acepta ciertos tipos de body; un Blob con
        // content-type json hace que el navegador mande el header correcto
        // sin depender de que el listener de la página siga vivo.
        const sent =
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon(cmiEndpoint, new Blob([body], { type: "application/json" }));
        if (!sent) {
          // sendBeacon ausente o el payload superó la cuota del navegador
          // (frecuente con `suspend_data` grande, cerca del tope de 256 KB):
          // el retorno de sendBeacon se ignoraba antes, perdiendo el guardado
          // final en silencio. Mejor esfuerzo con keepalive — no garantiza
          // completar antes del unload, pero es preferible a no intentarlo.
          fetch(cmiEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
        }
        return;
      }

      if (saveQueueRef.current.request() === "queued") return;
      sendNowRef.current();
    },
    [cmiEndpoint],
  );

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let autosaveTimer: ReturnType<typeof setInterval> | undefined;
    const win = window as unknown as Record<string, ScormApiInstance | undefined>;
    const globalKey = scormVersion === "1.2" ? "API" : "API_1484_11";

    function scheduleSave(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => flush(false), DEBOUNCE_MS);
    }

    async function setup(): Promise<void> {
      const { Scorm12API, Scorm2004API } = await import("scorm-again");
      if (cancelled) return;

      // `autocommit: false` — el debounce/autosave/beacon de este componente
      // maneja el timing del guardado; el commit periódico propio de
      // scorm-again quedaría desalineado con el contrato de nuestro endpoint.
      const api: ScormApiInstance =
        scormVersion === "1.2" ? new Scorm12API({ autocommit: false }) : new Scorm2004API({ autocommit: false });
      apiRef.current = api;

      if (Object.keys(initialCmi).length > 0) {
        try {
          api.loadFromJSON(initialCmi);
        } catch {
          // Estado inicial corrupto/incompatible: el SCO arranca limpio en
          // vez de tumbar el reproductor completo.
        }
      }

      const commitEvent = scormVersion === "1.2" ? "LMSCommit" : "Commit";
      const finishEvent = scormVersion === "1.2" ? "LMSFinish" : "Terminate";
      api.on(commitEvent, scheduleSave);
      api.on(finishEvent, () => flush(false));

      win[globalKey] = api;
      // Red de seguridad (30 s): por si el SCO nunca dispara un Commit
      // explícito (paquetes mal integrados no son infrecuentes).
      autosaveTimer = setInterval(() => flush(false), AUTOSAVE_MS);
    }

    void setup();

    const handlePageHide = (): void => flush(true);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (autosaveTimer) clearInterval(autosaveTimer);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      delete win[globalKey];
      apiRef.current = null;
    };
    // `flush`/`initialCmi` se capturan intencionalmente solo al montar: el
    // reproductor vive UNA vez por lección (la key de la ruta cambia si
    // cambia `lessonId`), no debe reinstalarse la API SCORM en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scormVersion, packageId]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <SaveIndicator status={status} savedAt={savedAt} onRetry={() => flush(false)} />
        <button
          type="button"
          onClick={toggleFullscreen}
          className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
        >
          {esCL.scorm.fullscreen}
        </button>
      </div>
      {/* min-w-0 (NO min-w-[360px], que forzaba un ancho fijo más ancho que
          el contenedor con padding y producía scroll horizontal a 360 px —
          corrección 4-ojos MED): permite encogerse dentro del flex-item
          padre sin desbordar (RNF-6); la altura usa dvh para comportarse
          bien en móvil con barras de navegador dinámicas. */}
      <div ref={containerRef} className="min-w-0 overflow-hidden rounded-md border bg-black">
        <iframe
          src={iframeSrc}
          title={esCL.scorm.playerTitle}
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="h-[70dvh] w-full border-0"
        />
      </div>
    </div>
  );
}

function SaveIndicator({
  status,
  savedAt,
  onRetry,
}: {
  status: SaveStatus;
  savedAt: number | null;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-warning">
        <span>{esCL.scorm.saveError}</span>
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={onRetry}>
          {esCL.scorm.retrySave}
        </Button>
      </div>
    );
  }
  if (status === "saving") return <span className="text-muted-foreground">{esCL.scorm.saving}</span>;
  if (status === "saved" && savedAt !== null) {
    return (
      <span className="text-success">
        {esCL.scorm.saved}{" "}
        {new Date(savedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return <span aria-hidden="true">&nbsp;</span>;
}
