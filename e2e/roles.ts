/** Rutas de storageState + usuarios semilla por rol (task 3.8). NO es un test. */

export const AUTH = {
  admin: "playwright/.auth/admin.json",
  coordinator: "playwright/.auth/coordinator.json",
  student: "playwright/.auth/student.json",
} as const;

export const PASSWORD = "Password123!";

export const USERS: { role: keyof typeof AUTH; email: string }[] = [
  { role: "admin", email: "admin@otec-andes.test" },
  { role: "coordinator", email: "coordinacion@otec-andes.test" },
  { role: "student", email: "alumno@otec-andes.test" },
];

export const TENANT_A = "11111111-1111-4111-8111-111111111111";

/** Certificado sembrado para el flujo de verificación pública (#3). */
export const CERT = {
  token: "e2e-verify-token-0001",
  folio: "CERT-2026-E2E001",
  studentName: "Ana E2E Pérez",
  runMasked: "5.•••.•••-3",
  runFull: "5126663-3", // NO debe aparecer en la página pública
  courseName: "Curso E2E de Verificación",
} as const;
