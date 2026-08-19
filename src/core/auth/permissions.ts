import type { Role } from "@prisma/client";

export type Acao =
  | "gerenciar_usuarios"
  | "criar_lead"
  | "mover_lead"
  | "ver_dashboard_geral"
  | "exportar_leads"
  | "configurar_agente"
  /**
   * Ver e editar `Contact.documento` (CPF/CNPJ).
   *
   * É a ÚNICA exceção à decisão de que todos os papéis veem todo lead e todo
   * contato, e ela é estreita de propósito: vale para um campo, não para a
   * tela. VENDEDOR continua vendo e corrigindo nome, telefone, e-mail,
   * empresa, cargo, endereço e observações de qualquer pessoa.
   *
   * O motivo de o documento ser diferente não é ele ser "mais secreto" no dia
   * a dia — o vendedor lê o CPF no contrato de qualquer forma. É que uma base
   * de CPFs vazada tem peso legal e serve para fraude de identidade, coisa que
   * uma lista de telefones comerciais não tem. O custo de restringir é quase
   * zero (ninguém precisa do CPF para vender); o custo de não restringir só
   * aparece uma vez, e aparece grande.
   *
   * Achado R2 da auditoria da branch de cadastro de contato; decisão do dono.
   */
  | "ver_documento_contato"
  /**
   * Criar, renomear, recolorir, reordenar e remover etapas do funil.
   *
   * Exclusiva de ADMIN pelo mesmo motivo de `gerenciar_usuarios`: renomear uma
   * etapa muda o vocabulário de todo mundo que usa o CRM, e remover uma
   * reescreve `stageId` de leads em massa. Estreitar depois é fácil; alargar
   * depois de estragar, não.
   */
  | "gerenciar_funil"
  /**
   * Ativar, desativar e apagar workflows na instância n8n, e reexecutar uma
   * execução passada.
   *
   * ADMIN apenas, pelo mesmo motivo de `gerenciar_funil`, mas com o custo do
   * erro maior: a instância n8n deste projeto atende CLIENTES REAIS — em
   * 2026-08-19 eram 6 workflows ativos, um deles executando a cada poucos
   * segundos por webhook. Desativar um fluxo pela tela derruba o WhatsApp de
   * um cliente pagante, e nada no CRM avisa esse cliente.
   */
  | "gerenciar_fluxos";

const matriz: Record<Role, Acao[]> = {
  ADMIN: [
    "gerenciar_usuarios",
    "criar_lead",
    "mover_lead",
    "ver_dashboard_geral",
    "exportar_leads",
    "configurar_agente",
    "ver_documento_contato",
    "gerenciar_funil",
    "gerenciar_fluxos",
  ],
  GESTOR: [
    "criar_lead",
    "mover_lead",
    "ver_dashboard_geral",
    "exportar_leads",
    "ver_documento_contato",
  ],
  VENDEDOR: ["criar_lead", "mover_lead"],
};

export function hasPermission(papel: Role, acao: Acao): boolean {
  return matriz[papel].includes(acao);
}
