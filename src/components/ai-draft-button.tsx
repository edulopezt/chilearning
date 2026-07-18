"use client";

import { useRef, useState } from "react";

import { esCL } from "@/i18n/es-CL";

const t = esCL.communication;

export type DraftActionResult = { readonly ok: true; readonly draft: string } | { readonly ok: false; readonly error: string };

/**
 * Textarea de respuesta (staff) + botón "Generar borrador con IA" (task 5.9,
 * HU-9.5). Reemplaza el `<textarea name="body">` plano de la página server
 * SOLO cuando el proveedor de IA está configurado (la página decide eso ANTES
 * de montar este componente — si no hay proveedor, la página sigue
 * renderizando el `<textarea>` plano y este archivo ni se importa en el DOM).
 *
 * El textarea es NO CONTROLADO (ref, no `useState`): así el `name="body"` se
 * preserva intacto y el `<form action={...}>` existente sigue funcionando sin
 * ningún cambio — rellenar el borrador es solo `ref.current.value = ...`. El
 * relator SIEMPRE puede seguir editando el texto antes de enviar
 * (human-in-the-loop, RNF-10: nada sale al alumno sin pasar por acá).
 */
export function AiDraftButton({
  threadId,
  generateDraft,
  placeholder,
  rows = 3,
}: {
  readonly threadId: string;
  readonly generateDraft: (threadId: string) => Promise<DraftActionResult>;
  readonly placeholder: string;
  readonly rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick(): Promise<void> {
    setLoading(true);
    setError(false);
    try {
      const result = await generateDraft(threadId);
      if (result.ok) {
        if (textareaRef.current) textareaRef.current.value = result.draft;
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <textarea ref={textareaRef} name="body" required rows={rows} placeholder={placeholder} className="input" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={loading}
          className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60"
        >
          {loading ? t.aiDraftLoading : t.aiDraftButton}
        </button>
        {error && <span className="text-xs text-red-600">{t.aiDraftError}</span>}
      </div>
    </>
  );
}
