"use client";

import { useRouter } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function onSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onSignOut}
      className="min-h-11 rounded-md border px-4 text-sm font-medium"
    >
      {esCL.auth.signOut}
    </button>
  );
}
