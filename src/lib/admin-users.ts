import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Alta idempotente de usuarios de Auth desde el servidor (task 5.3, HU-1.1).
 *
 * COPIA deliberada de los helpers privados de
 * `src/modules/portal-empresa/supervisor-grant-service.ts` (ese archivo queda
 * intacto en este PR; el follow-up de deduplicarlo hacia aquí está anotado en
 * la descripción del commit). Requiere un cliente service-role (admin API).
 */

function throwawayPassword(): string {
  // El usuario entra por el enlace de invitación; esta clave nunca se usa.
  // Un solo UUID: bcrypt (GoTrue) tope en 72 bytes; dos UUIDs (76) lo revientan.
  return `Tn-${crypto.randomUUID()}`;
}

/** Busca el user_id por email recorriendo el admin API (idempotencia). */
export async function findUserByEmail(db: SupabaseClient, email: string): Promise<string | null> {
  const key = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    for (const u of users) if (u.email?.toLowerCase() === key) return u.id;
    if (users.length < 200) break;
  }
  return null;
}

/** Crea el usuario (o lo encuentra si el correo ya existe). */
export async function ensureUser(db: SupabaseClient, email: string): Promise<string | null> {
  // Intento crear primero: en el happy path (email nuevo) evita escanear TODOS
  // los usuarios con listUsers. Si el correo ya existe, createUser falla (email
  // ya registrado) y recién ahí lo busco por email.
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: throwawayPassword(),
  });
  if (data?.user) return data.user.id;
  if (!error) return null;
  return findUserByEmail(db, email);
}
