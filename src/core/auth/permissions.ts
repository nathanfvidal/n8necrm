import type { Role } from "@prisma/client";

export type Acao =
  | "gerenciar_usuarios"
  | "criar_lead"
  | "mover_lead"
  | "ver_dashboard_geral"
  | "exportar_leads";

const matriz: Record<Role, Acao[]> = {
  ADMIN: ["gerenciar_usuarios", "criar_lead", "mover_lead", "ver_dashboard_geral", "exportar_leads"],
  GESTOR: ["criar_lead", "mover_lead", "ver_dashboard_geral", "exportar_leads"],
  VENDEDOR: ["criar_lead", "mover_lead"],
};

export function hasPermission(papel: Role, acao: Acao): boolean {
  return matriz[papel].includes(acao);
}
