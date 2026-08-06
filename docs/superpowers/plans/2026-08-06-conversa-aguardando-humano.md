# Conversa aguardando humano — Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** quando a IA fica calada e o cliente está esperando, marcar a conversa
com o instante em que a espera começou, avisar toda a equipe uma vez, e deixar o
estado visível e ordenado na lista de conversas.

**Arquitetura:** um campo `Conversation.aguardandoHumanoDesde` (`DateTime?`) é a fonte
da verdade. Ele é preenchido por um UPDATE condicional atômico — quem consegue afetar
a linha ganha a transição e cria as notificações, quem não consegue não faz nada, o que
elimina aviso duplicado sob turnos concorrentes sem check-then-act. É limpo quando
alguém (humano ou IA) responde ao cliente.

**Stack:** Next.js 16 (App Router, Server Components), Prisma 7 com `@prisma/adapter-pg`,
PostgreSQL (Supabase), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-06-conversa-aguardando-humano-design.md`

## Restrições globais

Valem para **todas** as tarefas:

- **Idioma:** identificadores, comentários e texto de interface em **português do
  Brasil**.
- **`src/core` NÃO pode importar de `src/modules`** — regra de lint com erro
  (`eslint.config.mjs`). O projeto é clonado por cliente: `core` é compartilhado entre
  forks, `modules` são opcionais. Tudo desta fatia que conhece `Conversation` mora em
  `src/modules/whatsapp/`. `src/components/` pode importar de `modules`.
- **Rodar `npx eslint` nos arquivos tocados**, além de `vitest` e `tsc`. A regra acima
  só aparece no lint, e já passou despercebida por duas verificações numa fatia
  anterior.
- **Migrações precisam da `DIRECT_URL`** (session pooler, porta 5432) no `.env`. Com a
  `DATABASE_URL` de transaction pooler, `prisma migrate` **pendura sem imprimir nada**.
- **`usuarioAtual()` é a única fonte de identidade** em Server Action — nunca aceitar
  id de usuário vindo do cliente.
- **Nunca ler, imprimir ou commitar o `.env`.**
- **O banco de desenvolvimento é real e compartilhado.** Todo teste limpa o que criou e
  restaura o que mudou, em `afterEach`/`afterAll`/`finally` — nunca no fim do corpo do
  teste, que não roda se a asserção falhar antes.
- **Não rodar a suíte completa** durante o desenvolvimento de uma tarefa; rodar os
  arquivos afetados. Nada em background.
- **E2E só via `npm run test:e2e`** (encadeia a guarda de porta). Nunca `npx playwright
  test` direto.
- **Commits em português**, padrão `feat:`/`fix:`/`test:`/`docs:`, terminando com
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Campo, migração e serviço de marcação

**Arquivos:**
- Modificar: `prisma/schema.prisma` (modelo `Conversation`)
- Criar: `prisma/migrations/<timestamp>_conversa_aguardando_humano/migration.sql` (gerada)
- Criar: `src/modules/whatsapp/notificacao-tipos.ts`
- Criar: `src/modules/whatsapp/notificacoes.ts`
- Criar: `tests/unit/whatsapp-notificacoes.test.ts`

**Interfaces:**
- Consome: `Conversation`, `User`, `Notification` (todos já existem);
  helpers de teste em `tests/unit/helpers/whatsapp.ts`
  (`criarConversation(overrides)`, `criarMensagemEntrada(conversationId, overrides)`,
  `idsDeUsuariosSemeados()`, `limparConversasDeTeste()`).
- Produz:
  - `Conversation.aguardandoHumanoDesde: DateTime?` + `@@index`
  - `type ConversaAguardandoPayload = { conversationId: string; nomeExibicao: string }`
  - `function extrairPayloadConversaAguardando(payload: unknown): ConversaAguardandoPayload | null`
  - `async function marcarAguardandoHumano(conversationId: string): Promise<boolean>`
  - `async function limparAguardandoHumano(conversationId: string): Promise<void>`

- [ ] **Passo 1: Acrescentar o campo ao schema**

Em `prisma/schema.prisma`, dentro de `model Conversation`, junto dos outros campos de
estado da IA:

```prisma
  aguardandoHumanoDesde DateTime?
```

E, junto dos índices que o modelo já tem:

```prisma
  // A lista de conversas ordena por este campo em toda navegação para
  // /conversas — mesmo raciocínio do índice em `processandoAte`.
  @@index([aguardandoHumanoDesde])
```

`DateTime?` e não `Boolean` de propósito: "esperando" não ajuda ninguém a priorizar,
"esperando há quarenta minutos" ajuda. O mesmo campo serve à decisão de quem atende e à
ordenação da lista.

- [ ] **Passo 2: Gerar e aplicar a migração**

Executar: `npx prisma migrate dev --name conversa_aguardando_humano`

Esperado: aplica em segundos. Se pendurar sem imprimir nada, falta a `DIRECT_URL` no
`.env` — não é lentidão.

**Nenhuma tabela nova**, então esta migração **não** precisa de `ENABLE ROW LEVEL
SECURITY` nem `REVOKE`: `Conversation` já os tem desde a Fatia 1. (A regra continua
valendo para tabela nova — o Prisma não emite nenhum dos dois.)

- [ ] **Passo 3: Escrever o extrator de payload**

```ts
// src/modules/whatsapp/notificacao-tipos.ts

// Sem `import "server-only"` de propósito — mesmo motivo de
// `core/notifications/types.ts`: este arquivo não toca Prisma, e o sino
// (`notification-bell.tsx`, Client Component) o importa diretamente para
// renderizar o conteúdo sem confiar cegamente no JSON vindo do servidor.

/** Tipo gravado em `Notification.tipo` para este aviso. */
export const TIPO_CONVERSA_AGUARDANDO = "CONVERSA_AGUARDANDO";

/**
 * Formato do `payload` gravado por `marcarAguardandoHumano` (notificacoes.ts).
 *
 * `nomeExibicao` é uma cópia congelada no momento da criação, nunca uma
 * referência viva — mesmo raciocínio de `NovoLeadPayload`: não há FK entre
 * `Notification` e `Conversation`, e a notificação precisa continuar legível
 * mesmo que a conversa seja apagada depois.
 */
export type ConversaAguardandoPayload = {
  conversationId: string;
  nomeExibicao: string;
};

/**
 * Extrai o payload de forma defensiva, devolvendo `null` quando o formato não
 * bate — nunca lançando. Quem chama decide o fallback (ver
 * `notification-bell.tsx`), em vez de o app quebrar ao ler um campo ausente.
 */
export function extrairPayloadConversaAguardando(
  payload: unknown
): ConversaAguardandoPayload | null {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).conversationId === "string" &&
    typeof (payload as Record<string, unknown>).nomeExibicao === "string"
  ) {
    return payload as ConversaAguardandoPayload;
  }
  return null;
}
```

- [ ] **Passo 4: Escrever os testes (falham)**

```ts
// tests/unit/whatsapp-notificacoes.test.ts
import "dotenv/config";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Importe `prisma` exatamente como `tests/unit/whatsapp-agente.test.ts` faz —
// leia aquele arquivo antes de escrever este. O `vi.mock("server-only")` acima
// precisa vir antes de qualquer import que alcance `src/lib/prisma.ts`, e é por
// isso que os imports aqui são dinâmicos.
const { prisma } = await import("@/lib/prisma");
const { criarConversation, limparConversasDeTeste } = await import("./helpers/whatsapp");
const { marcarAguardandoHumano, limparAguardandoHumano } = await import(
  "../../src/modules/whatsapp/notificacoes"
);
const { TIPO_CONVERSA_AGUARDANDO } = await import(
  "../../src/modules/whatsapp/notificacao-tipos"
);

async function notificacoesDaConversa(conversationId: string) {
  const todas = await prisma.notification.findMany({
    where: { tipo: TIPO_CONVERSA_AGUARDANDO },
  });
  return todas.filter(
    (n) => (n.payload as { conversationId?: string } | null)?.conversationId === conversationId
  );
}

describe("aviso de conversa aguardando humano", () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { tipo: TIPO_CONVERSA_AGUARDANDO } });
    await limparConversasDeTeste();
  });

  it("marca a conversa e notifica todos os usuários ativos", async () => {
    const conversa = await criarConversation();
    const ganhou = await marcarAguardandoHumano(conversa.id);

    expect(ganhou).toBe(true);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeInstanceOf(Date);

    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);
  });

  // O comportamento que a fatia inteira existe para garantir: um cliente
  // ansioso mandando cinco mensagens não vira cinco avisos por pessoa.
  it("marcar de novo não cria segundo aviso", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);
    const primeira = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    const ganhouDeNovo = await marcarAguardandoHumano(conversa.id);

    expect(ganhouDeNovo).toBe(false);
    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);

    // E não reescreve o instante: quem espera há mais tempo continua no topo.
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde?.getTime()).toBe(primeira.aguardandoHumanoDesde?.getTime());
  });

  // Turnos concorrentes na mesma conversa são normais neste sistema — o lease
  // existe porque acontecem. Sem UPDATE condicional atômico, a equipe receberia
  // dois avisos da mesma conversa.
  it("duas marcações simultâneas produzem um aviso só", async () => {
    const conversa = await criarConversation();

    const resultados = await Promise.all([
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
    ]);

    expect(resultados.filter(Boolean)).toHaveLength(1);
    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);
  });

  it("não notifica usuário inativo — inclusive o usuário de sistema do WhatsApp", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);

    const avisos = await notificacoesDaConversa(conversa.id);
    const usuarios = await prisma.user.findMany({
      where: { id: { in: avisos.map((a) => a.userId) } },
      select: { ativo: true },
    });
    expect(usuarios.every((u) => u.ativo)).toBe(true);
  });

  it("limpar zera o campo e deixa a conversa pronta para marcar de novo", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);
    await limparAguardandoHumano(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeNull();

    // O ciclo fecha e reabre: o cliente voltou, ninguém respondeu, avisa de novo.
    expect(await marcarAguardandoHumano(conversa.id)).toBe(true);
  });
});
```

- [ ] **Passo 5: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-notificacoes.test.ts`
Esperado: FALHA — `notificacoes.ts` não existe.

- [ ] **Passo 6: Escrever `notificacoes.ts`**

```ts
import "server-only";

import { prisma } from "@/lib/prisma";

import { TIPO_CONVERSA_AGUARDANDO, type ConversaAguardandoPayload } from "./notificacao-tipos";

/**
 * Marca a conversa como aguardando atendimento humano e, **só quando esta
 * chamada foi quem fez a transição**, notifica toda a equipe.
 *
 * ## Por que um UPDATE condicional e não "consulta, decide, grava"
 *
 * Turnos concorrentes na mesma conversa são normais neste sistema — o lease em
 * `turno.ts` existe justamente porque acontecem. Um check-then-act teria janela
 * entre a leitura e a escrita, e o resultado visível seria a equipe recebendo
 * dois avisos da mesma conversa. Aqui o banco decide: `WHERE
 * "aguardandoHumanoDesde" IS NULL` faz a transição acontecer no máximo uma vez,
 * e `count` diz quem ganhou. Mesmo idioma de `claimLease`, `pausarIa` e
 * `checarRateLimit`.
 *
 * O UPDATE também **não reescreve** o instante quando já havia um: quem espera
 * há mais tempo continua no topo da lista.
 *
 * Devolve `true` quando esta chamada ganhou a transição (e portanto notificou),
 * `false` quando outra já havia marcado.
 */
export async function marcarAguardandoHumano(conversationId: string): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, aguardandoHumanoDesde: null },
    data: { aguardandoHumanoDesde: new Date() },
  });

  if (count === 0) return false;

  const conversa = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { contact: { select: { nome: true } } },
  });

  // Cadeia igual à da tela de detalhe. Nunca nulo: um aviso dizendo
  // "conversa sem nome" não ajuda ninguém a decidir se atende.
  const nomeExibicao =
    conversa.contact?.nome ?? conversa.nomeExibicao ?? conversa.telefone ?? conversa.waId;

  const payload: ConversaAguardandoPayload = { conversationId, nomeExibicao };

  // Todos os ativos. O usuário de sistema do WhatsApp é `ativo: false` no seed,
  // então o filtro já o exclui — sem lista de exceções para alguém manter.
  const ativos = await prisma.user.findMany({ where: { ativo: true }, select: { id: true } });
  if (ativos.length === 0) return true;

  await prisma.notification.createMany({
    data: ativos.map((usuario) => ({
      userId: usuario.id,
      tipo: TIPO_CONVERSA_AGUARDANDO,
      payload,
    })),
  });

  return true;
}

/**
 * Limpa o estado de espera — alguém falou com o cliente.
 *
 * Incondicional de propósito: não há corrida a resolver, porque limpar duas
 * vezes tem o mesmo efeito de limpar uma. `updateMany` em vez de `update` para
 * não lançar se a conversa tiver sido apagada nesse meio tempo.
 */
export async function limparAguardandoHumano(conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: { aguardandoHumanoDesde: null },
  });
}
```

- [ ] **Passo 7: Rodar e ver passar**

Executar: `npx vitest run tests/unit/whatsapp-notificacoes.test.ts`
Esperado: PASSA (5 testes).

- [ ] **Passo 8: Conferir lint e tipos**

Executar: `npx eslint src/modules/whatsapp/ tests/unit/whatsapp-notificacoes.test.ts && npx tsc --noEmit`
Esperado: ambos limpos.

- [ ] **Passo 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/whatsapp/notificacao-tipos.ts src/modules/whatsapp/notificacoes.ts tests/unit/whatsapp-notificacoes.test.ts
git commit -m "feat: marca conversa aguardando humano e avisa a equipe uma vez"
```

---

### Task 2: Ligar ao turno e à resposta humana

**Arquivos:**
- Modificar: `src/modules/whatsapp/turno.ts`
- Modificar: `src/modules/whatsapp/agente.ts`
- Modificar: `tests/unit/whatsapp-turno.test.ts`
- Modificar: `tests/unit/whatsapp-agente.test.ts`

**Interfaces:**
- Consome: `marcarAguardandoHumano(conversationId)` e `limparAguardandoHumano(conversationId)`
  da Task 1.
- Produz: nenhuma assinatura nova; só liga o serviço aos pontos existentes.

- [ ] **Passo 1: Escrever os testes do turno (falham)**

Acrescente a `tests/unit/whatsapp-turno.test.ts`, reaproveitando os helpers que o
arquivo já usa:

```ts
describe("marca conversa aguardando humano", () => {
  async function aguardandoDe(conversationId: string) {
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    return c.aguardandoHumanoDesde;
  }

  it("marca quando a conversa está pausada", async () => {
    const conversa = await criarConversation({ iaAtiva: false });
    await criarMensagemEntrada(conversa.id, { texto: "oi, tem o Onix?" });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    expect(await aguardandoDe(conversa.id)).toBeInstanceOf(Date);
  });

  it("marca quando o interruptor global está desligado", async () => {
    const original = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
    await prisma.botConfig.update({ where: { id: BOT_CONFIG_ID }, data: { ativo: false } });
    try {
      const conversa = await criarConversation();
      await criarMensagemEntrada(conversa.id, { texto: "bom dia" });

      await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

      expect(await aguardandoDe(conversa.id)).toBeInstanceOf(Date);
    } finally {
      await prisma.botConfig.update({
        where: { id: BOT_CONFIG_ID },
        data: { ativo: original.ativo },
      });
    }
  });

  // O caso que, se quebrar, enche o sino de conversas que estão sendo
  // atendidas normalmente pela IA — e a equipe para de olhar o sino.
  it("NÃO marca quando a IA responde normalmente", async () => {
    const conversa = await criarConversation();
    await criarMensagemEntrada(conversa.id, { texto: "quanto custa?" });
    enviarTextoMock.mockResolvedValue({ idExterno: `teste-${crypto.randomUUID()}` });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    expect(await aguardandoDe(conversa.id)).toBeNull();
  });

  it("a resposta da IA limpa uma espera anterior", async () => {
    const conversa = await criarConversation();
    await prisma.conversation.update({
      where: { id: conversa.id },
      data: { aguardandoHumanoDesde: new Date() },
    });
    await criarMensagemEntrada(conversa.id, { texto: "voltei" });
    enviarTextoMock.mockResolvedValue({ idExterno: `teste-${crypto.randomUUID()}` });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    expect(await aguardandoDe(conversa.id)).toBeNull();
  });
});
```

Limpe as notificações criadas por estes testes no `afterEach` do arquivo, junto da
limpeza de conversas que ele já faz — senão o sino do banco de desenvolvimento acumula
avisos de teste.

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-turno.test.ts -t "aguardando humano"`
Esperado: FALHA — o campo nunca é preenchido.

- [ ] **Passo 3: Ligar nos três pontos sem resposta**

Em `src/modules/whatsapp/turno.ts`, importe o serviço:

```ts
import { limparAguardandoHumano, marcarAguardandoHumano } from "./notificacoes";
```

Há hoje quatro chamadas a `marcarPendentesComoProcessadas`. Acrescente
`await marcarAguardandoHumano(conversationId);` **logo depois** das três primeiras — a
guarda de entrada (interruptor global ou conversa pausada), o teto por hora, e o aborto
pós-modelo por `ia-pausada`.

Depois da **quarta** (o envio bem-sucedido da IA), acrescente
`await limparAguardandoHumano(conversationId);` no lugar — a IA falou com o cliente,
ninguém está mais esperando.

Depois de marcar as pendentes e não antes: se a marcação falhar, o turno lança e o job
é reentregue; marcar o aguardando primeiro deixaria a conversa sinalizada por um
trabalho que não terminou.

- [ ] **Passo 4: Escrever o teste da resposta humana (falha)**

Acrescente a `tests/unit/whatsapp-agente.test.ts`:

```ts
it("responder como humano limpa o estado de espera", async () => {
  const conversa = await criarConversation();
  await prisma.conversation.update({
    where: { id: conversa.id },
    data: { aguardandoHumanoDesde: new Date() },
  });
  enviarTextoMock.mockResolvedValueOnce({ idExterno: `teste-${crypto.randomUUID()}` });

  await responderComoHumano(conversa.id, "Oi! Já te ajudo.", ID_DO_ADMIN);

  const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
  expect(depois.aguardandoHumanoDesde).toBeNull();
});

// Se limpasse antes do envio, uma falha de gateway deixaria a conversa
// parecendo atendida — e ela sumiria do topo da lista sem ninguém ter falado
// com o cliente. Mesmo raciocínio da ordem pausa → envia → grava.
it("falha de envio NÃO limpa o estado de espera", async () => {
  const conversa = await criarConversation();
  await prisma.conversation.update({
    where: { id: conversa.id },
    data: { aguardandoHumanoDesde: new Date() },
  });
  enviarTextoMock.mockRejectedValueOnce(new Error("gateway fora do ar"));

  await expect(responderComoHumano(conversa.id, "teste", ID_DO_ADMIN)).rejects.toThrow();

  const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
  expect(depois.aguardandoHumanoDesde).not.toBeNull();
});
```

- [ ] **Passo 5: Ligar em `responderComoHumano`**

Em `src/modules/whatsapp/agente.ts`, importe `limparAguardandoHumano` de
`./notificacoes` e chame-o **depois** do `prisma.whatsappMessage.create`, no fim da
função. Nunca antes do envio: limpar cedo faria uma falha de gateway apagar o sinal de
que o cliente ainda espera.

- [ ] **Passo 6: Rodar os testes**

Executar: `npx vitest run tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts`
Esperado: PASSA — os novos e todos os antigos.

- [ ] **Passo 7: Conferir lint e tipos, e o banco**

Executar: `npx eslint src/modules/whatsapp/ && npx tsc --noEmit`

Depois, por consulta direta ao banco, confirme que não sobrou notificação de teste
(`tipo = "CONVERSA_AGUARDANDO"`) nem conversa com prefixo `teste-`. Evidência produzida
na hora, não inferida de o teste ter passado.

- [ ] **Passo 8: Commit**

```bash
git add src/modules/whatsapp/turno.ts src/modules/whatsapp/agente.ts tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts
git commit -m "feat: turno e resposta humana atualizam o estado de espera"
```

---

### Task 3: Sino e lista de conversas

**Arquivos:**
- Modificar: `src/components/notifications/notification-bell.tsx`
- Modificar: `src/modules/whatsapp/queries.ts`
- Modificar: `src/app/(painel)/conversas/page.tsx`
- Criar: `tests/unit/notification-bell-conversa.test.tsx`

**Interfaces:**
- Consome: `extrairPayloadConversaAguardando`, `TIPO_CONVERSA_AGUARDANDO` (Task 1);
  `Conversation.aguardandoHumanoDesde` (Task 1).
- Produz: `listarConversas()` passa a ordenar por espera.

- [ ] **Passo 1: Escrever o teste do sino (falha)**

```tsx
// @vitest-environment jsdom
// tests/unit/notification-bell-conversa.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mesmo padrão de `painel-nav.test.tsx`: a action importa a cadeia que passa
// por `server-only`, que sempre lança sob Vitest.
vi.mock("@/core/notifications/actions", () => ({
  marcarNotificacaoComoLidaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { NotificationBell } = await import(
  "../../src/components/notifications/notification-bell"
);

describe("NotificationBell — conversa aguardando", () => {
  afterEach(cleanup);

  it("mostra o nome da conversa e link para ela", async () => {
    render(
      <NotificationBell
        notificacoes={[
          {
            id: "n1",
            tipo: "CONVERSA_AGUARDANDO",
            payload: { conversationId: "c1", nomeExibicao: "Maria Souza" },
            criadoEm: new Date(),
          },
        ]}
      />
    );

    // O sino abre num clique — siga o padrão que os testes existentes usam
    // para abrir o popover antes de assertar.
    expect(await screen.findByText(/Maria Souza/)).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Ver conversa/i });
    expect(link.getAttribute("href")).toBe("/conversas/c1");
  });

  // Sem isto, um payload malformado (ou um tipo futuro) derrubaria o sino
  // inteiro em vez de degradar naquela linha.
  it("não quebra com payload malformado", () => {
    render(
      <NotificationBell
        notificacoes={[
          { id: "n2", tipo: "CONVERSA_AGUARDANDO", payload: { foo: "bar" }, criadoEm: new Date() },
        ]}
      />
    );
    expect(screen.getByRole("button")).toBeTruthy();
  });
});
```

Confira a assinatura real das props de `NotificationBell` antes de escrever — o teste
acima assume `notificacoes`, e se o nome for outro, use o real.

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/notification-bell-conversa.test.tsx`
Esperado: FALHA — o sino cai no fallback "Notificação" e não há link.

- [ ] **Passo 3: Acrescentar o ramo no sino**

Em `src/components/notifications/notification-bell.tsx`, junto do
`const dadosNovoLead = ...` existente:

```tsx
                const dadosConversa =
                  notificacao.tipo === TIPO_CONVERSA_AGUARDANDO
                    ? extrairPayloadConversaAguardando(notificacao.payload)
                    : null;
```

E no JSX, um ramo antes do fallback `<p>Notificação</p>`:

```tsx
                      ) : dadosConversa ? (
                        <>
                          <p>Conversa aguardando: {dadosConversa.nomeExibicao}</p>
                          <Link
                            href={`/conversas/${dadosConversa.conversationId}`}
                            className="text-xs text-primary underline"
                            onClick={() => setAberto(false)}
                          >
                            Ver conversa
                          </Link>
                        </>
```

Importe de `@/modules/whatsapp/notificacao-tipos`. Isto é permitido: a regra de
fronteira restringe só arquivos dentro de `src/core/`, e este componente está em
`src/components/`.

- [ ] **Passo 4: Escrever o teste da ordenação (falha)**

Sem este teste nada prova a ordem — o e2e só confere que o selo aparece, e trocar `asc`
por `desc` continuaria passando enquanto esconde exatamente as conversas que mais
esperam.

```ts
// acrescente a tests/unit/whatsapp-notificacoes.test.ts (mesmos mocks e limpeza)
it("listarConversas põe quem aguarda no topo, mais antiga primeiro", async () => {
  const recenteSemEspera = await criarConversation();
  const esperaNova = await criarConversation();
  const esperaAntiga = await criarConversation();

  await prisma.conversation.update({
    where: { id: esperaNova.id },
    data: { aguardandoHumanoDesde: new Date(Date.now() - 5 * 60_000) },
  });
  await prisma.conversation.update({
    where: { id: esperaAntiga.id },
    data: { aguardandoHumanoDesde: new Date(Date.now() - 60 * 60_000) },
  });

  const lista = await listarConversas();
  const posicao = (id: string) => lista.findIndex((c) => c.id === id);

  expect(posicao(esperaAntiga.id)).toBeLessThan(posicao(esperaNova.id));
  expect(posicao(esperaNova.id)).toBeLessThan(posicao(recenteSemEspera.id));
});
```

Note que `recenteSemEspera` é criada **primeiro** de propósito: sendo a mais antiga por
`atualizadoEm`, ela iria para o fim mesmo sem a regra nova, e o teste passaria por
acaso. Toque-a por último (um `update` qualquer) para que ela seja a mais recente e o
teste só passe se a ordenação por espera de fato tiver precedência.

- [ ] **Passo 5: Ordenar a lista**

Em `src/modules/whatsapp/queries.ts`, em `listarConversas()`:

```ts
    orderBy: [
      { aguardandoHumanoDesde: { sort: "asc", nulls: "last" } },
      { atualizadoEm: "desc" },
    ],
```

Quem espera há mais tempo vai ao topo; o resto segue por atividade recente, como hoje.

`nulls: "last"` explícito de propósito: o padrão do Postgres em `ASC` já é esse, então
omitir funcionaria — por acaso. "Por acaso" deixa de valer no dia em que alguém trocar
para `desc`, e a falha é silenciosa (conversas sem espera sobem ao topo e escondem as
que esperam).

- [ ] **Passo 6: Mostrar a espera na lista**

Em `src/app/(painel)/conversas/page.tsx`, na linha de cada conversa, junto do selo de
"IA pausada" que já existe:

```tsx
{conversa.aguardandoHumanoDesde && (
  <Badge variant="destructive">
    Aguardando há {formatarDuracaoDesde(conversa.aguardandoHumanoDesde)}
  </Badge>
)}
```

`src/lib/date.ts` **não tem** formatador de duração — conferido. Escreva um lá, junto
dos outros:

```ts
/**
 * Duração curta desde `data` até agora, em português: "agora", "3 min", "2 h",
 * "1 d". Para a lista de conversas, onde o número importa mais que a precisão:
 * quem espera há 40 minutos precisa ser distinguível de quem espera há 4, e
 * ninguém precisa dos segundos.
 *
 * Recebe `agora` por argumento (com default) para o teste não precisar
 * congelar relógio — mesmo motivo de `montarPromptSistema` receber a config
 * em vez de lê-la.
 */
export function formatarDuracaoDesde(data: Date, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - data.getTime()) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;
  return `${Math.floor(horas / 24)} d`;
}
```

E cubra-o no arquivo de teste de `date.ts` (confirme o nome real em `tests/unit/`),
incluindo as fronteiras: 0 minutos, 59 minutos, 60 minutos, 23 h, 24 h.

- [ ] **Passo 7: Rodar os testes e conferir**

Executar: `npx vitest run tests/unit/notification-bell-conversa.test.tsx && npx eslint src/components/ src/modules/whatsapp/ "src/app/(painel)/conversas" && npx tsc --noEmit`
Esperado: tudo limpo.

- [ ] **Passo 8: Commit**

```bash
git add src/components/notifications/notification-bell.tsx src/modules/whatsapp/queries.ts "src/app/(painel)/conversas/page.tsx" src/lib/date.ts tests/unit/notification-bell-conversa.test.tsx
git commit -m "feat: aviso de conversa aguardando no sino e na lista"
```

---

### Task 4: E2E do ciclo

**Arquivos:**
- Modificar: `tests/e2e/whatsapp-agente.spec.ts`

**Interfaces:**
- Consome: tudo das tarefas anteriores.

- [ ] **Passo 1: Acrescentar o teste**

O arquivo já está em `test.describe.configure({ mode: "serial" })` — **mantenha assim**.
O comentário no topo explica por quê: `beforeAll`/`afterAll` do Playwright rodam por
worker, não por arquivo, e a limpeza é por prefixo compartilhado; sem o modo serial,
grupos concorrentes apagam dados um do outro.

```ts
test("conversa pausada aparece como aguardando na lista", async ({ page }) => {
  const conversa = await prisma.conversation.create({
    data: {
      waId: `e2e-agente-${crypto.randomUUID()}`,
      telefone: "5511999990000",
      iaAtiva: false,
      aguardandoHumanoDesde: new Date(),
    },
  });

  await login(page);
  await page.goto("/conversas");

  const linha = page.getByRole("row").filter({ hasText: conversa.telefone! });
  await expect(linha.getByText(/Aguardando há/)).toBeVisible();
});
```

Escope a asserção à linha da conversa criada, não à página inteira — o banco é
compartilhado e outra conversa aguardando faria a asserção passar pelo motivo errado,
que num teste é pior que falhar.

- [ ] **Passo 2: Rodar**

Executar: `npm run test:e2e`
Esperado: todos passam. Nunca `npx playwright test` direto.

Depois, confirme por consulta ao banco que nenhuma linha com prefixo `e2e-agente-`
sobrou.

- [ ] **Passo 3: Commit**

```bash
git add tests/e2e/whatsapp-agente.spec.ts
git commit -m "test: e2e do estado de espera na lista de conversas"
```

---

## Verificação que só um humano pode fazer

1. Pausar uma conversa real, mandar mensagem do celular do cliente, e confirmar que o
   sino acende para **todos** os usuários — não só para quem pausou.
2. Confirmar que uma segunda mensagem do cliente **não** gera segundo aviso.
3. Responder pela inbox e confirmar que a conversa sai do topo da lista.
4. Confirmar o que a spec já nomeia como limitação: responder **pelo celular do
   vendedor**, fora do CRM, não limpa o estado — a conversa fica presa no topo. Vale ver
   o sintoma uma vez para saber reconhecê-lo quando a equipe reclamar.

## Lacuna que este plano não fecha

Conversa marcada como aguardando por engano (§ 8 da spec) só sai do estado quando
alguém responde pelo CRM. Não há botão de "marcar como resolvida" nem expiração
automática. Se isso incomodar na prática, o caminho mais barato é um botão na própria
linha da lista — não um cron.
