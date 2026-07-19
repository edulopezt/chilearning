"use client";

import { useState, useTransition } from "react";

import { downloadSubmissionAction } from "./actions";

/** Pide la signed URL al servidor y abre la descarga (no expone la URL en HTML). */
export function DownloadLink({ submissionId, label }: { submissionId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const url = await downloadSubmissionAction(submissionId);
          if (url) window.open(url, "_blank", "noopener");
          else setError(true);
        })
      }
      className="text-sm underline underline-offset-4 disabled:opacity-60"
    >
      {error ? "—" : label}
    </button>
  );
}
