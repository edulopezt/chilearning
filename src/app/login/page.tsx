"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "magic" ? esCL.auth.magicLinkExpired : null,
  );
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.status === 400 ? esCL.auth.invalidCredentials : esCL.auth.genericError);
      setPending(false);
      return;
    }
    const next = params.get("next") ?? "/dashboard";
    router.replace(next);
    router.refresh();
  }

  async function onMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const next = params.get("next") ?? "/dashboard";
    // El origin del navegador es el público real → el enlace del correo apunta
    // al callback correcto aunque haya proxy.
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect },
    });
    setPending(false);
    if (otpError) {
      setError(esCL.auth.magicLinkError);
      return;
    }
    setSent(true);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSent(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">{esCL.auth.loginTitle}</h1>

      <div className="flex gap-1 rounded-md border p-1 text-sm" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => switchMode("password")}
          className={`min-h-9 flex-1 rounded ${mode === "password" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}
        >
          {esCL.auth.passwordTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "magic"}
          onClick={() => switchMode("magic")}
          className={`min-h-9 flex-1 rounded ${mode === "magic" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}
        >
          {esCL.auth.magicLinkTab}
        </button>
      </div>

      {sent ? (
        <p
          role="status"
          className="rounded-md border border-green-600/40 bg-green-50 p-4 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300"
        >
          {esCL.auth.magicLinkSent}
        </p>
      ) : mode === "password" ? (
        <form onSubmit={onPassword} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {esCL.auth.emailLabel}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 rounded-md border px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {esCL.auth.passwordLabel}
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-11 rounded-md border px-3 text-base"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {pending ? esCL.auth.signingIn : esCL.auth.submit}
          </button>
        </form>
      ) : (
        <form onSubmit={onMagicLink} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{esCL.auth.magicLinkIntro}</p>
          <label className="flex flex-col gap-1 text-sm">
            {esCL.auth.emailLabel}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 rounded-md border px-3 text-base"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {pending ? esCL.auth.magicLinkSending : esCL.auth.magicLinkSubmit}
          </button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
