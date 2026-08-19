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
   * erro maior: a instância n8n deste projeto atende CLIENTES REAIS — a
   * contagem verificada em 2026-08-19 (Task 6, `.superpowers/sdd/task-6-report.md`)
   * foi 11 workflows, 8 ativos e 3 desligados, um deles executando a cada
   * poucos segundos por webhook. Desativar um fluxo pela tela derruba o
   * WhatsApp de um cliente pagante, e nada no CRM avisa esse cliente.
   */
  | "gerenciar_fluxos"
  /**
   * Ver a tela de fluxos (execuções e workflows) e reexecutar uma execução
   * passada. ADMIN e GESTOR — não VENDEDOR.
   *
   * Nasceu da revisão da Task 3 do Ciclo 4: `reexecutarExecucaoAction` só
   * checava sessão válida, apoiada no comentário "quem pode ver a execução
   * já pode ver o que ela fez" — premissa que não existia em lugar nenhum do
   * código, porque não havia permissão de visualização de automação. Como
   * Server Action é endpoint HTTP público, isso deixava qualquer VENDEDOR
   * com sessão válida disparar `POST /executions/{id}/retry` com ids
   * arbitrários contra a instância de produção de um cliente.
   *
   * Ver e reexecutar andam juntos porque reexecutar SEM poder ver é uma tela
   * que ninguém alcança de propósito (não tem link pra chegar lá), e ver SEM
   * poder reexecutar tira a única pergunta que a tela existe pra responder:
   * "isso ainda quebra?". Separar os dois criaria uma permissão órfã de um
   * lado e uma tela morta do outro.
   *
   * Não é o mesmo que `gerenciar_fluxos`, de propósito: reexecutar dispara
   * trabalho real na instância de um cliente, então não pode ficar livre
   * para quem só tem sessão válida — mas é diagnóstico (reexecuta um caso
   * que já aconteceu), não destruição (ativar/desativar/apagar workflow).
   * Prender diagnóstico a ADMIN tiraria de GESTOR a ferramenta de "isso
   * ainda quebra?" sem ganhar segurança nenhuma em troca — GESTOR já lida
   * com o cliente no dia a dia e é quem primeiro ouve "parou de funcionar".
   */
  | "ver_fluxos";

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
    "ver_fluxos",
  ],
  GESTOR: [
    "criar_lead",
    "mover_lead",
    "ver_dashboard_geral",
    "exportar_leads",
    "ver_documento_contato",
    "ver_fluxos",
  ],
  VENDEDOR: ["criar_lead", "mover_lead"],
};

export function hasPermission(papel: Role, acao: Acao): boolean {
  return matriz[papel].includes(acao);
}
