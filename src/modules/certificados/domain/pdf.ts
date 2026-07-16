import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { CertificateSnapshot } from "./snapshot";

/**
 * Render del certificado PDF (task 3.2, D-110: pdf-lib, puro JS sin binarios).
 * ÚNICO importador de pdf-lib (aislado, patrón de xlsx.ts). Determinista sobre el
 * snapshot congelado. La firma y el logo son opcionales (bytes PNG inyectados).
 */

export interface CertificateRenderOptions {
  /** Folio (lo asigna el RPC de emisión; no vive en el snapshot). */
  readonly folio: string;
  readonly qrPng: Uint8Array;
  readonly signaturePng?: Uint8Array;
  readonly logoPng?: Uint8Array;
  /** URL pública de verificación (impresa junto al QR). */
  readonly verifyUrl: string;
  /** Textos es-CL (inyectados para no meter strings en el dominio). */
  readonly labels: CertificateLabels;
}

export interface CertificateLabels {
  readonly title: string;
  readonly grantedTo: string;
  readonly run: string;
  readonly completedCourse: string;
  readonly hours: string;
  readonly period: string;
  readonly finalGrade: string;
  readonly attendance: string;
  readonly senceCode: string;
  readonly actionCode: string;
  readonly folio: string;
  readonly verifyAt: string;
  readonly legalRep: string;
  readonly senceNote: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return { r: 0.12, g: 0.23, b: 0.54 };
  const int = parseInt(m[1], 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

function drawCentered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font, color });
}

export async function renderCertificatePdf(
  snapshot: CertificateSnapshot,
  opts: CertificateRenderOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // A4 horizontal (pts).
  const page = doc.addPage([841.89, 595.28]);
  const W = page.getWidth();
  const H = page.getHeight();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = hexToRgb(snapshot.brandPrimary);
  const accent = hexToRgb(snapshot.brandAccent);
  const primaryColor = rgb(primary.r, primary.g, primary.b);
  const accentColor = rgb(accent.r, accent.g, accent.b);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.45);

  // Marcos.
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: primaryColor, borderWidth: 3 });
  page.drawRectangle({ x: 26, y: 26, width: W - 52, height: H - 52, borderColor: accentColor, borderWidth: 1 });

  // Logo (si hay bytes).
  if (opts.logoPng) {
    try {
      const img = await doc.embedPng(opts.logoPng);
      const scaled = img.scaleToFit(160, 60);
      page.drawImage(img, { x: 48, y: H - 48 - scaled.height, width: scaled.width, height: scaled.height });
    } catch {
      // logo inválido: se omite, no rompe la emisión.
    }
  }

  // Título + OTEC.
  drawCentered(page, opts.labels.title, H - 120, 40, bold, primaryColor);
  drawCentered(page, snapshot.otecName + (snapshot.otecRut ? ` · ${snapshot.otecRut}` : ""), H - 150, 12, font, muted);

  // Cuerpo.
  drawCentered(page, opts.labels.grantedTo, H - 205, 13, font, ink);
  drawCentered(page, snapshot.studentName, H - 240, 28, bold, ink);
  drawCentered(page, `${opts.labels.run}: ${snapshot.run}`, H - 262, 12, font, muted);

  drawCentered(page, opts.labels.completedCourse, H - 300, 13, font, ink);
  drawCentered(page, snapshot.courseName, H - 330, 20, bold, primaryColor);

  const period =
    snapshot.startsOn && snapshot.endsOn
      ? `${opts.labels.period}: ${snapshot.startsOn} — ${snapshot.endsOn}`
      : "";
  const facts = [`${opts.labels.hours}: ${snapshot.hours}`, period].filter((s) => s !== "").join("   ·   ");
  drawCentered(page, facts, H - 360, 12, font, ink);

  const metrics = [
    snapshot.finalGrade !== null ? `${opts.labels.finalGrade}: ${snapshot.finalGrade.toFixed(1)}` : "",
    snapshot.isSence ? `${opts.labels.attendance}: ${snapshot.attendancePct}%` : "",
    snapshot.codSence ? `${opts.labels.senceCode}: ${snapshot.codSence}` : "",
    `${opts.labels.actionCode}: ${snapshot.actionCode}`,
  ]
    .filter((s) => s !== "")
    .join("   ·   ");
  drawCentered(page, metrics, H - 382, 11, font, muted);

  // Firma (abajo-izquierda).
  const sigX = 90;
  const sigY = 90;
  if (opts.signaturePng) {
    try {
      const sig = await doc.embedPng(opts.signaturePng);
      const s = sig.scaleToFit(160, 60);
      page.drawImage(sig, { x: sigX, y: sigY, width: s.width, height: s.height });
    } catch {
      // firma inválida: se omite.
    }
  }
  page.drawLine({ start: { x: sigX, y: sigY - 4 }, end: { x: sigX + 180, y: sigY - 4 }, thickness: 1, color: muted });
  page.drawText(opts.labels.legalRep, { x: sigX, y: sigY - 18, size: 10, font, color: muted });
  page.drawText(snapshot.otecName, { x: sigX, y: sigY - 30, size: 10, font: bold, color: ink });

  // QR + folio (abajo-derecha).
  try {
    const qr = await doc.embedPng(opts.qrPng);
    page.drawImage(qr, { x: W - 150, y: 60, width: 90, height: 90 });
  } catch {
    // qr inválido: se omite.
  }
  page.drawText(`${opts.labels.folio}: ${opts.folio}`, { x: W - 320, y: 140, size: 10, font: bold, color: ink });
  page.drawText(opts.labels.verifyAt, { x: W - 320, y: 126, size: 8, font, color: muted });
  page.drawText(opts.verifyUrl, { x: W - 320, y: 114, size: 8, font, color: accentColor });

  // Nota SENCE (footer): el PDF es de la OTEC, no reemplaza la DJ oficial.
  drawCentered(page, opts.labels.senceNote, 44, 8, font, muted);

  return doc.save();
}
