"use client";

// "use client" — JUSTIFICACIÓN: consume el stream SSE propio de
// `/api/tutor/chat` incrementalmente (fetch + ReadableStream reader) y
// mantiene el estado de la conversación en vivo mientras el alumno escribe —
// imposible de modelar en un Server Component.
import { useRef, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { deriveToHumanAction } from "./actions";

interface Citation {
  readonly lessonId: string;
  readonly lessonTitle: string;
}

interface ChatMessageState {
  readonly role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  pending?: boolean;
}

type DeriveStatus = "idle" | "sending" | "sent" | "error";

const t = esCL.tutorIA;

function translateError(code: string | undefined): string {
  if (!code) return t.errors.generic;
  return (t.errors as Record<string, string>)[code] ?? t.errors.generic;
}

export function TutorChat({ courseName }: { courseName: string }) {
  const [messages, setMessages] = useState<ChatMessageState[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [deriveStatus, setDeriveStatus] = useState<DeriveStatus>("idle");
  const [deriveError, setDeriveError] = useState<string | undefined>(undefined);
  const lastQuestionRef = useRef<string>("");

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const question = input.trim();
    if (question.length === 0 || sending) return;

    lastQuestionRef.current = question;
    setDeriveStatus("idle");
    setErrorBanner(null);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setSending(true);

    let res: Response;
    try {
      res = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
    } catch {
      setErrorBanner(translateError("upstream_error"));
      setSending(false);
      return;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrorBanner(translateError(body?.error));
      setSending(false);
      return;
    }

    if (!res.body) {
      setErrorBanner(translateError("upstream_error"));
      setSending(false);
      return;
    }

    setMessages((prev) => [...prev, { role: "assistant", text: "", pending: true }]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex = buffer.indexOf("\n\n");
      while (sepIndex !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        handleFrame(frame);
        sepIndex = buffer.indexOf("\n\n");
      }
    }

    setSending(false);
  }

  function handleFrame(frame: string): void {
    const line = frame.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice("data:".length).trim();
    if (payload.length === 0) return;

    let parsed: { type?: string; text?: string; citations?: Citation[]; error?: string } | null = null;
    try {
      parsed = JSON.parse(payload) as { type?: string; text?: string; citations?: Citation[]; error?: string };
    } catch {
      return;
    }
    if (!parsed) return;

    if (parsed.type === "delta" && typeof parsed.text === "string") {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, text: last.text + parsed!.text };
        }
        return next;
      });
    } else if (parsed.type === "final") {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, citations: parsed!.citations ?? [], pending: false };
        }
        return next;
      });
    } else if (parsed.type === "error") {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") next[next.length - 1] = { ...last, pending: false };
        return next;
      });
      setErrorBanner(translateError(parsed.error));
    }
  }

  async function handleDerive(): Promise<void> {
    const question = lastQuestionRef.current;
    if (!question) return;
    setDeriveStatus("sending");
    setDeriveError(undefined);
    const result = await deriveToHumanAction(question);
    if (result.ok) {
      setDeriveStatus("sent");
    } else {
      // Antes solo se miraba `result.ok` y siempre se pintaba el genérico —
      // `no_question` (con su propio string ya declarado en es-CL.ts) nunca
      // se leía (hallazgo de revisión de spec-compliance, 2026-07-18).
      setDeriveError(result.error);
      setDeriveStatus("error");
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{courseName}</p>
      {/* Banner PERMANENTE (no descartable), RNF-10/HU-11.1. */}
      <Alert variant="warning" className="text-xs">
        <AlertDescription>{t.banner}</AlertDescription>
      </Alert>

      {errorBanner ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorBanner}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="flex min-w-0 flex-1 flex-col gap-3">
        {messages.map((m, i) => (
          <li
            key={i}
            className={cn(
              "min-w-0 max-w-full rounded-lg border p-3 text-sm break-words whitespace-pre-wrap sm:max-w-[85%]",
              m.role === "user" ? "self-end border-transparent bg-primary text-primary-foreground" : "self-start"
            )}
          >
            {m.text || (m.pending ? t.sending : "")}
            {m.citations && m.citations.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs opacity-80">
                <span className="font-medium">{t.citationsLabel}:</span>
                {m.citations.map((c) => (
                  <a key={c.lessonId} href={`/mi-curso#leccion-${c.lessonId}`} className="underline underline-offset-4">
                    {c.lessonTitle}
                  </a>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="flex min-w-0 flex-wrap gap-2">
        <label className="sr-only" htmlFor="tutor-question">
          {t.inputLabel}
        </label>
        <Textarea
          id="tutor-question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.inputPlaceholder}
          rows={2}
          className="min-w-0 flex-1"
        />
        <Button type="submit" loading={sending} disabled={input.trim().length === 0} className="shrink-0">
          {sending ? t.sending : t.send}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDerive}
          disabled={!lastQuestionRef.current}
          loading={deriveStatus === "sending"}
        >
          {t.deriveToHuman}
        </Button>
        {deriveStatus === "sent" ? (
          <span className="text-success">
            {t.deriveSent}{" "}
            <a href="/mi-curso/comunicacion" className="underline underline-offset-4">
              {t.deriveGoToInbox}
            </a>
          </span>
        ) : null}
        {deriveStatus === "error" ? (
          <span className="text-destructive">
            {deriveError === "no_question" ? t.deriveNoQuestion : t.deriveGenericError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
