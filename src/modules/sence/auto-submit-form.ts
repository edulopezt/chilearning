import "server-only";

/**
 * Renderiza una página HTML con un form oculto que se auto-envía por POST hacia
 * SENCE (así funciona el protocolo RCE real: el navegador del alumno hace el
 * POST). Los valores se escapan para HTML. El token viaja en el form hacia
 * SENCE (I-7) — este HTML no se registra en logs.
 */
export function renderAutoSubmitForm(endpoint: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n    ");

  return `<!doctype html>
<html lang="es-CL">
<head><meta charset="utf-8"><title>Redirigiendo a SENCE…</title></head>
<body>
  <p>Redirigiendo a SENCE para registrar tu asistencia…</p>
  <form id="sence" method="POST" action="${escapeHtml(endpoint)}">
    ${inputs}
    <noscript><button type="submit">Continuar a SENCE</button></noscript>
  </form>
  <script>document.getElementById('sence').submit();</script>
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
