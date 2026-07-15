/**
 * Plantillas de correos transaccionales (task 1.6, HU-3.3). Puras, sin IO.
 * HTML con estilos en línea (lo que exigen los clientes de correo) y la marca
 * del tenant. TODO contenido de usuario se escapa (anti-inyección).
 * Textos en español de Chile.
 */

export interface EmailBrand {
  orgName: string;
  primaryColor: string; // #rrggbb (ya validado aguas arriba)
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escapa para insertar texto de usuario dentro de HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_HEX = /^#[0-9a-fA-F]{6}$/;

function shell(brand: EmailBrand, bodyHtml: string): string {
  const color = SAFE_HEX.test(brand.primaryColor) ? brand.primaryColor : "#1e3a8a";
  const org = escapeHtml(brand.orgName);
  return `<!doctype html><html lang="es-CL"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${color};color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold;">${org}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;color:#71717a;font-size:12px;">
Este es un correo automático de ${org} en Chilearning. Si no esperabas este mensaje, puedes ignorarlo.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(color: string, href: string, label: string): string {
  const c = SAFE_HEX.test(color) ? color : "#1e3a8a";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-radius:6px;background:${c};">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/** Invitación a unirse a la OTEC (con enlace de acceso). */
export function renderInvitationEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  acceptUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName);
  const org = escapeHtml(params.brand.orgName);
  const subject = `Te invitaron a ${params.brand.orgName} en Chilearning`;
  const body = `<p>Hola ${name},</p>
<p><strong>${org}</strong> te invitó a su plataforma de capacitación en Chilearning.</p>
<p>Para activar tu cuenta y empezar, haz clic en el botón:</p>
${button(params.brand.primaryColor, params.acceptUrl, "Activar mi cuenta")}
<p style="color:#71717a;font-size:13px;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${escapeHtml(params.acceptUrl)}</p>`;
  const text = `Hola ${params.recipientName},\n\n${params.brand.orgName} te invitó a su plataforma de capacitación en Chilearning.\n\nActiva tu cuenta aquí:\n${params.acceptUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/** Bienvenida al alumno, con la guía para registrar asistencia con Clave Única. */
export function renderWelcomeEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  courseName: string;
  courseUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName);
  const org = escapeHtml(params.brand.orgName);
  const course = escapeHtml(params.courseName);
  const subject = `Bienvenido/a a ${params.courseName}`;
  const body = `<p>Hola ${name},</p>
<p>¡Te damos la bienvenida al curso <strong>${course}</strong> de ${org}!</p>
${button(params.brand.primaryColor, params.courseUrl, "Ir a mi curso")}
<h3 style="font-size:15px;margin:24px 0 8px;">Cómo registrar tu asistencia SENCE con Clave Única</h3>
<p style="margin:0 0 8px;">Para que tu participación quede validada ante SENCE, debes registrar tu asistencia con tu <strong>Clave Única</strong>:</p>
<ol style="margin:0 0 8px;padding-left:20px;">
<li>Entra al curso y pulsa <strong>"Registrar asistencia SENCE"</strong>.</li>
<li>Se abrirá el sitio de <strong>Clave Única</strong> del Estado. Ingresa tu RUN y tu Clave Única.</li>
<li>Al volver, tu asistencia quedará registrada y podrás ver el contenido.</li>
<li>Debes registrar tu asistencia <strong>cada vez</strong> que retomes el curso.</li>
</ol>
<p style="color:#71717a;font-size:13px;">¿No tienes Clave Única? Actívala gratis en <a href="https://claveunica.gob.cl">claveunica.gob.cl</a>.</p>`;
  const text = `Hola ${params.recipientName},\n\nBienvenido/a al curso ${params.courseName} de ${params.brand.orgName}.\n\nIr a mi curso: ${params.courseUrl}\n\nCómo registrar tu asistencia SENCE con Clave Única:\n1. Entra al curso y pulsa "Registrar asistencia SENCE".\n2. Ingresa tu RUN y tu Clave Única en el sitio del Estado.\n3. Al volver, tu asistencia queda registrada.\n4. Repite cada vez que retomes el curso.\n\n¿No tienes Clave Única? Actívala en https://claveunica.gob.cl\n`;
  return { subject, html: shell(params.brand, body), text };
}
