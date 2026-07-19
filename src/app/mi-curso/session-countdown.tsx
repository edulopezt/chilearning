"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Contador regresivo de la sesión SENCE (I-13, 3 h). La hora inicial la provee
 * el servidor (`serverNowMs`) para no llamar a `Date.now()` durante el render;
 * el estado solo se actualiza dentro del callback del interval. Al llegar a 0
 * recarga para reflejar el re-bloqueo.
 */
export function SessionCountdown({
  expiresAtMs,
  serverNowMs,
  label,
  expiredLabel,
}: {
  expiresAtMs: number;
  serverNowMs: number;
  label: string;
  expiredLabel: string;
}) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(serverNowMs);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, expiresAtMs - nowMs);

  useEffect(() => {
    if (remaining === 0) router.refresh();
  }, [remaining, router]);

  if (remaining === 0) {
    return <p className="text-sm text-warning">{expiredLabel}</p>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");

  return (
    <p className="text-sm">
      {label}:{" "}
      <span className="font-mono font-medium tabular-nums" aria-live="polite">
        {h}:{m}:{s}
      </span>
    </p>
  );
}
