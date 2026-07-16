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
