"use client";

import { useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { revokeCertificateAction } from "./actions";

const t = esCL.certificates;

/** Revocación con motivo obligatorio (confirmación inline). */
export function RevokeForm({ certificateId, actionId }: { certificateId: string; actionId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-sm text-red-600 underline">
        {t.revoke}
      </button>
    );
  }
  return (
    <form action={revokeCertificateAction} className="flex flex-col gap-2">
      <input type="hidden" name="certificateId" value={certificateId} />
      <input type="hidden" name="actionId" value={actionId} />
      <input name="reason" required placeholder={t.revokeReasonLabel} className="input text-sm" />
      <button type="submit" className="min-h-11 rounded-md bg-red-600 px-3 text-sm font-medium text-white">
        {t.revokeConfirm}
      </button>
    </form>
  );
}
