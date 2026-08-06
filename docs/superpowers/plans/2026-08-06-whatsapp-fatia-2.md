# WhatsApp Fatia 2 — Controle do agente pelo CRM · Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** dar ao CRM três controles sobre o atendente de WhatsApp — pausar/religar
a IA por conversa, editar persona/regras/FAQ do agente, e responder ao cliente pela
inbox — sem que nada disso exija deploy.

**Arquitetura:** `config/bot.ts` deixa de ser lido no caminho de resposta e passa a
semear uma tabela `BotConfig` de linha única; `montarPromptSistema()` recebe essa
config como argumento em vez de importar o arquivo; `turno.ts` ganha uma guarda que
cala a IA quando o interruptor global está desligado ou a conversa está pausada; e o
envio humano pausa a IA **antes** de enviar, para que nenhuma falha deixe os dois
falando ao mesmo tempo.

**Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 com `@prisma/adapter-pg`,
PostgreSQL (Supabase, transaction pooler), Vitest (unitários contra o banco real),
Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-06-whatsapp-fatia-2-design.md`

## Restrições globais

Valem para **todas** as tarefas — não repetidas em cada uma:

- **Idioma:** identificadores, comentários e texto de UI em **português do Brasil**.
  O código existente é assim; misturar idiomas agora deixaria o módulo bilíngue.
- **RLS não é automática.** Toda tabela nova exige `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY` e `REVOKE ALL ON TABLE ... FROM anon, authenticated` **escritos à mão** na
  migração. O Prisma não emite nenhum dos dois.
- **Migrações precisam da `DIRECT_URL`** (session pooler, porta 5432) no `.env`. Com a
  `DATABASE_URL` de transaction pooler, `prisma migrate` **pendura sem imprimir nada**.
- **`usuarioAtual()` é o único jeito de saber quem está agindo.** Nunca aceite
  `usuarioId` vindo de formulário — Server Action é endpoint HTTP público.
- **Nunca ler, imprimir ou commitar o `.env`.**
- **E2E só via `npm run test:e2e`** (encadeia a guarda de porta). Nunca `npx playwright
  test` direto.
- **O banco de desenvolvimento é real e compartilhado.** Testes limpam apenas as linhas
  que eles próprios criaram.
- **Commits em português**, no padrão `feat:` / `fix:` / `test:` / `docs:` já usado.

---

### Task 1: Schema, migração e seed do `BotConfig`

**Arquivos:**
- Modificar: `prisma/schema.prisma` (modelo `Conversation`, modelo `User`, novo modelo `BotConfig`)
- Criar: `prisma/migrations/<timestamp>_whatsapp_fatia_2_bot_config/migration.sql` (gerada, depois editada à mão)
- Modificar: `config/bot.ts`
- Modificar: `prisma/seed.ts`
- Testar: `tests/unit/bot-config-seed.test.ts`

**Interfaces:**
- Produz: `BotConfigPadrao` (interface em `config/bot.ts`, campos `persona: {nome, papel}`,
  `regras: string[]`, `faq: string`); `botConfig: BotConfigPadrao`;
  `BOT_CONFIG_ID = "bot-config"` exportado de `config/bot.ts`;
  modelo Prisma `BotConfig` com `id, ativo, personaNome, personaPapel, regras, faq,
  atualizadoEm, atualizadoPorId`; `Conversation.iaAtiva/iaPausadaEm/iaPausadaPorId`.

- [ ] **Passo 1: Renomear a interface do config e adicionar `faq`**

Em `config/bot.ts`, a interface passa a se chamar `BotConfigPadrao` — o nome `BotConfig`
fica reservado para o modelo Prisma, e os dois se encontram no mesmo arquivo na ação de
restaurar (Task 7).

```ts
/** Id fixo da linha única de `BotConfig`. Ver o modelo em prisma/schema.prisma. */
export const BOT_CONFIG_ID = "bot-config";

export interface BotConfigPadrao {
  persona: {
    nome: string;
    papel: string;
  };
  regras: string[];
  faq: string;
}

export const botConfig: BotConfigPadrao = {
  persona: {
    nome: "Ana",
    papel: "atendente virtual da AutoCenter Exemplo, uma revenda de veículos",
  },
  regras: [
    // ...as sete regras existentes, sem alteração...
  ],
  faq: [
    "Horário de atendimento: segunda a sexta das 8h às 18h, sábado das 8h às 13h.",
    "Endereço: (preencha o endereço da loja aqui).",
    "Aceitamos troca como parte do pagamento, com avaliação presencial do veículo.",
    "Trabalhamos com financiamento pelos principais bancos — a aprovação depende de análise.",
  ].join("\n"),
};
```

Atualize também o comentário de topo do arquivo: ele hoje diz que a Fatia 3 versiona
isto "de verdade, com FAQ e ferramentas". A FAQ chega agora; o que fica para a Fatia 3
é o catálogo com ferramentas. Um comentário que aponta para a fatia errada é o começo
de alguém procurar código que não existe.

- [ ] **Passo 2: Escrever o teste do seed (falha)**

```ts
// tests/unit/bot-config-seed.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { BOT_CONFIG_ID, botConfig } from "../../config/bot";
import { semearBotConfig } from "../../prisma/seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

describe("seed do BotConfig", () => {
  beforeAll(async () => {
    await prisma.botConfig.deleteMany({ where: { id: BOT_CONFIG_ID } });
  });

  it("cria a linha única a partir de config/bot.ts", async () => {
    await semearBotConfig();
    const linha = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
    expect(linha.personaNome).toBe(botConfig.persona.nome);
    expect(linha.regras).toEqual(botConfig.regras);
    expect(linha.faq).toBe(botConfig.faq);
    expect(linha.ativo).toBe(true);
  });

  // O teste que importa: o seed roda em todo deploy. Se ele sobrescrevesse,
  // toda edição feita pelo CRM seria desfeita no deploy seguinte -- e de forma
  // silenciosa, que é o pior jeito de perder configuração.
  it("NÃO sobrescreve o que foi editado pelo CRM", async () => {
    await prisma.botConfig.update({
      where: { id: BOT_CONFIG_ID },
      data: { personaNome: "Editado pelo CRM" },
    });

    await semearBotConfig();

    const linha = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
    expect(linha.personaNome).toBe("Editado pelo CRM");
  });
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/bot-config-seed.test.ts`
Esperado: FALHA — `semearBotConfig` não existe e `prisma.botConfig` não existe.

- [ ] **Passo 4: Adicionar os modelos ao schema**

Em `prisma/schema.prisma`, dentro de `model Conversation`, some os três campos e o
índice:

```prisma
  iaAtiva        Boolean           @default(true)
  iaPausadaEm    DateTime?
  iaPausadaPorId String?
  iaPausadaPor   User?             @relation("ConversasPausadas", fields: [iaPausadaPorId], references: [id])
```

E o modelo novo:

```prisma
/// Configuração do agente de IA — LINHA ÚNICA, id fixo `bot-config`.
///
/// A unicidade é imposta pelo banco, não por convenção: `id` tem valor default
/// constante, então um segundo `create` sem id explícito colide na chave
/// primária. Nenhum código precisa perguntar "qual das linhas é a certa".
///
/// Semeada por `prisma/seed.ts` a partir de `config/bot.ts`. Em runtime a
/// verdade é ESTA tabela — `config/bot.ts` só é lido pelo seed e pela ação
/// explícita de restaurar ao padrão do fork, nunca no caminho de resposta ao
/// cliente.
model BotConfig {
  id              String   @id @default("bot-config")
  ativo           Boolean  @default(true)
  personaNome     String
  personaPapel    String
  regras          String[]
  faq             String   @default("")
  atualizadoEm    DateTime @updatedAt
  atualizadoPorId String?
  atualizadoPor   User?    @relation("BotConfigsEditadas", fields: [atualizadoPorId], references: [id])
}
```

Em `model User`, as duas relações inversas (o Prisma exige o outro lado):

```prisma
  conversasPausadas Conversation[] @relation("ConversasPausadas")
  botConfigsEditadas BotConfig[]   @relation("BotConfigsEditadas")
```

- [ ] **Passo 5: Gerar a migração**

Executar: `npx prisma migrate dev --name whatsapp_fatia_2_bot_config --create-only`

O `--create-only` é obrigatório aqui: a migração precisa ser **editada antes de
aplicar**, para acrescentar RLS. Aplicar primeiro e corrigir depois deixa uma janela
(mesmo que só em desenvolvimento) com a tabela exposta.

- [ ] **Passo 6: Acrescentar RLS à migração à mão**

No fim do `migration.sql` gerado, antes de aplicar:

```sql
-- O Prisma não emite RLS nem REVOKE para modelo novo. A migração
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automáticos de objetos futuros (suspensório), mas ALTER DEFAULT PRIVILEGES
-- não liga RLS -- isso continua sendo por tabela, à mão (cinto). Mesmo par de
-- linhas que a migração da Fatia 1 escreveu para Conversation/WhatsappMessage.
--
-- Vale especialmente para esta tabela: ela guarda o prompt do agente, que é o
-- ativo comercial da fatia. Sem RLS, é leitura pública pela API PostgREST.
ALTER TABLE "BotConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BotConfig" FROM anon, authenticated;
```

- [ ] **Passo 7: Aplicar a migração**

Executar: `npx prisma migrate dev`
Esperado: aplica em segundos e imprime "Your database is now in sync with your schema".
Se pendurar sem saída, falta a `DIRECT_URL` no `.env` — não é lentidão.

- [ ] **Passo 8: Escrever `semearBotConfig` no seed**

Em `prisma/seed.ts`, ao lado de `semearUsuarioSistemaWhatsapp` (mesmo idioma de
"cria se não existe, nunca atualiza"):

```ts
/**
 * Semeia a linha única de `BotConfig` a partir de `config/bot.ts`.
 *
 * Cria se não existe; NUNCA atualiza. O seed roda em todo deploy — um upsert
 * aqui desfaria, silenciosamente, toda edição feita pelo CRM desde o deploy
 * anterior. Mesmo raciocínio de `semearUsuarioSistemaWhatsapp` logo abaixo, e
 * deliberadamente DIFERENTE do upsert usado para `PipelineStage`: aquelas são
 * estrutura definida pelo fork, esta é conteúdo editável pelo usuário.
 *
 * Para voltar ao conteúdo do arquivo existe um caminho explícito: o botão
 * "voltar ao padrão do fork" na tela do agente.
 */
export async function semearBotConfig(): Promise<void> {
  const existente = await prisma.botConfig.findUnique({ where: { id: BOT_CONFIG_ID } });
  if (existente) return;

  await prisma.botConfig.create({
    data: {
      id: BOT_CONFIG_ID,
      personaNome: botConfig.persona.nome,
      personaPapel: botConfig.persona.papel,
      regras: botConfig.regras,
      faq: botConfig.faq,
    },
  });
}
```

Importe `BOT_CONFIG_ID` e `botConfig` de `../config/bot` no topo, e chame
`await semearBotConfig();` dentro de `seed()`, junto das outras semeaduras.

- [ ] **Passo 9: Rodar os testes**

Executar: `npx vitest run tests/unit/bot-config-seed.test.ts`
Esperado: PASSA (2 testes).

- [ ] **Passo 10: Provar a RLS ao vivo**

Não basta a linha estar no arquivo — o que importa é o estado do banco:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'BotConfig';
SQL
```

Esperado: `relrowsecurity = t`. Se vier `f`, a migração foi aplicada sem a edição do
Passo 6.

- [ ] **Passo 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts config/bot.ts tests/unit/bot-config-seed.test.ts
git commit -m "feat: tabela BotConfig de linha única semeada por config/bot.ts"
```

---

### Task 2: `montarPromptSistema` recebe a config

**Arquivos:**
- Modificar: `src/modules/whatsapp/prompt.ts`
- Modificar: `tests/unit/whatsapp-prompt.test.ts` (se existir; senão criar)
- Modificar: `src/modules/whatsapp/turno.ts:233` (só a chamada, para o build não quebrar)

**Interfaces:**
- Consome: nada da Task 1 em tempo de compilação (o tipo é estrutural).
- Produz: `type ConfigDoPrompt = { personaNome: string; personaPapel: string; regras: string[]; faq: string }`
  e `montarPromptSistema(config: ConfigDoPrompt): string`.

- [ ] **Passo 1: Escrever os testes (falham)**

```ts
// tests/unit/whatsapp-prompt.test.ts
import { describe, it, expect } from "vitest";
import { montarPromptSistema } from "../../src/modules/whatsapp/prompt";

const BASE = {
  personaNome: "Ana",
  personaPapel: "atendente da Loja X",
  regras: ["Seja breve.", "Não invente preço."],
  faq: "",
};

describe("montarPromptSistema", () => {
  it("usa a persona e numera as regras", () => {
    const prompt = montarPromptSistema(BASE);
    expect(prompt).toContain("Você é Ana, atendente da Loja X.");
    expect(prompt).toContain("1. Seja breve.");
    expect(prompt).toContain("2. Não invente preço.");
  });

  it("inclui a FAQ sob cabeçalho próprio quando há conteúdo", () => {
    const prompt = montarPromptSistema({ ...BASE, faq: "Abrimos às 8h." });
    expect(prompt).toContain("Perguntas frequentes");
    expect(prompt).toContain("Abrimos às 8h.");
  });

  // Cabeçalho sem conteúdo é pior que FAQ nenhuma: o modelo lê como
  // instrução truncada e pode inventar o que "deveria" estar ali.
  it("omite o bloco inteiro da FAQ quando ela está vazia", () => {
    expect(montarPromptSistema({ ...BASE, faq: "" })).not.toContain("Perguntas frequentes");
    expect(montarPromptSistema({ ...BASE, faq: "   \n  " })).not.toContain("Perguntas frequentes");
  });

  // A razão de a função ser pura, registrada como teste e não só como
  // comentário: provedores cacheiam o prefixo do prompt byte-a-byte.
  it("é determinística — mesma config, mesmos bytes", () => {
    expect(montarPromptSistema(BASE)).toBe(montarPromptSistema(BASE));
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-prompt.test.ts`
Esperado: FALHA — `montarPromptSistema` não aceita argumento (erro de tipo) e não
conhece FAQ.

- [ ] **Passo 3: Reescrever `prompt.ts`**

```ts
/**
 * Formato PLANO, igual ao da linha de `BotConfig` no banco — e não ao formato
 * aninhado de `config/bot.ts`. Quem chama em runtime é sempre o banco;
 * converter na borda rara (seed, restauração) é melhor que converter no
 * caminho quente de toda resposta.
 *
 * Declarado aqui como tipo estrutural em vez de importado de
 * `@prisma/client`: este módulo é montagem de texto, não deve depender do
 * client do banco. Mesmo raciocínio de `gateway/tipos.ts`.
 */
export type ConfigDoPrompt = {
  personaNome: string;
  personaPapel: string;
  regras: string[];
  faq: string;
};

/**
 * Monta o prompt de sistema a partir da config do agente.
 *
 * DETERMINÍSTICA de propósito — sem `new Date()`, sem nome do cliente, sem
 * qualquer valor que mude entre chamadas com a mesma config. Isto importa por
 * dois motivos:
 *
 * 1. Cache de prompt: provedores de LLM cacheiam o PREFIXO do prompt quando
 *    ele é byte-a-byte idêntico — um timestamp ali em cima invalidaria esse
 *    cache a cada chamada, triplicando o custo em silêncio.
 * 2. Testabilidade: dada a mesma config, sempre o mesmo texto — trivial de
 *    testar sem congelar relógio nenhum.
 *
 * A config vem por ARGUMENTO, não por leitura interna do banco (Fatia 2): uma
 * consulta escondida dentro de algo que todo mundo trata como função pura é
 * exatamente o tipo de surpresa que este comentário existe para evitar. Quem
 * lê o banco é `turno.ts`, uma vez por turno.
 */
export function montarPromptSistema(config: ConfigDoPrompt): string {
  const linhasRegras = config.regras.map((regra, indice) => `${indice + 1}. ${regra}`).join("\n");

  const blocos = [
    `Você é ${config.personaNome}, ${config.personaPapel}.`,
    "",
    "Regras:",
    linhasRegras,
  ];

  // Bloco omitido INTEIRO quando não há FAQ — cabeçalho sem conteúdo é lido
  // pelo modelo como instrução truncada.
  const faq = config.faq.trim();
  if (faq.length > 0) {
    blocos.push("", "Perguntas frequentes (use estas respostas quando forem aplicáveis):", faq);
  }

  return blocos.join("\n");
}
```

- [ ] **Passo 4: Rodar e ver passar**

Executar: `npx vitest run tests/unit/whatsapp-prompt.test.ts`
Esperado: PASSA (4 testes).

- [ ] **Passo 5: Ajustar a chamada em `turno.ts`**

Só o suficiente para compilar; a leitura de verdade chega na Task 3. Em
`src/modules/whatsapp/turno.ts`, antes do `llmProvider.gerarResposta`:

```ts
    const configBot = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });

    const resultado = await llmProvider.gerarResposta({
      systemPrompt: montarPromptSistema(configBot),
      historico: [...historicoAnterior, { autor: "CLIENTE", texto: textoUnido }],
    });
```

Importe `BOT_CONFIG_ID` de `../../../config/bot`.

`findUniqueOrThrow` de propósito: se o seed não rodou, é melhor falhar alto do que
atender cliente com persona vazia.

- [ ] **Passo 6: Conferir que nada mais quebrou**

Executar: `npx tsc --noEmit && npx vitest run`
Esperado: sem erro de tipo; suíte unitária inteira passa.

- [ ] **Passo 7: Commit**

```bash
git add src/modules/whatsapp/prompt.ts src/modules/whatsapp/turno.ts tests/unit/whatsapp-prompt.test.ts
git commit -m "feat: prompt do agente montado a partir da config do banco, com FAQ"
```

---

### Task 3: Guarda da IA no turno

**Arquivos:**
- Modificar: `src/modules/whatsapp/turno.ts`
- Modificar: `tests/unit/whatsapp-turno.test.ts`

**Interfaces:**
- Consome: `BOT_CONFIG_ID`, `prisma.botConfig`, `Conversation.iaAtiva` (Task 1).
- Produz: `type MotivoAborto = "lease-perdido" | "ia-pausada" | null` e
  `confirmarTitularidadeLease(conversationId, token): Promise<MotivoAborto>` — **muda
  o tipo de retorno**, que hoje é `boolean`.

- [ ] **Passo 1: Escrever os testes (falham)**

Acrescente a `tests/unit/whatsapp-turno.test.ts` — o arquivo já tem os utilitários de
criação de conversa e mensagem; reaproveite-os em vez de escrever novos.

```ts
describe("guarda da IA (Fatia 2)", () => {
  it("não responde quando a conversa está pausada, mas marca as pendentes", async () => {
    const conversa = await criarConversa({ iaAtiva: false });
    await criarMensagemEntrada(conversa.id, "oi, tem o Onix 2020?");

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    expect(enviarTextoMock).not.toHaveBeenCalled();
    const pendentes = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "ENTRADA", processadoEm: null },
    });
    expect(pendentes).toHaveLength(0);
  });

  it("não responde quando o interruptor global está desligado", async () => {
    await prisma.botConfig.update({ where: { id: BOT_CONFIG_ID }, data: { ativo: false } });
    try {
      const conversa = await criarConversa();
      await criarMensagemEntrada(conversa.id, "bom dia");

      await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

      expect(enviarTextoMock).not.toHaveBeenCalled();
    } finally {
      await prisma.botConfig.update({ where: { id: BOT_CONFIG_ID }, data: { ativo: true } });
    }
  });

  // O caso que motiva a mudança de tipo de retorno: pausar DEPOIS que o modelo
  // já respondeu, mas antes do envio. A resposta gerada tem que ser jogada
  // fora -- é dinheiro já gasto, e mandá-la seria falar por cima do humano.
  it("descarta a resposta quando a IA é pausada durante a chamada ao modelo", async () => {
    const conversa = await criarConversa();
    await criarMensagemEntrada(conversa.id, "quero saber o preço");

    gerarRespostaMock.mockImplementationOnce(async () => {
      await prisma.conversation.update({
        where: { id: conversa.id },
        data: { iaAtiva: false, iaPausadaEm: new Date() },
      });
      return { mensagens: ["Resposta que não deve ser enviada"] };
    });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    expect(enviarTextoMock).not.toHaveBeenCalled();
  });

  // A distinção que um booleano não consegue expressar: quem PERDEU o lease
  // não pode marcar as pendentes -- quem assumiu o lease vai respondê-las.
  it("perder o lease NÃO marca as pendentes como processadas", async () => {
    const conversa = await criarConversa();
    await criarMensagemEntrada(conversa.id, "oi");

    gerarRespostaMock.mockImplementationOnce(async () => {
      await prisma.conversation.update({
        where: { id: conversa.id },
        data: { processandoAte: new Date(Date.now() + 60_000) }, // outro dono
      });
      return { mensagens: ["resposta órfã"] };
    });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    const pendentes = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "ENTRADA", processadoEm: null },
    });
    expect(pendentes).toHaveLength(1);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-turno.test.ts -t "guarda da IA"`
Esperado: FALHA — a IA responde mesmo pausada.

- [ ] **Passo 3: Guarda na entrada de `processarMensagensPendentes`**

Logo depois do `if (pendentes.length === 0) return;`, antes da checagem do teto por hora:

```ts
  // Fatia 2: a guarda fica AQUI, não no webhook. A mensagem do cliente
  // continua sendo ingerida e aparece na inbox mesmo com a IA calada — barrar
  // no webhook faria a mensagem sumir, que é o pior comportamento possível
  // numa conversa sob atendimento humano.
  //
  // Mesmo tratamento que o teto de respostas por hora logo abaixo: as
  // pendentes são marcadas como processadas SEM resposta ("persiste mas para
  // de responder", nunca "descarta calado").
  const configBot = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
  const conversaAtual = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { iaAtiva: true },
  });

  if (!configBot.ativo || !conversaAtual.iaAtiva) {
    const motivo = !configBot.ativo ? "interruptor global desligado" : "IA pausada nesta conversa";
    console.info(`Conversa ${conversationId}: ${motivo} — pendentes marcadas sem resposta automática.`);
    await marcarPendentesComoProcessadas(pendentes);
    return;
  }
```

E extraia o helper que agora tem três usos (guarda, teto por hora, envio normal):

```ts
async function marcarPendentesComoProcessadas(pendentes: Array<{ id: string }>): Promise<void> {
  await prisma.whatsappMessage.updateMany({
    where: { id: { in: pendentes.map((mensagem) => mensagem.id) } },
    data: { processadoEm: new Date() },
  });
}
```

Substitua os dois `updateMany` já existentes por chamadas a ele.

- [ ] **Passo 4: Trocar o retorno de `confirmarTitularidadeLease`**

```ts
/**
 * Motivo pelo qual o turno deve abortar antes de enviar — `null` quando pode
 * seguir.
 *
 * Os dois motivos NÃO recebem o mesmo tratamento, e é por isso que isto deixou
 * de ser um booleano na Fatia 2:
 *
 * - `lease-perdido`: outro processador assumiu a conversa e vai responder as
 *   pendentes. Marcá-las aqui as faria sumir sem resposta nenhuma.
 * - `ia-pausada`: um humano assumiu enquanto o modelo pensava. Não há resposta
 *   automática a dar, então as pendentes SÃO marcadas — mesmo tratamento do
 *   teto por hora.
 *
 * Com um booleano só, um dos dois casos fica necessariamente errado.
 */
export type MotivoAborto = "lease-perdido" | "ia-pausada" | null;

export async function confirmarTitularidadeLease(
  conversationId: string,
  token: Date
): Promise<MotivoAborto> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { processandoAte: true, iaAtiva: true },
  });

  if (conversation?.processandoAte?.getTime() !== token.getTime()) return "lease-perdido";
  if (!conversation.iaAtiva) return "ia-pausada";
  return null;
}
```

- [ ] **Passo 5: Tratar os dois motivos no chamador**

Substitua o bloco `const aindaSouTitular = ...` por:

```ts
  const motivoAborto = await confirmarTitularidadeLease(conversationId, meuToken);
  if (motivoAborto === "lease-perdido") {
    console.warn(
      `Turno da conversa ${conversationId} abortado antes de enviar: outro processador assumiu o ` +
        `lease enquanto este aguardava o modelo. Resposta gerada descartada para não duplicar envio.`
    );
    return;
  }
  if (motivoAborto === "ia-pausada") {
    console.info(
      `Turno da conversa ${conversationId} abortado antes de enviar: um humano assumiu a conversa ` +
        `enquanto o modelo respondia. Resposta gerada descartada.`
    );
    await marcarPendentesComoProcessadas(pendentes);
    return;
  }
```

- [ ] **Passo 6: Provar que o prompt vem do BANCO, não do arquivo**

Este é o teste que prova a promessa comercial da fatia — editar sem deploy. Sem ele,
nada distingue "lê do banco" de "lê do arquivo", porque os dois têm o mesmo conteúdo
logo depois do seed.

```ts
it("monta o prompt a partir do banco, não de config/bot.ts", async () => {
  const original = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
  await prisma.botConfig.update({
    where: { id: BOT_CONFIG_ID },
    data: { personaNome: "Beatriz-do-teste" },
  });

  try {
    const conversa = await criarConversa();
    await criarMensagemEntrada(conversa.id, "oi");
    enviarTextoMock.mockResolvedValue({ idExterno: `wamid.${conversa.id}` });

    await processarTurno({ conversationId: conversa.id, seq: conversa.bufferSeq });

    const [chamada] = gerarRespostaMock.mock.calls.at(-1)!;
    expect(chamada.systemPrompt).toContain("Beatriz-do-teste");
    expect(chamada.systemPrompt).not.toContain(botConfig.persona.nome);
  } finally {
    await prisma.botConfig.update({
      where: { id: BOT_CONFIG_ID },
      data: { personaNome: original.personaNome },
    });
  }
});
```

- [ ] **Passo 7: Rodar os testes**

Executar: `npx vitest run tests/unit/whatsapp-turno.test.ts`
Esperado: PASSA — os 5 novos e todos os antigos (o fencing token continua provado).

- [ ] **Passo 8: Commit**

```bash
git add src/modules/whatsapp/turno.ts tests/unit/whatsapp-turno.test.ts
git commit -m "feat: IA cala quando a conversa esta pausada ou o interruptor global desligado"
```

---

### Task 4: Serviço de pausa e religamento

**Arquivos:**
- Criar: `src/modules/whatsapp/agente.ts`
- Criar: `tests/unit/whatsapp-agente.test.ts`

**Interfaces:**
- Consome: `Conversation.iaAtiva/iaPausadaEm/iaPausadaPorId` (Task 1).
- Produz: `pausarIa(conversationId, usuarioId)`, `religarIa(conversationId)`,
  `lerConfigBot()`, `salvarConfigBot(dados, usuarioId)` — todas assíncronas, todas
  em `src/modules/whatsapp/agente.ts`.

- [ ] **Passo 1: Extrair os helpers de teste para um arquivo compartilhado**

`tests/unit/whatsapp-turno.test.ts` já cria conversas e mensagens; a partir daqui três
arquivos de teste precisam disso. Mova para `tests/unit/helpers/whatsapp.ts` e importe
de volta no arquivo original (que deve continuar passando sem nenhuma outra mudança).

```ts
// tests/unit/helpers/whatsapp.ts
import { prisma } from "./prisma-teste"; // ou o client que whatsapp-turno.test.ts já usa

/** Ids das contas semeadas — ver prisma/seed.ts. Resolvidos por e-mail para não
 *  fixar cuid nenhum no teste. */
export async function idsDeUsuariosSemeados() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
  const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });
  return { ID_DO_ADMIN: admin.id, ID_DO_VENDEDOR: vendedor.id };
}

/** Conversa de teste com `waId` único — sem colidir com dado real do banco
 *  compartilhado, e reconhecível para limpeza. */
export async function criarConversa(dados: { iaAtiva?: boolean } = {}) {
  return prisma.conversation.create({
    data: {
      waId: `teste-${crypto.randomUUID()}`,
      telefone: "5511999990000",
      iaAtiva: dados.iaAtiva ?? true,
    },
  });
}

export async function criarMensagemEntrada(conversationId: string, texto: string) {
  return prisma.whatsappMessage.create({
    data: {
      conversationId,
      idExterno: `teste-${crypto.randomUUID()}`,
      direcao: "ENTRADA",
      autor: "CLIENTE",
      tipo: "TEXTO",
      texto,
    },
  });
}

/** Remove só o que os testes criaram (prefixo `teste-`). O banco de
 *  desenvolvimento é real e compartilhado. */
export async function limparConversasDeTeste() {
  await prisma.conversation.deleteMany({ where: { waId: { startsWith: "teste-" } } });
}
```

Confirme os e-mails semeados em `prisma/seed.ts` antes de escrever — se forem outros,
use os de lá.

- [ ] **Passo 2: Escrever os testes (falham)**

```ts
// tests/unit/whatsapp-agente.test.ts
import { describe, it, expect } from "vitest";
import { pausarIa, religarIa } from "../../src/modules/whatsapp/agente";
import { criarConversa, idsDeUsuariosSemeados, limparConversasDeTeste } from "./helpers/whatsapp";

describe("pausar e religar a IA", () => {
  it("pausar grava quem pausou e quando", async () => {
    const conversa = await criarConversa();
    await pausarIa(conversa.id, ID_DO_ADMIN);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);
    expect(depois.iaPausadaPorId).toBe(ID_DO_ADMIN);
    expect(depois.iaPausadaEm).toBeInstanceOf(Date);
  });

  // Sem isto, um segundo humano entrando na conversa reescreveria a autoria
  // da pausa -- e a tela passaria a mostrar a pessoa errada.
  it("pausar de novo não reescreve quem pausou primeiro", async () => {
    const conversa = await criarConversa();
    await pausarIa(conversa.id, ID_DO_ADMIN);
    const primeira = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    await pausarIa(conversa.id, ID_DO_VENDEDOR);
    const segunda = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    expect(segunda.iaPausadaPorId).toBe(ID_DO_ADMIN);
    expect(segunda.iaPausadaEm?.getTime()).toBe(primeira.iaPausadaEm?.getTime());
  });

  it("religar limpa o estado da pausa", async () => {
    const conversa = await criarConversa();
    await pausarIa(conversa.id, ID_DO_ADMIN);
    await religarIa(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(true);
    expect(depois.iaPausadaEm).toBeNull();
    expect(depois.iaPausadaPorId).toBeNull();
  });
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-agente.test.ts`
Esperado: FALHA — módulo `agente.ts` não existe.

- [ ] **Passo 4: Escrever `agente.ts`**

```ts
import "server-only";

import { prisma } from "@/lib/prisma";
import { BOT_CONFIG_ID } from "../../../config/bot";

/**
 * Pausa a IA numa conversa. Idempotente e NÃO reescreve a autoria: se a
 * conversa já está pausada, quem pausou primeiro continua registrado.
 *
 * O `updateMany` com `iaAtiva: true` no filtro é o que garante isso em uma
 * única instrução — dois humanos abrindo a mesma conversa ao mesmo tempo não
 * disputam a autoria, e o segundo simplesmente afeta 0 linhas. Mesmo idioma
 * de UPDATE condicional usado no lease (`turno.ts`) e no rate limit.
 */
export async function pausarIa(conversationId: string, usuarioId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, iaAtiva: true },
    data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: usuarioId },
  });
}

/** Religa a IA e limpa o estado da pausa. Idempotente. */
export async function religarIa(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { iaAtiva: true, iaPausadaEm: null, iaPausadaPorId: null },
  });
}

export async function lerConfigBot() {
  return prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
}

export async function salvarConfigBot(
  dados: { ativo: boolean; personaNome: string; personaPapel: string; regras: string[]; faq: string },
  usuarioId: string
) {
  return prisma.botConfig.update({
    where: { id: BOT_CONFIG_ID },
    data: { ...dados, atualizadoPorId: usuarioId },
  });
}
```

- [ ] **Passo 5: Rodar e ver passar**

Executar: `npx vitest run tests/unit/whatsapp-agente.test.ts tests/unit/whatsapp-turno.test.ts`
Esperado: PASSA — os 3 novos, e o arquivo de turno continua passando depois da extração
dos helpers.

- [ ] **Passo 6: Commit**

```bash
git add src/modules/whatsapp/agente.ts tests/unit/whatsapp-agente.test.ts tests/unit/helpers/whatsapp.ts tests/unit/whatsapp-turno.test.ts
git commit -m "feat: servico de pausa e religamento da IA por conversa"
```

---

### Task 5: Envio humano — pausa, envia, grava

**Arquivos:**
- Modificar: `src/modules/whatsapp/agente.ts`
- Criar: `src/core/whatsapp/actions.ts`
- Modificar: `tests/unit/whatsapp-agente.test.ts`

**Interfaces:**
- Consome: `pausarIa`/`religarIa` (Task 4), `whatsappGateway.enviarTexto` (existente).
- Produz: `responderComoHumano(conversationId, texto, usuarioId)` em `agente.ts`;
  Server Actions `responderConversaAction`, `pausarIaAction`, `religarIaAction`.

- [ ] **Passo 1: Escrever os testes (falham)**

```ts
describe("resposta humana", () => {
  it("pausa a IA, envia e grava — nessa ordem", async () => {
    const conversa = await criarConversa();
    enviarTextoMock.mockResolvedValueOnce({ idExterno: "wamid.humano.1" });

    await responderComoHumano(conversa.id, "Oi! Aqui é o João, vou te ajudar.", ID_DO_ADMIN);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);

    const mensagem = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: conversa.id, direcao: "SAIDA", autor: "HUMANO" },
    });
    expect(mensagem.texto).toBe("Oi! Aqui é o João, vou te ajudar.");
  });

  // O teste que justifica a ordem escolhida. Se gravasse primeiro, a inbox
  // mostraria uma mensagem que o cliente nunca recebeu -- o pior dos três
  // modos de falha, porque o humano acredita ter respondido.
  it("falha de envio deixa a IA pausada e NENHUMA mensagem gravada", async () => {
    const conversa = await criarConversa();
    enviarTextoMock.mockRejectedValueOnce(new Error("gateway fora do ar"));

    await expect(responderComoHumano(conversa.id, "teste", ID_DO_ADMIN)).rejects.toThrow(
      /gateway fora do ar/
    );

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false); // pausado: a IA não aproveita a brecha

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "SAIDA" },
    });
    expect(mensagens).toHaveLength(0);
  });

  it("recusa texto vazio sem chamar o gateway", async () => {
    const conversa = await criarConversa();
    await expect(responderComoHumano(conversa.id, "   ", ID_DO_ADMIN)).rejects.toThrow(
      /mensagem vazia/i
    );
    expect(enviarTextoMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/whatsapp-agente.test.ts -t "resposta humana"`
Esperado: FALHA — `responderComoHumano` não existe.

- [ ] **Passo 3: Implementar `responderComoHumano`**

```ts
/** Teto de tamanho de uma mensagem enviada pelo humano — o WhatsApp corta bem
 * acima disto, mas um campo sem limite é um campo que alguém cola um arquivo
 * inteiro dentro. */
const MAX_CARACTERES_RESPOSTA_HUMANA = 4000;

/**
 * Envia uma resposta escrita por um humano.
 *
 * ## A ordem importa e é contraintuitiva: pausa → envia → grava
 *
 * O envio é externo e não participa de transação, então alguma falha vai
 * acontecer. Esta é a única ordem em que TODA falha erra para o lado seguro:
 *
 * | Falha        | Resultado                                                        |
 * |--------------|------------------------------------------------------------------|
 * | Envio falha  | Bot pausado, nada enviado. O humano vê o erro e repete           |
 * | Gravação falha | Cliente recebeu, bot pausado, inbox sem a linha. Chato, não grave |
 * | (se gravasse primeiro) envio falha | Inbox mostrando mensagem que o cliente nunca recebeu — o pior dos três |
 *
 * Nenhum caminho deixa a IA respondendo por cima de um humano. É a mesma
 * semântica dos fluxos n8n que já rodam em produção (`Bots/01_-_ENTRADA_E_SAIDA`,
 * nó `pausaAtendimentoIA`): quem escreve, pausa.
 */
export async function responderComoHumano(
  conversationId: string,
  texto: string,
  usuarioId: string
): Promise<void> {
  const conteudo = texto.trim();
  if (conteudo.length === 0) {
    throw new Error("Mensagem vazia — nada a enviar.");
  }
  if (conteudo.length > MAX_CARACTERES_RESPOSTA_HUMANA) {
    throw new Error(`Mensagem acima do limite de ${MAX_CARACTERES_RESPOSTA_HUMANA} caracteres.`);
  }

  const conversa = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { waId: true },
  });

  // 1. Pausa primeiro — mesmo que tudo depois falhe, a IA fica calada.
  await pausarIa(conversationId, usuarioId);

  // 2. Envia.
  const envio = await whatsappGateway.enviarTexto(conversa.waId, conteudo);

  // 3. Grava.
  await prisma.whatsappMessage.create({
    data: {
      conversationId,
      idExterno: envio.idExterno,
      direcao: "SAIDA",
      autor: "HUMANO",
      tipo: "TEXTO",
      texto: conteudo,
      processadoEm: new Date(),
    },
  });
}
```

Importe `whatsappGateway` de `./gateway`.

- [ ] **Passo 4: Rodar e ver passar**

Executar: `npx vitest run tests/unit/whatsapp-agente.test.ts`
Esperado: PASSA (6 testes).

- [ ] **Passo 5: Escrever as Server Actions**

```ts
// src/core/whatsapp/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { pausarIa, religarIa, responderComoHumano } from "@/modules/whatsapp/agente";

/**
 * Responder, pausar e religar exigem apenas sessão válida — não uma ação
 * própria na matriz de permissões. São operações de atendimento, e o projeto
 * já decidiu que todos os papéis veem e atendem todos os leads. Quem edita a
 * PERSONA (`configurar_agente`) é que é restrito — ver actions da tela do
 * agente.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo": Server Action é
 * endpoint HTTP público, um `usuarioId` de formulário seria forjável.
 */
export async function responderConversaAction(conversationId: string, texto: string): Promise<void> {
  const usuario = await usuarioAtual();
  await responderComoHumano(conversationId, texto, usuario.id);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}

export async function pausarIaAction(conversationId: string): Promise<void> {
  const usuario = await usuarioAtual();
  await pausarIa(conversationId, usuario.id);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}

export async function religarIaAction(conversationId: string): Promise<void> {
  await usuarioAtual();
  await religarIa(conversationId);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}
```

- [ ] **Passo 6: Conferir tipos e commit**

Executar: `npx tsc --noEmit`

```bash
git add src/modules/whatsapp/agente.ts src/core/whatsapp/actions.ts tests/unit/whatsapp-agente.test.ts
git commit -m "feat: resposta humana pela inbox pausa a IA antes de enviar"
```

---

### Task 6: Inbox — caixa de resposta e estado da IA

**Arquivos:**
- Criar: `src/components/conversa-responder.tsx` (Client Component)
- Criar: `src/components/conversa-estado-ia.tsx` (Client Component)
- Modificar: `src/app/(painel)/conversas/[id]/page.tsx`
- Modificar: `src/app/(painel)/conversas/page.tsx`
- Modificar: `src/modules/whatsapp/queries.ts`
- Criar: `tests/unit/conversa-responder.test.tsx`

**Interfaces:**
- Consome: `responderConversaAction`, `pausarIaAction`, `religarIaAction` (Task 5).
- Produz: componentes `ConversaResponder` e `ConversaEstadoIa`;
  `buscarConversaComMensagens()` passa a incluir `iaPausadaPor`.

- [ ] **Passo 1: Escrever o teste do componente (falha)**

```tsx
// @vitest-environment jsdom
// tests/unit/conversa-responder.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mesmo padrão de painel-nav.test.tsx: a action importa `agente.ts`, que tem
// `import "server-only"` — fora do pipeline de build do Next isso lança.
vi.mock("@/core/whatsapp/actions", () => ({
  responderConversaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ConversaResponder } = await import("../../src/components/conversa-responder");

describe("ConversaResponder", () => {
  afterEach(cleanup);

  it("mostra o campo de texto e o botão de enviar", () => {
    render(<ConversaResponder conversationId="c1" />);
    expect(screen.getByRole("textbox", { name: /resposta/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /enviar/i })).toBeTruthy();
  });

  it("avisa que enviar pausa a IA — o efeito colateral precisa estar na tela", () => {
    render(<ConversaResponder conversationId="c1" />);
    expect(screen.getByText(/pausa o atendimento automático/i)).toBeTruthy();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/conversa-responder.test.tsx`
Esperado: FALHA — componente não existe.

- [ ] **Passo 3: Escrever `ConversaResponder`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { responderConversaAction } from "@/core/whatsapp/actions";
import { Button } from "@/components/ui/button";

/**
 * Caixa de resposta da inbox. Client Component porque precisa de estado local
 * (texto digitado, erro de envio) e de `useTransition` para desabilitar o
 * botão durante o envio — sem isso, um clique duplo manda a mesma mensagem
 * duas vezes ao cliente, e não há como desenviar.
 *
 * O aviso de que enviar pausa a IA fica NA TELA, não só na documentação: é um
 * efeito colateral que muda o comportamento do sistema, e quem clica precisa
 * saber antes de clicar.
 */
export function ConversaResponder({ conversationId }: { conversationId: string }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();
  const router = useRouter();

  function enviar() {
    setErro(null);
    iniciarEnvio(async () => {
      try {
        await responderConversaAction(conversationId, texto);
        setTexto("");
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao enviar a mensagem.");
      }
    });
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <label htmlFor="resposta" className="text-sm font-medium">
        Resposta
      </label>
      <textarea
        id="resposta"
        aria-label="Resposta"
        className="w-full rounded-md border p-2 text-sm"
        rows={3}
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        disabled={enviando}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Enviar pausa o atendimento automático desta conversa.
        </p>
        <Button onClick={enviar} disabled={enviando || texto.trim().length === 0}>
          {enviando ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
```

- [ ] **Passo 4: Escrever `ConversaEstadoIa`**

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { pausarIaAction, religarIaAction } from "@/core/whatsapp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarDataHoraBR } from "@/lib/date";

/**
 * Estado da IA na conversa, com o botão que inverte esse estado.
 *
 * Mostra QUEM pausou e QUANDO de propósito: sem isso, uma conversa muda é
 * indistinguível de um bug, e a primeira reação de quem vê é reabrir o código.
 */
export function ConversaEstadoIa({
  conversationId,
  iaAtiva,
  pausadaEm,
  pausadaPor,
}: {
  conversationId: string;
  iaAtiva: boolean;
  pausadaEm: Date | null;
  pausadaPor: string | null;
}) {
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  function alternar() {
    iniciar(async () => {
      await (iaAtiva ? pausarIaAction(conversationId) : religarIaAction(conversationId));
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Badge variant={iaAtiva ? "default" : "secondary"}>
        {iaAtiva ? "IA respondendo" : "IA pausada"}
      </Badge>
      {!iaAtiva && pausadaEm && (
        <span className="text-xs text-muted-foreground">
          Pausada por {pausadaPor ?? "alguém"} em {formatarDataHoraBR(pausadaEm)}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={alternar} disabled={processando}>
        {iaAtiva ? "Pausar IA" : "Religar IA"}
      </Button>
    </div>
  );
}
```

- [ ] **Passo 5: Ampliar as queries**

`listarConversas()` **não muda**: ela usa `include`, e `include` não restringe campos
escalares — `iaAtiva` já vem na resposta assim que a coluna existe. (Se em algum
momento alguém trocar `include` por `select`, aí sim `iaAtiva` precisa ser listado
explicitamente, e o selo da lista some sem aviso.)

Em `buscarConversaComMensagens`, acrescente o autor da pausa:

```ts
    include: {
      contact: { select: { id: true, nome: true } },
      iaPausadaPor: { select: { id: true, nome: true } },
      mensagens: { orderBy: { criadoEm: "asc" } },
    },
```

- [ ] **Passo 6: Ligar na página de detalhe**

Em `src/app/(painel)/conversas/[id]/page.tsx`, troque o comentário de topo (ele diz
"SÓ LEITURA (sem campo de resposta: essa é a Fatia 2)" — a Fatia 2 chegou) e, depois do
cabeçalho, antes da lista de mensagens:

```tsx
      <ConversaEstadoIa
        conversationId={conversa.id}
        iaAtiva={conversa.iaAtiva}
        pausadaEm={conversa.iaPausadaEm}
        pausadaPor={conversa.iaPausadaPor?.nome ?? null}
      />
```

E no fim do container, depois da lista:

```tsx
      <ConversaResponder conversationId={conversa.id} />
```

Acrescente ao cabeçalho o link para a tela do agente (Task 7):

```tsx
        <Link href="/conversas/agente" className="text-sm text-muted-foreground hover:underline">
          Configurar agente
        </Link>
```

- [ ] **Passo 7: Mostrar o estado na lista**

Em `src/app/(painel)/conversas/page.tsx`, em cada linha da listagem, um selo quando a
conversa está pausada:

```tsx
{!conversa.iaAtiva && <Badge variant="secondary">IA pausada</Badge>}
```

Isto é o que sustenta a mitigação do risco "conversa pausada e esquecida": uma conversa
que só se distingue depois de aberta é uma conversa que ninguém percebe que está
esperando.

- [ ] **Passo 8: Rodar os testes e o build**

Executar: `npx vitest run tests/unit/conversa-responder.test.tsx && npx tsc --noEmit`
Esperado: PASSA; sem erro de tipo.

- [ ] **Passo 9: Commit**

```bash
git add src/components/conversa-responder.tsx src/components/conversa-estado-ia.tsx "src/app/(painel)/conversas" src/modules/whatsapp/queries.ts tests/unit/conversa-responder.test.tsx
git commit -m "feat: caixa de resposta e estado da IA na inbox"
```

---

### Task 7: Tela de configuração do agente

**Arquivos:**
- Modificar: `src/core/auth/permissions.ts`
- Criar: `src/core/whatsapp/agente-actions.ts`
- Criar: `src/app/(painel)/conversas/agente/page.tsx`
- Criar: `src/components/agente-form.tsx`
- Modificar: `tests/unit/permissions.test.ts`
- Criar: `tests/unit/agente-actions.test.ts`

**Interfaces:**
- Consome: `lerConfigBot`/`salvarConfigBot` (Task 4), `montarPromptSistema` (Task 2),
  `botConfig`/`BOT_CONFIG_ID` (Task 1).
- Produz: ação `configurar_agente` na matriz; `salvarConfigAgenteAction`,
  `restaurarConfigPadraoAction`.

- [ ] **Passo 1: Acrescentar a permissão e seu teste**

Em `src/core/auth/permissions.ts`:

```ts
export type Acao =
  | "gerenciar_usuarios"
  | "criar_lead"
  | "mover_lead"
  | "ver_dashboard_geral"
  | "exportar_leads"
  | "configurar_agente";

const matriz: Record<Role, Acao[]> = {
  ADMIN: [
    "gerenciar_usuarios",
    "criar_lead",
    "mover_lead",
    "ver_dashboard_geral",
    "exportar_leads",
    "configurar_agente",
  ],
  GESTOR: ["criar_lead", "mover_lead", "ver_dashboard_geral", "exportar_leads"],
  VENDEDOR: ["criar_lead", "mover_lead"],
};
```

E em `tests/unit/permissions.test.ts`:

```ts
it("só ADMIN configura o agente — a persona é da agência, não do cliente", () => {
  expect(hasPermission("ADMIN", "configurar_agente")).toBe(true);
  expect(hasPermission("GESTOR", "configurar_agente")).toBe(false);
  expect(hasPermission("VENDEDOR", "configurar_agente")).toBe(false);
});
```

- [ ] **Passo 2: Escrever o teste das actions (falha)**

```ts
// tests/unit/agente-actions.test.ts
describe("restaurar ao padrão do fork", () => {
  it("volta a persona, as regras e a FAQ para o conteúdo de config/bot.ts", async () => {
    await salvarConfigBot(
      { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
      ID_DO_ADMIN
    );

    await restaurarConfigPadrao(ID_DO_ADMIN);

    const linha = await lerConfigBot();
    expect(linha.personaNome).toBe(botConfig.persona.nome);
    expect(linha.regras).toEqual(botConfig.regras);
    expect(linha.faq).toBe(botConfig.faq);
  });

  // O interruptor global NÃO é conteúdo do fork: se o bot foi desligado
  // porque estava fazendo besteira, restaurar o texto não pode religá-lo por
  // conta própria -- seria o botão "consertar o prompt" reabrindo o problema.
  it("não religa o interruptor global", async () => {
    await salvarConfigBot(
      { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
      ID_DO_ADMIN
    );
    await restaurarConfigPadrao(ID_DO_ADMIN);
    expect((await lerConfigBot()).ativo).toBe(false);
  });
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Executar: `npx vitest run tests/unit/agente-actions.test.ts`
Esperado: FALHA — `restaurarConfigPadrao` não existe.

- [ ] **Passo 4: Implementar `restaurarConfigPadrao` em `agente.ts`**

```ts
/**
 * Restaura persona, regras e FAQ a partir de `config/bot.ts`.
 *
 * Este é um dos DOIS únicos momentos em que o arquivo é lido — o outro é o
 * seed. Nunca no caminho de resposta ao cliente: nenhum turno consulta o
 * arquivo, e por isso não existe janela em que o bot responda com uma persona
 * diferente da que a tela mostra.
 *
 * `ativo` de propósito fora do que é restaurado: se o interruptor global foi
 * desligado porque o bot estava fazendo besteira, o botão de consertar o
 * prompt não pode religá-lo sozinho.
 */
export async function restaurarConfigPadrao(usuarioId: string) {
  return prisma.botConfig.update({
    where: { id: BOT_CONFIG_ID },
    data: {
      personaNome: botConfig.persona.nome,
      personaPapel: botConfig.persona.papel,
      regras: botConfig.regras,
      faq: botConfig.faq,
      atualizadoPorId: usuarioId,
    },
  });
}
```

- [ ] **Passo 5: Escrever as Server Actions com a guarda de permissão**

```ts
// src/core/whatsapp/agente-actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { restaurarConfigPadrao, salvarConfigBot } from "@/modules/whatsapp/agente";

async function exigirAdmin() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "configurar_agente")) {
    throw new Error("Sem permissão para configurar o agente");
  }
  return usuario;
}

export async function salvarConfigAgenteAction(dados: {
  ativo: boolean;
  personaNome: string;
  personaPapel: string;
  regras: string[];
  faq: string;
}): Promise<void> {
  const usuario = await exigirAdmin();

  const personaNome = dados.personaNome.trim();
  const personaPapel = dados.personaPapel.trim();
  if (personaNome.length === 0 || personaPapel.length === 0) {
    throw new Error("Nome e papel da persona são obrigatórios.");
  }

  // Regras vazias são descartadas em vez de rejeitadas: uma linha em branco
  // no textarea é acidente de digitação, não intenção.
  const regras = dados.regras.map((r) => r.trim()).filter((r) => r.length > 0);
  if (regras.length === 0) {
    throw new Error("O agente precisa de pelo menos uma regra.");
  }

  await salvarConfigBot(
    { ativo: dados.ativo, personaNome, personaPapel, regras, faq: dados.faq.trim() },
    usuario.id
  );
  revalidatePath("/conversas/agente");
}

export async function restaurarConfigPadraoAction(): Promise<void> {
  const usuario = await exigirAdmin();
  await restaurarConfigPadrao(usuario.id);
  revalidatePath("/conversas/agente");
}
```

- [ ] **Passo 6: Escrever a página**

```tsx
// src/app/(painel)/conversas/agente/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";

import { exigirModulo } from "@/lib/module-gate";
import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { lerConfigBot } from "@/modules/whatsapp/agente";
import { AgenteForm } from "@/components/agente-form";

/**
 * Configuração do agente de IA — ADMIN apenas.
 *
 * A rota é `/conversas/agente`, segmento ESTÁTICO convivendo com o dinâmico
 * `/conversas/[id]`. O Next resolve estático antes de dinâmico, então esta
 * página sempre ganha; uma conversa cujo id fosse literalmente "agente"
 * ficaria inacessível, o que não acontece com ids `cuid()`.
 *
 * Não vira item de menu de propósito: o painel já tem sete entradas e esta é
 * uma tela de uso raro, alcançada pelo link no cabeçalho da inbox.
 */
export default async function AgentePage() {
  exigirModulo("whatsapp");

  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "configurar_agente")) {
    redirect("/conversas");
  }

  const config = await lerConfigBot();

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/conversas" className="text-sm text-muted-foreground hover:underline">
          ← Conversas
        </Link>
        <h1 className="text-xl font-semibold">Agente de atendimento</h1>
        <p className="text-sm text-muted-foreground">
          Personalidade, regras e perguntas frequentes usadas em toda resposta automática.
        </p>
      </div>

      <AgenteForm config={config} />
    </div>
  );
}
```

- [ ] **Passo 7: Escrever `AgenteForm` com a prévia do prompt**

Antes de escrever: confirme que `src/modules/whatsapp/prompt.ts` **não** tem
`import "server-only"` (não tem hoje). É montagem de texto pura, sem banco nem segredo,
e precisa ser importável por um Client Component para a prévia usar exatamente a mesma
função que o servidor usa. Se alguém tiver adicionado, remova.

```tsx
// src/components/agente-form.tsx
"use client";

import { useState, useTransition } from "react";
import type { BotConfig } from "@prisma/client";

import { salvarConfigAgenteAction, restaurarConfigPadraoAction } from "@/core/whatsapp/agente-actions";
import { montarPromptSistema } from "@/modules/whatsapp/prompt";
import { Button } from "@/components/ui/button";

/**
 * Editor da configuração do agente.
 *
 * As regras vivem num único `textarea`, uma por linha, em vez de uma lista de
 * campos com botões de adicionar/remover: são poucas, mudam raramente, e
 * editar texto corrido é mais rápido que operar uma lista — sem contar que a
 * lista precisaria de reordenação para ser útil, o que ninguém pediu.
 */
export function AgenteForm({ config }: { config: BotConfig }) {
  const [ativo, setAtivo] = useState(config.ativo);
  const [personaNome, setPersonaNome] = useState(config.personaNome);
  const [personaPapel, setPersonaPapel] = useState(config.personaPapel);
  const [regrasTexto, setRegrasTexto] = useState(config.regras.join("\n"));
  const [faq, setFaq] = useState(config.faq);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [processando, iniciar] = useTransition();

  const regras = regrasTexto
    .split("\n")
    .map((regra) => regra.trim())
    .filter((regra) => regra.length > 0);

  // Prévia calculada no cliente com a MESMA função que o servidor usa. Editar
  // algo cujo efeito é invisível é como programar sem compilar — e como
  // `montarPromptSistema` é pura e determinística, renderizar o texto final
  // custa quase nada e transforma "acho que ficou bom" em "é isto que o modelo
  // vai ler".
  const previa = montarPromptSistema({ personaNome, personaPapel, regras, faq });

  function salvar() {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      try {
        await salvarConfigAgenteAction({ ativo, personaNome, personaPapel, regras, faq });
        setSalvo(true);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function restaurar() {
    // Confirmação porque a ação descarta trabalho e não tem desfazer.
    if (!window.confirm("Restaurar persona, regras e FAQ ao padrão do fork? As edições atuais serão perdidas.")) {
      return;
    }
    setErro(null);
    iniciar(async () => {
      try {
        await restaurarConfigPadraoAction();
        window.location.reload();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao restaurar.");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <label className="flex items-center gap-2 rounded-md border p-3">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="text-sm font-medium">Atendimento automático ligado</span>
          <span className="text-xs text-muted-foreground">
            Desligado, a IA não responde em nenhuma conversa.
          </span>
        </label>

        <div className="space-y-1">
          <label htmlFor="persona-nome" className="text-sm font-medium">
            Nome da persona
          </label>
          <input
            id="persona-nome"
            className="w-full rounded-md border p-2 text-sm"
            value={personaNome}
            onChange={(e) => setPersonaNome(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="persona-papel" className="text-sm font-medium">
            Papel da persona
          </label>
          <input
            id="persona-papel"
            className="w-full rounded-md border p-2 text-sm"
            value={personaPapel}
            onChange={(e) => setPersonaPapel(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="regras" className="text-sm font-medium">
            Regras — uma por linha
          </label>
          <textarea
            id="regras"
            className="w-full rounded-md border p-2 font-mono text-xs"
            rows={12}
            value={regrasTexto}
            onChange={(e) => setRegrasTexto(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="faq" className="text-sm font-medium">
            Perguntas frequentes
          </label>
          <textarea
            id="faq"
            className="w-full rounded-md border p-2 text-xs"
            rows={8}
            value={faq}
            onChange={(e) => setFaq(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para o agente não receber bloco de FAQ nenhum.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={processando}>
            {processando ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="outline" onClick={restaurar} disabled={processando}>
            Voltar ao padrão do fork
          </Button>
        </div>

        {salvo && <p className="text-sm text-muted-foreground">Salvo. Vale na próxima resposta.</p>}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-medium">Prévia do prompt</h2>
        <p className="text-xs text-muted-foreground">É exatamente este texto que o modelo recebe.</p>
        <pre
          data-testid="previa-prompt"
          className="max-h-[40rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs"
        >
          {previa}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Passo 8: Rodar tudo**

Executar: `npx vitest run && npx tsc --noEmit`
Esperado: tudo passa.

- [ ] **Passo 9: Commit**

```bash
git add src/core/auth/permissions.ts src/core/whatsapp/agente-actions.ts "src/app/(painel)/conversas/agente" src/components/agente-form.tsx src/modules/whatsapp/agente.ts tests/unit
git commit -m "feat: tela de configuracao do agente com previa do prompt"
```

---

### Task 8: E2E do ciclo completo

**Arquivos:**
- Criar: `tests/e2e/whatsapp-agente.spec.ts`

**Interfaces:**
- Consome: tudo das tarefas anteriores.

- [ ] **Passo 1: Escrever o spec**

```ts
import { test, expect } from "@playwright/test";

/**
 * Prova o ciclo que a fatia inteira existe para entregar: humano assume,
 * bot cala, humano devolve.
 *
 * A entrada da mensagem do cliente é simulada escrevendo direto no banco (o
 * webhook real depende da Evolution, que não existe no ambiente de teste) —
 * mas tudo depois disso é o sistema de verdade: a tela, as actions, o estado.
 */
test("pausar, responder e religar a IA numa conversa", async ({ page }) => {
  const conversa = await prisma.conversation.create({
    data: { waId: `e2e-${crypto.randomUUID()}`, telefone: "5511999990000" },
  });
  await prisma.whatsappMessage.create({
    data: {
      conversationId: conversa.id,
      idExterno: `e2e-${crypto.randomUUID()}`,
      direcao: "ENTRADA",
      autor: "CLIENTE",
      tipo: "TEXTO",
      texto: "Bom dia, tem carro na faixa de 60 mil?",
    },
  });
  const conversaId = conversa.id;

  await page.goto(`/conversas/${conversaId}`);
  await expect(page.getByText("IA respondendo")).toBeVisible();

  await page.getByRole("button", { name: "Pausar IA" }).click();
  await expect(page.getByText("IA pausada")).toBeVisible();

  // O estado tem que aparecer TAMBÉM na lista — é o que evita conversa
  // pausada e esquecida.
  await page.goto("/conversas");
  await expect(page.getByText("IA pausada")).toBeVisible();

  await page.goto(`/conversas/${conversaId}`);
  await page.getByRole("button", { name: "Religar IA" }).click();
  await expect(page.getByText("IA respondendo")).toBeVisible();

  await prisma.conversation.delete({ where: { id: conversaId } });
});

test("a tela do agente é inacessível a quem não é ADMIN", async ({ page }) => {
  await logarComo(page, "vendedor@exemplo.com");
  await page.goto("/conversas/agente");
  await expect(page).toHaveURL(/\/conversas$/);
});

test("editar a persona muda a prévia do prompt", async ({ page }) => {
  await logarComo(page, "admin@exemplo.com");
  await page.goto("/conversas/agente");
  await page.getByLabel("Nome da persona").fill("Beatriz");
  await expect(page.getByTestId("previa-prompt")).toContainText("Você é Beatriz");
});
```

Reaproveite o helper de login que os specs existentes já usam (procure em
`tests/e2e/` por como `admin@exemplo.com` entra hoje) em vez de escrever outro — a
suíte já resolveu isso, e um segundo caminho de login é um segundo caminho para
quebrar.

Os testes usam contas diferentes: confira se a configuração do Playwright reaproveita
estado de sessão entre specs. Se reaproveitar, estes dois precisam de contexto próprio,
senão o segundo herda a sessão do primeiro e o teste de permissão passa por engano.

O envio de mensagem real **não** entra no e2e: chamaria a Evolution de verdade,
mandando WhatsApp para um número real. Isso é verificação humana (ver abaixo).

- [ ] **Passo 2: Rodar**

Executar: `npm run test:e2e`
Esperado: todos passam. Nunca `npx playwright test` direto — o script encadeia a
guarda de porta.

- [ ] **Passo 3: Commit**

```bash
git add tests/e2e/whatsapp-agente.spec.ts
git commit -m "test: e2e do ciclo de pausar, responder e religar a IA"
```

---

## Verificação que só um humano pode fazer

Nenhuma destas cabe em teste automatizado, e nenhuma delas é opcional antes de a fatia
ser considerada entregue:

1. **Enviar uma resposta humana de verdade** por uma conversa real e confirmar que
   chega no WhatsApp do cliente — o e2e para antes disso de propósito, porque o passo
   seguinte manda mensagem para um telefone real.
2. **Confirmar que o bot fica calado** depois disso: mandar outra mensagem do celular
   do cliente e verificar que nenhuma resposta automática chega, e que a mensagem
   aparece na inbox.
3. **Religar e confirmar** que a IA volta a responder.
4. **Editar a persona pela tela** e confirmar, na resposta seguinte, que o bot mudou de
   comportamento sem nenhum deploy — é a promessa comercial inteira da fatia num teste
   só.
5. **`DIRECT_URL` na Vercel**, junto com a `DATABASE_URL` de transaction pooler. Sem
   ela, a migração desta fatia não roda no deploy.

## Lacuna conhecida que este plano não fecha

Quando a IA pausa (ou bate o teto por hora), as mensagens do cliente ficam na inbox e
**ninguém é avisado**. Uma conversa pode esperar horas sem nenhum vendedor saber. O CRM
já tem `Notification` funcionando (in-app e e-mail via Resend), então isto encaixa
depois sem retrabalho de modelo — e é o primeiro candidato à fatia seguinte, à frente
do catálogo.
