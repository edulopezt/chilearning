import "server-only";

/**
 * Página HTML es-CL para el alumno cuando `/api/sence/start|close` no puede
 * continuar (I-9: nunca JSON crudo ni texto técnico al alumno; H4-R-012). El botón
 * del curso hace un submit NATIVO, así que la respuesta se RENDERIZA en el
 * navegador — debe ser una página legible, no un objeto JSON. Sin datos técnicos
 * ni PII; solo el mensaje traducido y un enlace de vuelta al curso.
 */
export function renderMessagePage(opts: {
  title: string;
  body: string;
  backHref: string;
  backLabel: string;
}): string {
  const { title, body, backHref, backLabel } = opts;
  return `<!doctype html>
<html lang="es-CL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5;">
  <h1 style="font-size: 1.25rem;">${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  <p><a href="${escapeHtml(backHref)}" style="display:inline-block; margin-top:1rem; font-weight:600;">${escapeHtml(backLabel)} →</a></p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
