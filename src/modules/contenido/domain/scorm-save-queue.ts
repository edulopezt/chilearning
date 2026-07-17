/**
 * Serialización PURA (sin IO) de los envíos de autosave del reproductor
 * SCORM (corrección 4-ojos MED "correctitud-cmi", task 5.1b).
 *
 * El commit del SCO (debounce 2 s), el heartbeat (30 s) y el evento de
 * finish/terminate disparan el mismo `flush(false)` de forma independiente
 * entre sí — sin coordinación, dos `fetch` concurrentes hacia el endpoint CMI
 * pueden resolver en CUALQUIER orden en la red, y el `upsert` del servidor
 * (sin comparación de versión) deja ganar al ÚLTIMO POST EN LLEGAR, no al más
 * reciente en generarse: un estado más viejo puede pisar uno más nuevo
 * (incluida una transición a completado ya guardada).
 *
 * Esta máquina de estados garantiza que, como máximo, un envío esté en curso
 * a la vez: una solicitud mientras otro ya está en curso se "coalesce" en un
 * único reintento pendiente (nunca se apilan varios) que se dispara apenas
 * termina el envío en curso — así el servidor nunca recibe dos POST en
 * paralelo y no hay reordenamiento de red posible entre ellos.
 */

export type SaveQueueRequestResult = "start" | "queued";
export type SaveQueueFinishResult = "retry" | "idle";

export interface SaveQueue {
  /** Solicita un envío. "start" = enviar ya; "queued" = ya hay uno en curso, se coalesció. */
  request(): SaveQueueRequestResult;
  /** Marca terminado el envío en curso. "retry" = había un pendiente, reenviar YA (sigue "en curso"). */
  finish(): SaveQueueFinishResult;
}

export function createSaveQueue(): SaveQueue {
  let sending = false;
  let pending = false;

  return {
    request(): SaveQueueRequestResult {
      if (!sending) {
        sending = true;
        return "start";
      }
      pending = true;
      return "queued";
    },
    finish(): SaveQueueFinishResult {
      if (pending) {
        pending = false;
        return "retry";
      }
      sending = false;
      return "idle";
    },
  };
}
