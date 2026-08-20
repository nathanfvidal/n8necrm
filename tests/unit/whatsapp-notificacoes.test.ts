// Usa o Prisma real contra o Postgres do Supabase — mesmo motivo de
// whatsapp-agente.test.ts: a prova de que `marcarAguardandoHumano` não
// duplica aviso sob concorrência depende de um UPDATE condicional de
// verdade contra o banco, não de um mock — carrega DATABASE_URL do .env
// aqui, mesmo padrão de rate-limit.test.ts.
import "dotenv/config";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Importe `prisma` exatamente como `tests/unit/whatsapp-agente.test.ts` faz —
// leia aquele arquivo antes de escrever este. O `vi.mock("server-only")` acima
// precisa vir antes de qualquer import que alcance `src/lib/prisma.ts`, e é por
// isso que os imports aqui são dinâmicos.
const { prisma } = await import("@/lib/prisma");
const { companyIdSemeada, criarConversation, limparConversasDeTeste } = await import(
  "./helpers/whatsapp"
);
const { marcarAguardandoHumano, limparAguardandoHumano } = await import(
  "../../src/modules/whatsapp/notificacoes"
);
const { TIPO_CONVERSA_AGUARDANDO } = await import(
  "../../src/modules/whatsapp/notificacao-tipos"
);
const { listarConversas } = await import("../../src/modules/whatsapp/queries");

async function notificacoesDaConversa(conversationId: string) {
  const todas = await prisma.notification.findMany({
    where: { tipo: TIPO_CONVERSA_AGUARDANDO },
  });
  return todas.filter(
    (n) => (n.payload as { conversationId?: string } | null)?.conversationId === conversationId
  );
}

/**
 * Quantos avisos ESTA conversa deve gerar: um por usuário ativo **com vínculo
 * (`Membership`) na empresa da conversa**.
 *
 * Era `prisma.user.count({ where: { ativo: true } })` — a mesma consulta sem
 * empresa que o defeito de `marcarAguardandoHumano` tinha. Com uma empresa só
 * no banco os dois números coincidem, então o teste passava por cima do
 * vazamento sem enxergá-lo; a expectativa precisa falar a mesma língua da
 * regra que ela prova.
 */
async function destinatariosEsperados(companyId: string): Promise<number> {
  return prisma.membership.count({ where: { companyId, user: { ativo: true } } });
}

// Marca deste arquivo nas linhas que ele cria fora do prefixo `teste-turno-`
// (empresa e usuário do caso de tenancy abaixo) — mesmo recurso de
// `tests/unit/alerta-atividade.test.ts`, para que a limpeza e qualquer
// inspeção manual saibam de onde a linha veio.
const MARCA = "ZZWhatsappNotificacoes";
// Hash bcrypt sintaticamente válido e que não corresponde a senha nenhuma:
// o usuário criado aqui existe só para ser (ou não ser) destinatário.
const HASH_INERTE = "$2b$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinva";

describe("aviso de conversa aguardando humano", () => {
  // Ids das conversas que ESTE arquivo de teste criou, para escopar a limpeza
  // de notificações abaixo. Toda `it` cria sua conversa via este wrapper em
  // vez de chamar `criarConversation` direto, só para alimentar esta lista.
  const idsConversasDoTeste: string[] = [];

  async function criarConversaDeTeste(...args: Parameters<typeof criarConversation>) {
    const conversa = await criarConversation(...args);
    idsConversasDoTeste.push(conversa.id);
    return conversa;
  }

  afterEach(async () => {
    // Escopado às conversas que ESTE teste criou — NUNCA um `deleteMany` por
    // `tipo` sozinho. `Notification` não tem FK para `Conversation` (payload
    // é só um `conversationId` solto em JSON, mesmo formato de `NOVO_LEAD` —
    // ver `limparDemo` em prisma/seed-demo-limpar.ts para o mesmo problema
    // resolvido do mesmo jeito), então filtrar por `tipo` sozinho apagaria
    // todo aviso desse tipo no banco compartilhado. Isto NÃO é hipotético:
    // `turno.ts` já chama `marcarAguardandoHumano` em três pontos do fluxo
    // real de mensagens (`agente.ts` só chama `limparAguardandoHumano`, nunca
    // `marcarAguardandoHumano`) (Fatia 3, Task 2) — rodar esta suíte contra
    // o banco de dev com um `deleteMany` por `tipo` apagaria, agora, avisos
    // pendentes de conversas de clientes reais, e nada ligaria a causa
    // (rodar este teste) ao efeito (aviso sumido em outra tela).
    if (idsConversasDoTeste.length > 0) {
      const notificacoes = await prisma.notification.findMany({
        where: { tipo: TIPO_CONVERSA_AGUARDANDO },
      });
      const idsParaApagar = notificacoes
        .filter((n) =>
          idsConversasDoTeste.includes(
            (n.payload as { conversationId?: string } | null)?.conversationId ?? ""
          )
        )
        .map((n) => n.id);
      if (idsParaApagar.length > 0) {
        await prisma.notification.deleteMany({ where: { id: { in: idsParaApagar } } });
      }
      idsConversasDoTeste.length = 0;
    }
    await limparConversasDeTeste();
  });

  // --- Redação de PII no aviso (risco registrado na auditoria da branch) ---
  //
  // O aviso é copiado para UMA LINHA POR USUÁRIO ATIVO, numa tabela sem
  // limpeza. A cadeia de rótulo terminava em `conversa.telefone ?? conversa.waId`
  // — ou seja, cliente novo (sem contato e sem push name, o caso comum de
  // primeira mensagem) tinha o telefone COMPLETO replicado para a equipe
  // inteira, e ele ficava lá para sempre.
  //
  // A notificação não precisa do número: ela carrega `conversationId` e leva
  // para a conversa, onde quem tem acesso vê o telefone. O rótulo só precisa
  // distinguir uma conversa da outra.
  describe("rotulo do aviso nao replica telefone do cliente", () => {
    it("sem contato e sem nome: mascara, mantendo so os 4 ultimos digitos", async () => {
      const conversa = await criarConversaDeTeste({ telefone: "11987654321" });

      await marcarAguardandoHumano(conversa.id);

      const [aviso] = await notificacoesDaConversa(conversa.id);
      const rotulo = (aviso.payload as { nomeExibicao: string }).nomeExibicao;

      expect(rotulo).not.toContain("11987654321");
      expect(rotulo).not.toContain("1198765");
      expect(rotulo).toContain("4321");
    });

    it("waId tambem e' mascarado quando nao ha telefone normalizado", async () => {
      // O `waId` PRECISA começar com o prefixo que `limparConversasDeTeste`
      // usa ("teste-turno-"). A primeira versão deste teste usava prefixo
      // próprio, a limpeza não alcançava a linha, e a segunda execução batia
      // em violação de unicidade de `waId` — num banco compartilhado com
      // produção, teste que não limpa o que cria quebra a PRÓXIMA execução.
      const conversa = await criarConversaDeTeste({
        waId: "teste-turno-5511912345678",
        telefone: null,
      });

      await marcarAguardandoHumano(conversa.id);

      const [aviso] = await notificacoesDaConversa(conversa.id);
      const rotulo = (aviso.payload as { nomeExibicao: string }).nomeExibicao;

      expect(rotulo).not.toContain("5511912345678");
      expect(rotulo).toContain("5678");
    });

    // O outro lado: quando HÁ nome, ele continua indo — a redação não pode
    // custar a utilidade do aviso, que existe para alguém decidir se atende.
    it("com nome de exibicao, o nome vai no aviso e nenhum digito aparece", async () => {
      const conversa = await criarConversaDeTeste({
        telefone: "11987654321",
        nomeExibicao: "Joana Cliente",
      });

      await marcarAguardandoHumano(conversa.id);

      const [aviso] = await notificacoesDaConversa(conversa.id);
      const rotulo = (aviso.payload as { nomeExibicao: string }).nomeExibicao;

      expect(rotulo).toBe("Joana Cliente");
    });
  });

  it("marca a conversa e notifica os usuários ativos da empresa da conversa", async () => {
    const conversa = await criarConversaDeTeste();
    const ganhou = await marcarAguardandoHumano(conversa.id);

    expect(ganhou).toBe(true);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeInstanceOf(Date);

    const esperados = await destinatariosEsperados(conversa.companyId);
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(esperados);
  });

  // O comportamento que a fatia inteira existe para garantir: um cliente
  // ansioso mandando cinco mensagens não vira cinco avisos por pessoa.
  it("marcar de novo não cria segundo aviso", async () => {
    const conversa = await criarConversaDeTeste();
    await marcarAguardandoHumano(conversa.id);
    const primeira = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    const ganhouDeNovo = await marcarAguardandoHumano(conversa.id);

    expect(ganhouDeNovo).toBe(false);
    const esperados = await destinatariosEsperados(conversa.companyId);
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(esperados);

    // E não reescreve o instante: quem espera há mais tempo continua no topo.
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde?.getTime()).toBe(primeira.aguardandoHumanoDesde?.getTime());
  });

  // Turnos concorrentes na mesma conversa são normais neste sistema — o lease
  // existe porque acontecem. Sem UPDATE condicional atômico, a equipe receberia
  // dois avisos da mesma conversa.
  it("duas marcações simultâneas produzem um aviso só", async () => {
    const conversa = await criarConversaDeTeste();

    const resultados = await Promise.all([
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
    ]);

    expect(resultados.filter(Boolean)).toHaveLength(1);
    const esperados = await destinatariosEsperados(conversa.companyId);
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(esperados);
  });

  it("não notifica usuário inativo — inclusive o usuário de sistema do WhatsApp", async () => {
    const conversa = await criarConversaDeTeste();
    await marcarAguardandoHumano(conversa.id);

    const avisos = await notificacoesDaConversa(conversa.id);
    const usuarios = await prisma.user.findMany({
      where: { id: { in: avisos.map((a) => a.userId) } },
      select: { ativo: true },
    });
    expect(usuarios.every((u) => u.ativo)).toBe(true);
  });

  // O entregável do reparo de tenancy. Antes, os destinatários vinham de
  // `prisma.user.findMany({ where: { ativo: true } })` — sem empresa nenhuma —
  // e cada aviso saía carimbado com o `companyId` DA CONVERSA. Resultado
  // medido no banco de desenvolvimento: 11 linhas de `Notification` com
  // `companyId: "company-migracao-1a"` e `userId` de usuários de 8 empresas de
  // teste, cada uma carregando o rótulo do cliente ("Cliente ···4062") no
  // payload. Rótulo de cliente de uma empresa entregue no sino de gente de
  // outra — mesma família do vazamento já corrigido em `core/audit/alerta.ts`.
  //
  // A prova é a AUSÊNCIA DA LINHA, não "a função filtrou": conta as
  // notificações do forasteiro no banco depois da chamada real.
  it("usuário ativo de OUTRA empresa não recebe o aviso desta conversa", async () => {
    const conversa = await criarConversaDeTeste();

    const outraEmpresa = await prisma.company.create({
      data: { nome: `${MARCA} Outra Empresa` },
    });
    const deOutraEmpresa = await prisma.user.create({
      data: {
        nome: `Ativo de outra empresa ${MARCA}`,
        email: `ativo-outra-empresa-${MARCA.toLowerCase()}@teste.invalid`,
        senhaHash: HASH_INERTE,
        papel: "VENDEDOR",
        ativo: true,
      },
    });
    await prisma.membership.create({
      data: { userId: deOutraEmpresa.id, companyId: outraEmpresa.id, papel: "VENDEDOR" },
    });

    try {
      await marcarAguardandoHumano(conversa.id);

      const doForasteiro = await prisma.notification.findMany({
        where: { userId: deOutraEmpresa.id, tipo: TIPO_CONVERSA_AGUARDANDO },
      });
      expect(doForasteiro).toHaveLength(0);

      // A exclusão é por empresa, não uma falha geral de envio: a equipe da
      // empresa da conversa continua sendo avisada.
      const esperados = await destinatariosEsperados(conversa.companyId);
      expect(esperados).toBeGreaterThan(0);
      expect(await notificacoesDaConversa(conversa.id)).toHaveLength(esperados);
    } finally {
      // Nesta ordem: as notificações (FK `Notification_userId_fkey` é
      // RESTRICT) antes do `User`, o `User` — cujo cascade leva o
      // `Membership` — antes da `Company`. Sem a primeira linha, o `delete`
      // do usuário falha e o arquivo deixa usuário E empresa para trás no
      // banco compartilhado; é exatamente o quadro que envenenou
      // `users-service.test.ts`.
      await prisma.notification.deleteMany({ where: { userId: deOutraEmpresa.id } });
      await prisma.user.delete({ where: { id: deOutraEmpresa.id } });
      await prisma.company.delete({ where: { id: outraEmpresa.id } });
    }
  });

  it("limpar zera o campo e deixa a conversa pronta para marcar de novo", async () => {
    const conversa = await criarConversaDeTeste();
    await marcarAguardandoHumano(conversa.id);
    await limparAguardandoHumano(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeNull();

    // O ciclo fecha e reabre: o cliente voltou, ninguém respondeu, avisa de novo.
    expect(await marcarAguardandoHumano(conversa.id)).toBe(true);
  });

  it("listarConversas põe quem aguarda no topo, mais antiga primeiro", async () => {
    const recenteSemEspera = await criarConversaDeTeste();
    const esperaNova = await criarConversaDeTeste();
    const esperaAntiga = await criarConversaDeTeste();

    await prisma.conversation.update({
      where: { id: esperaNova.id },
      data: { aguardandoHumanoDesde: new Date(Date.now() - 5 * 60_000) },
    });
    await prisma.conversation.update({
      where: { id: esperaAntiga.id },
      data: { aguardandoHumanoDesde: new Date(Date.now() - 60 * 60_000) },
    });
    // `recenteSemEspera` precisa ser a mais recente por `atualizadoEm` —
    // senão, sendo a mais antiga por criação, ela iria para o fim da lista
    // de qualquer jeito e o teste passaria mesmo com a ordenação por espera
    // errada. Um `update` qualquer (`@updatedAt` no schema) basta.
    await prisma.conversation.update({
      where: { id: recenteSemEspera.id },
      data: { iaAtiva: true },
    });

    // `listarConversas` passou a exigir `companyId` no Ciclo 1d. A empresa é
    // a única do seed — a mesma em que `criarConversaDeTeste` cria as linhas.
    const lista = await listarConversas(await companyIdSemeada());
    const posicao = (id: string) => lista.findIndex((c) => c.id === id);

    // `findIndex` devolve -1 para quem não está na lista (ex.: caiu fora do
    // `take: 100` de `listarConversas()`) — e `expect(-1).toBeLessThan(n)`
    // passaria mesmo assim, mascarando exatamente o cenário que este teste
    // existe para pegar. As guardas abaixo travam essa saída antes da
    // comparação de ordem, mesmo padrão do e2e irmão
    // (`tests/e2e/whatsapp-agente.spec.ts`).
    const posicaoAntiga = posicao(esperaAntiga.id);
    const posicaoNova = posicao(esperaNova.id);
    const posicaoRecente = posicao(recenteSemEspera.id);
    expect(posicaoAntiga).toBeGreaterThanOrEqual(0);
    expect(posicaoNova).toBeGreaterThanOrEqual(0);
    expect(posicaoRecente).toBeGreaterThanOrEqual(0);

    expect(posicaoAntiga).toBeLessThan(posicaoNova);
    expect(posicaoNova).toBeLessThan(posicaoRecente);
  });
});
