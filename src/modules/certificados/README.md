# Módulo certificados

Certificados verificables: emisión, QR público, revocación, y **vigencia +
recertificación** (task 5.12, HU-7.3).

Lógica de dominio pura (sin IO) en `domain/`.

## Vigencia y recertificación (HU-7.3)

- `courses.validity_months` (null = no vence) → `certificates.expires_at`.
- ⚠ `expires_at` es una COLUMNA y vive **fuera del `snapshot`** a propósito: el
  snapshot es el documento legal congelado e INMUTABLE (D-112, trigger
  `certificates_status_guard`) y la vigencia es metadato OPERATIVO (a quién
  avisar y cuándo). Dentro del snapshot, corregirla sería imposible sin tocar un
  documento inmutable — y cambiaría el PDF, que es función determinista de él.
- `expiry-alerts.ts` corre en el WORKER: sin `server-only`, imports RELATIVOS y
  deps inyectadas (patrón `comunicacion/reminders.ts`). Su idempotencia es el
  ledger `certificate_expiry_alerts` (unique `certificate_id, offset_days`),
  escrito ANTES de notificar (ledger-first).
- Regla anti-ráfaga: al entrar tarde a la ventana se avisa SOLO el offset menor
  pendiente y los mayores se marcan como enviados sin notificar (`dueOffset` +
  `offsetsToMark`). Un certificado YA vencido no genera aviso, pero SÍ aparece en
  el listado del coordinador (ahí es lo más urgente).
- A n8n va solo el agregado seudonimizado por (tenant, curso, offset) — RNF-10.
  El correo con PII lo manda el worker por `EmailSender`, honrando el opt-out.
