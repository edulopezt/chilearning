# SENCE RCE mock (local)

Fake **SENCE "Registro de Asistencia E-Learning" (RCE)** server. It exists so the SENCE
engine (task 0.7) and its integration suite can run **with no internet and without ever
touching the real SENCE**. Every behaviour here is derived, literally, from the frozen
contract [`src/modules/sence/README.md`](../../src/modules/sence/README.md) (invariants
I-1…I-16, transitions T1…T9, error table §5) and the protocol spec
[`docs/sence/SPEC_INTEGRACION_SENCE.md`](../../docs/sence/SPEC_INTEGRACION_SENCE.md)
(manual v1.1.6).

> **Safety rail:** this mock only ever serves the `rcetest` environment. Requests to the
> production routes `/rce/Registro/…` are **refused with HTTP 403** — the mock never
> simulates production, because real SENCE attendance cannot be deleted (manual §5).

---

## 1. Run it

Zero dependencies — just `node:http`. Node ≥ 24 strips TypeScript types natively, so the
single file runs as-is:

```bash
node tools/sence-mock/server.ts
# → [sence-mock] listening on http://127.0.0.1:4010 (rcetest only — production is refused)
```

The orchestrator registers this as the **`pnpm sence:mock`** script (this agent does **not**
edit `package.json`). The intended entry is:

```jsonc
// package.json → "scripts"
"sence:mock": "node tools/sence-mock/server.ts"
```

> Running the raw `.ts` prints a one-time `MODULE_TYPELESS_PACKAGE_JSON` performance warning
> because the repo root has no `"type": "module"`. It is harmless. The Docker image sets
> `"type": "module"` locally so CI stays quiet. If you prefer silence in dev without touching
> the root `package.json`, run with `node --no-warnings tools/sence-mock/server.ts`.

### Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4010` | Listen port. |
| `SENCE_MOCK_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker). |
| `SENCE_MOCK_QUIET` | *(unset)* | `1` silences the request/callback log lines. |
| `SENCE_MOCK_RUT_OTEC` | `76543210-3` | RUT of the *valid* test OTEC (fictitious). |
| `SENCE_MOCK_TOKEN` | a GUID-shaped 36-char value | Expected OTEC token. Never logged. |

### Docker (CI)

```bash
docker build -f tools/sence-mock/Dockerfile -t sence-mock .
docker run --rm -p 4010:4010 sence-mock
curl http://127.0.0.1:4010/_mock/health
```

### Quick check

```bash
curl http://127.0.0.1:4010/_mock/health
curl -X POST http://127.0.0.1:4010/rcetest/Registro/IniciarSesion \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'RutOtec=76543210-3&Token=00000000-0000-4000-8000-000000000000&CodSence=1234567890&CodigoCurso=ACC-0001&LineaCapacitacion=3&RunAlumno=5126663-3&IdSesionAlumno=demo-1&UrlRetoma=http://127.0.0.1:3000/api/sence/cb&UrlError=http://127.0.0.1:3000/api/sence/cb'
```

---

## 2. How it behaves like the real protocol

SENCE **does not expose a request/response API**. It receives an
`application/x-www-form-urlencoded` form POST (from the student's browser) and later
**POSTs a callback** to your `UrlRetoma` / `UrlError`. This mock reproduces exactly that:

- The **protocol endpoints reply to the caller with an HTML page** (what a browser would
  see), never with JSON.
- The **result is delivered as a separate form POST callback** to `UrlRetoma`/`UrlError`.

### Why server-to-server callbacks (design choice)

The mock posts the callback **itself, server-to-server**, instead of returning a browser
auto-submit form. Rationale: the integration suite has no browser, and a deterministic
`fetch` from the mock to the engine's `/api/sence/cb` removes all timing ambiguity. Delays,
replays and "no callback at all" are then modelled as plain scheduling decisions the mock
makes — see the scenario table below. Tests wait for delayed callbacks deterministically via
`GET /_mock/idle` (blocks until every scheduled callback has been posted).

The four protocol callbacks are emitted with **exactly the field sets of the manual**
(spec §5a–5d):

| Callback | Fields | `IdSesionSence` | `GlosaError` |
|---|---|---|---|
| start OK (5a) | CodSence, CodigoCurso, IdSesionAlumno, **IdSesionSence**, RunAlumno, FechaHora, ZonaHoraria, LineaCapacitacion | present | absent |
| start error (5b) | same 8 + **GlosaError** | present *(may be empty — I-4/T3)* | present |
| close OK (5c) | CodSence, CodigoCurso, IdSesionAlumno, RunAlumno, FechaHora, ZonaHoraria, LineaCapacitacion | **absent** | absent |
| close error (5d) | same 7 + **GlosaError** | **absent** | present |

`FechaHora` is `aaaa-mm-dd hh:mm:ss` (Chile time). For **close OK** it defaults to the
session's **open** time, reproducing the manual's literal T5 description (`close FechaHora ==
open FechaHora`, flagged as a probable errata in contract §3 T5 — resolved against real SENCE
in checklist 0.9); override it per scenario with `respond.fechaHora`, or fall back to the
current time when the session is untracked. `ZonaHoraria` can be omitted via a quirk (observed
in production, spec §5.2). The **OTEC Token never appears** in any callback, log, stored
dispatch record or control response (I-6/I-7).

---

## 3. Forcing scenarios

Scenarios are forced through the **control endpoint `/_mock/scenario`** — never through magic
values inside protocol fields. This is deliberate: the wire stays byte-identical to the real
protocol, so **no fake marker can ever be confused with, or persisted as, real data**.

Register a scenario with `POST /_mock/scenario`. It **matches** the next protocol request by
any subset of fields and **responds** with the callback you describe. By default a scenario
fires **once** (`"times"` controls this; `"always"` = unlimited). Scenarios are consulted in
registration order and **short-circuit validation** — that is the whole point of forcing.

### Request shape

```jsonc
POST /_mock/scenario
{
  "match": {                    // all keys optional; omitted = match anything
    "endpoint":       "start" | "close",
    "runAlumno":      "5126663-3",
    "idSesionAlumno": "corr-0001",
    "idSesionSence":  "MOCK-…",
    "codSence":       "1234567890",
    "codigoCurso":    "ACC-0001"
  },
  "respond": {
    "kind":        "start_ok" | "close_ok" | "error" | "none",  // optional; inferred if absent
    "glosaError":  "211;204",        // raw GlosaError string; or use "errorCodes"
    "errorCodes":  ["211", "204"],   // convenience array → joined with ";"
    "delayMs":     0,                // schedule the callback this many ms later (late callback)
    "repeat":      1,                // post the SAME callback this many times (replay/duplicate)
    "idSesionSence": "…",            // force the issued/echoed IdSesionSence
    "fechaHora":   "2026-07-14 10:00:00",
    "zonaHoraria": "America/Santiago",
    "quirks": {
      "omitZonaHoraria": false,           // drop ZonaHoraria (spec §5.2)
      "trailingSpaceFieldNames": false    // emit "LineaCapacitacion " etc. (Anexo 3 errata)
    }
  },
  "times": 1        // 1 (default) | N | "always"
}
```

If `kind` is omitted it is inferred: `error` when `glosaError`/`errorCodes` is present,
otherwise `start_ok` for `/IniciarSesion` and `close_ok` for `/CerrarSesion`.

### Concrete examples

Successful open, callback echoed immediately (equivalent to sending no scenario at all):

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"idSesionAlumno":"corr-0001"},"respond":{"kind":"start_ok"}}'
```

Any error code, single or multi-code (the `;` list of I-5), on start **or** close:

```bash
# multi-code start error, IdSesionSence arrives EMPTY (pre-session error, I-4/T3)
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"runAlumno":"5126663-3"},"respond":{"glosaError":"211;204"}}'

# single close error 313
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"endpoint":"close"},"respond":{"errorCodes":["313"]}}'
```

Late callback (answered to the browser now, posted back 2 s later):

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"idSesionAlumno":"corr-late"},"respond":{"kind":"start_ok","delayMs":2000}}'
```

Replay / duplicate (same callback posted twice — exercises idempotency I-3):

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"idSesionAlumno":"corr-replay"},"respond":{"kind":"start_ok","repeat":2}}'
```

**Clave Única abandonment — NO callback at all** (contract T4):

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"idSesionAlumno":"corr-none"},"respond":{"kind":"none"}}'
```

Successful close (no `GlosaError`, **no** `IdSesionSence` — that is the real shape, T5):

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"match":{"endpoint":"close"},"respond":{"kind":"close_ok"}}'
```

### Deprecated codes are refused

Codes **100** and **210** exist only in manual v1.1.3 and were removed in v1.1.5/v1.1.6.
The contract (§5) forbids this mock from emitting them, so forcing either returns **400**:

```bash
curl -X POST http://127.0.0.1:4010/_mock/scenario -H 'content-type: application/json' \
  -d '{"respond":{"glosaError":"210"}}'
# → 400 { "error": "error code 210 is DEPRECATED …" }
```

Unknown codes (outside the table) are **allowed on purpose** — they exercise the engine's
mandatory fallback for codes SENCE may add without notice (I-9).

---

## 4. Built-in validation (no scenario active)

Without a matching scenario the mock validates like the real RCE and emits the first error
code the real service would answer with. Configure the "valid" OTEC via `PUT /_mock/config`.

| Situation | Code |
|---|---|
| Mandatory param missing / blank / only spaces | 200 |
| `UrlRetoma`/`UrlError` missing | 201 |
| `UrlRetoma` malformed or > 100 chars | 202 |
| `UrlError` malformed or > 100 chars | 203 |
| `CodSence` not 10 digits (and not `-1`, and not line 1) | 204 |
| `CodigoCurso` < 7 chars (except line 6 / FPT) or > 50, and not `-1` | 205 |
| `LineaCapacitacion` ∉ {1,3,6} | 206 |
| `RunAlumno` bad format / bad check digit | 207 |
| `RunAlumno` not in the authorized roster (if one is configured) | 208 |
| `RutOtec` bad format / bad check digit | 209 |
| Token doesn't belong to the OTEC (`RutOtec` mismatch, or wrong token) | 211 |
| Token not current (`tokenState: "revocado"`) | 212 |
| Token wrong length (≠ 36) | 303 |
| `CerrarSesion` with an `IdSesionSence` the mock never issued (strict mode) | 304 |

Notes:
- **`-1` wildcard** in `CodSence`/`CodigoCurso` is accepted (rcetest disables code checks,
  I-8). On **line 1** `CodSence` must be **empty** (not `-1`) and `CodigoCurso` uses the SIC
  format; `-1` goes only in `CodigoCurso`.
- URL validation runs **first**: with no usable `UrlError` there is nowhere to post a
  failure, so the mock replies 400 to the browser and posts **no** callback (mirrors reality).
- If `UrlError` is valid but `UrlRetoma` is malformed (202), the error callback still goes to
  `UrlError`, as the real service does.

### Configure the valid OTEC / roster

```bash
# make the mock consider a specific RUT/token valid, mark the token revoked (→212),
# restrict the authorized roster (→208 for anyone else)
curl -X PUT http://127.0.0.1:4010/_mock/config -H 'content-type: application/json' -d '{
  "rutOtec": "76543210-3",
  "token": "00000000-0000-4000-8000-000000000000",
  "tokenState": "vigente",
  "authorizedRuns": ["5126663-3", "11111111-1"],
  "strictCloseSession": true
}'
```

`GET /_mock/config` echoes the config with the **token redacted** — it is never returned.

---

## 5. Inspection & control endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/_mock/health` | GET | Liveness + counters (`environment: "rcetest"`). |
| `/_mock/config` | GET / PUT / POST | Read (token redacted) / set the valid OTEC, roster, token state. |
| `/_mock/scenario` | POST / GET / DELETE | Register / list / clear forced scenarios. |
| `/_mock/callbacks` | GET | Every dispatched callback record (Token-free) — assert on the wire. |
| `/_mock/sessions` | GET | Sessions the mock opened (by `IdSesionSence`). |
| `/_mock/idle` | GET | Blocks until all scheduled (delayed) callbacks have been posted. `?timeoutMs=`. |
| `/_mock/reset` | POST | Clear scenarios, dispatches, sessions; restore default config. |

Protocol endpoints (POST, `application/x-www-form-urlencoded`, **`rcetest` only**):

- `POST /rcetest/Registro/IniciarSesion`
- `POST /rcetest/Registro/CerrarSesion`
- `POST /rce/Registro/{IniciarSesion,CerrarSesion}` → **403 refused** (never simulates prod).

Paths are matched case-insensitively, so the manual's `…/Registro/IniciarSesion` casing works.

---

## 6. F0 gate cases this mock reproduces

Maps to the gate table in the contract §8. Each row is directly forceable with the
mechanisms above.

| # | Gate case | How to reproduce | Invariants / transitions |
|---|---|---|---|
| 1 | Successful open | POST `IniciarSesion` (valid data) → start-OK callback with generated `IdSesionSence` | T1, T2, I-1, I-4, I-10, I-11 |
| 2 | Every error code, single & multi (`;`) | scenario `{"respond":{"glosaError":"<code>"}}` for 200–212 (no 210) and 300–313, plus `"211;204"`, on start **and** close | T3, T7, I-4, I-5, I-9 |
| 3 | Successful close | POST `CerrarSesion` with a valid `IdSesionSence` → close-OK callback (no `IdSesionSence`, no `GlosaError`) | T5, I-4 |
| 4 | Late callback | scenario `{"respond":{"delayMs": N}}` → callback posted after the browser reply; wait with `/_mock/idle` | I-1, I-15 |
| 5 | Replay / duplicate | scenario `{"respond":{"repeat":2}}` → same callback posted twice | I-1, I-2, I-3 |
| 6 | Clave Única abandonment (no callback) | scenario `{"respond":{"kind":"none"}}` → nothing is ever posted back | T4 |
| 7 | Pre-flight rejects | send bad RUN DV (→207), URL > 100 (→202/203), `CodigoCurso` < 7 (→205); `-1` accepted in `rcetest` | I-8 |
| 8 | Wildcard `-1` | `CodSence=-1` & `CodigoCurso=-1` accepted → start OK (rcetest only) | I-8, I-11 |
| 9 | Line 1 empty `CodSence` | `LineaCapacitacion=1`, `CodSence=""`, SIC-format `CodigoCurso` → start OK | I-10 |
| 10 | Empty `IdSesionSence` on start error | scenario `{"respond":{"glosaError":"211;204"}}` → error callback with `IdSesionSence=""` (engine classifies `start_error` by session state) | I-4, T3 |
| 11 | Production refused | POST `/rce/Registro/IniciarSesion` → 403, never a callback | safety rail (manual §5, I-11) |
| 12 | Token never leaks | inspect `/_mock/callbacks` and logs — Token is absent everywhere | I-6, I-7 |
| 13 | Field quirks | scenario quirks `omitZonaHoraria` / `trailingSpaceFieldNames` (defensive parsing) | spec §5.2 |

Cases 6, 8, and 9 correspond to the T4 / candado / exento rows of the contract that live on
the **engine** side; the mock supplies the SENCE-side behaviour each needs.

---

## 7. Scope / non-goals

- **Test double only.** No persistence, no auth, no TLS — it is thrown away between runs.
- **No per-test isolation key.** All state (`config`, `scenarios`, `dispatches`, `sessions`) is
  a single process-global on one port. Vitest runs test files in **parallel** by default, so a
  `times:"always"` scenario or a `PUT /_mock/config` (token/roster/tokenState) from one test
  would leak into another that shares the instance. Run the task-0.7 integration suite **either
  serially, or with one mock instance per worker** (unique `PORT`), and call `POST /_mock/reset`
  in `beforeEach`. The mock offers `/_mock/reset` and a `PORT` override for exactly this; it does
  not namespace state per caller.
- **`rcetest` semantics only.** A green run here never certifies a production config
  (rcetest disables code verification — spec §3.1).
- Fictitious data throughout (`76543210-3`, `5126663-3`, `11111111-1`). No real personal
  data ever belongs here.
- The verbatim official error glosas and their es-CL translations are **not** duplicated in
  this tool: they live in `src/modules/sence/errors.ts` + `src/i18n/es-CL.ts` (single source,
  I-9). The mock only transmits **codes**, exactly as the protocol's `GlosaError` field does.
