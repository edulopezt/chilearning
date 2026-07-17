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

/** Anuncio publicado en un curso/acción (task 3.4, HU-9.1). */
export function renderAnnouncementEmail(params: {
  brand: EmailBrand;
  title: string;
  body: string;
  courseUrl: string;
}): RenderedEmail {
  const subject = `📢 ${params.title}`;
  const body = `<p><strong>${escapeHtml(params.title)}</strong></p>
<p style="white-space:pre-wrap;">${escapeHtml(params.body)}</p>
${button(params.brand.primaryColor, params.courseUrl, "Ver en el curso")}`;
  const text = `${params.title}\n\n${params.body}\n\nVer en el curso: ${params.courseUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/** Recordatorio de asistencia/actividad (task 3.9, HU-5.9). PII solo aquí — al
 *  destinatario real; a n8n jamás. `kind` decide el mensaje. */
export function renderReminderEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  kind: "no_attendance" | "inactive";
  courseName: string;
  courseUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName || "");
  const course = escapeHtml(params.courseName);
  const isAttendance = params.kind === "no_attendance";
  const subject = isAttendance
    ? `Recuerda registrar tu asistencia SENCE — ${params.courseName}`
    : `Te echamos de menos en ${params.courseName}`;
  const lead = isAttendance
    ? `Aún no registras tu asistencia SENCE de hoy en <strong>${course}</strong>. Recuerda hacerlo con tu Clave Única para que tu participación quede validada.`
    : `Hace unos días que no ingresas a <strong>${course}</strong>. Retoma cuando puedas para no atrasarte.`;
  const body = `<p>Hola ${name},</p>
<p>${lead}</p>
${button(params.brand.primaryColor, params.courseUrl, isAttendance ? "Registrar asistencia" : "Retomar el curso")}
<p style="color:#71717a;font-size:13px;">¿No quieres recibir estos recordatorios? Puedes darte de baja desde tu perfil.</p>`;
  const text = `Hola ${params.recipientName},\n\n${isAttendance ? `Aún no registras tu asistencia SENCE de hoy en ${params.courseName}.` : `Hace días que no ingresas a ${params.courseName}.`}\n\n${params.courseUrl}\n\nPuedes darte de baja de los recordatorios desde tu perfil.\n`;
  return { subject, html: shell(params.brand, body), text };
}

/**
 * Aviso de recertificación: al certificado le quedan `daysLeft` días (task 5.12,
 * HU-7.3). PII solo aquí, al destinatario real; a n8n va el agregado sin PII.
 *
 * NO lleva el folio ni el RUN: el correo solo tiene que empujar al alumno a
 * entrar (minimización, Ley 21.719 — el dato está tras el login, no en la
 * bandeja). `daysLeft` es de calendario (lo calcula `daysUntil`).
 */
export function renderCertificateExpiringEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  courseName: string;
  daysLeft: number;
  /** Fecha de vencimiento ya formateada en es-CL por el llamador. */
  expiresOn: string;
  certificatesUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName || "");
  const course = escapeHtml(params.courseName);
  const days = Math.max(0, Math.trunc(params.daysLeft));
  const when = days === 0 ? "hoy" : days === 1 ? "en 1 día" : `en ${days} días`;
  const subject = `Tu certificado de ${params.courseName} vence ${when}`;
  const body = `<p>Hola ${name},</p>
<p>Tu certificado del curso <strong>${course}</strong> vence <strong>${escapeHtml(when)}</strong> (${escapeHtml(params.expiresOn)}).</p>
<p>Si tu trabajo exige mantener esta certificación vigente, conversa con tu empresa o con nosotros para reinscribirte en una nueva versión del curso.</p>
${button(params.brand.primaryColor, params.certificatesUrl, "Ver mis certificados")}`;
  const text = `Hola ${params.recipientName},\n\nTu certificado del curso ${params.courseName} vence ${when} (${params.expiresOn}).\n\nSi necesitas mantenerlo vigente, conversa con tu empresa o con nosotros para reinscribirte en una nueva versión del curso.\n\nVer mis certificados: ${params.certificatesUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/** Respuesta del relator/tutor a un hilo del foro (task 3.4, HU-9.2). */
export function renderForumReplyEmail(params: {
  brand: EmailBrand;
  threadTitle: string;
  courseUrl: string;
}): RenderedEmail {
  const subject = `Nueva respuesta en: ${params.threadTitle}`;
  const body = `<p>Respondieron tu consulta <strong>"${escapeHtml(params.threadTitle)}"</strong> en el foro del curso.</p>
${button(params.brand.primaryColor, params.courseUrl, "Ver la respuesta")}`;
  const text = `Respondieron tu consulta "${params.threadTitle}" en el foro.\n\nVer: ${params.courseUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/** Nuevo mensaje en el canal asincrónico (task 3.4, HU-9.3). */
export function renderMessageEmail(params: {
  brand: EmailBrand;
  subjectLine: string;
  courseUrl: string;
}): RenderedEmail {
  const subject = `Nuevo mensaje: ${params.subjectLine}`;
  const body = `<p>Tienes un nuevo mensaje sobre <strong>"${escapeHtml(params.subjectLine)}"</strong>.</p>
${button(params.brand.primaryColor, params.courseUrl, "Leer el mensaje")}`;
  const text = `Tienes un nuevo mensaje sobre "${params.subjectLine}".\n\nLeer: ${params.courseUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/**
 * Export completo del tenant listo para descargar (task 5.13, HU-1.5).
 *
 * ⚠ El enlace va a la PÁGINA del export (`/admin/exportacion`), NUNCA al
 * archivo: el signed URL real expira en 1 h y se firma recién cuando el admin
 * hace clic en "descargar" ya autenticado (minimización — el link del correo
 * no es, por sí solo, una puerta al ZIP).
 */
export function renderExportReadyEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  exportPageUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName || "");
  const subject = `Tu exportación de ${params.brand.orgName} está lista`;
  const body = `<p>Hola ${name},</p>
<p>La exportación completa de los datos de tu OTEC (cursos, alumnos, registros SENCE, notas, certificados y documentos) ya está lista para descargar.</p>
${button(params.brand.primaryColor, params.exportPageUrl, "Ver mi exportación")}
<p style="color:#71717a;font-size:13px;">El enlace de descarga expira 1 hora después de generarse; vuelve a esta página si necesitas uno nuevo.</p>`;
  const text = `Hola ${params.recipientName},\n\nLa exportación completa de los datos de tu OTEC ya está lista.\n\nVer mi exportación: ${params.exportPageUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}

/** Aviso de que el export del tenant FALLÓ (task 5.13, HU-1.5): invita a reintentar. */
export function renderExportFailedEmail(params: {
  brand: EmailBrand;
  recipientName: string;
  exportPageUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.recipientName || "");
  const subject = `No se pudo generar tu exportación de ${params.brand.orgName}`;
  const body = `<p>Hola ${name},</p>
<p>Intentamos generar la exportación completa de los datos de tu OTEC, pero algo falló. Puedes solicitarla de nuevo.</p>
${button(params.brand.primaryColor, params.exportPageUrl, "Reintentar")}`;
  const text = `Hola ${params.recipientName},\n\nLa exportación de datos de tu OTEC falló. Puedes solicitarla nuevamente en:\n${params.exportPageUrl}\n`;
  return { subject, html: shell(params.brand, body), text };
}
