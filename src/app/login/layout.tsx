import { TenantBrandStyle } from "@/components/shell/tenant-brand-style";

/**
 * Co-branding del login por tenant (task 6.6): inyecta los colores del OTEC
 * del subdominio antes de renderizar la página. El logo se agrega en la
 * migración visual del área pública (task 6.8) — este layout solo cablea los
 * tokens CSS.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TenantBrandStyle />
      {children}
    </>
  );
}
