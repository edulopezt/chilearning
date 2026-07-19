import { AppShell } from "@/components/shell/app-shell";

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
