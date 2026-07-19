"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";

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

      <Tabs value={mode} onValueChange={(value) => switchMode(value as Mode)}>
        <TabsList className="w-full">
          <TabsTab value="password" className="flex-1">
            {esCL.auth.passwordTab}
          </TabsTab>
          <TabsTab value="magic" className="flex-1">
            {esCL.auth.magicLinkTab}
          </TabsTab>
        </TabsList>

        <TabsPanel value="password" className="mt-4">
          {sent ? null : (
            <form onSubmit={onPassword} className="flex flex-col gap-4">
              <FieldRoot invalid={!!error}>
                <FieldLabel>{esCL.auth.emailLabel}</FieldLabel>
                <FieldControl
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FieldRoot>
              <FieldRoot invalid={!!error}>
                <FieldLabel>{esCL.auth.passwordLabel}</FieldLabel>
                <FieldControl
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FieldRoot>
              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" loading={pending}>
                {pending ? esCL.auth.signingIn : esCL.auth.submit}
              </Button>
            </form>
          )}
        </TabsPanel>

        <TabsPanel value="magic" className="mt-4">
          {sent ? (
            <Alert variant="success" role="status">
              <AlertDescription>{esCL.auth.magicLinkSent}</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={onMagicLink} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{esCL.auth.magicLinkIntro}</p>
              <FieldRoot invalid={!!error}>
                <FieldLabel>{esCL.auth.emailLabel}</FieldLabel>
                <FieldControl
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FieldRoot>
              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" loading={pending}>
                {pending ? esCL.auth.magicLinkSending : esCL.auth.magicLinkSubmit}
              </Button>
            </form>
          )}
        </TabsPanel>
      </Tabs>
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
