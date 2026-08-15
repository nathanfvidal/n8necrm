# CRUD de etapas do funil — plano de implementação

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa por tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** um ADMIN cria, renomeia, recolore, reordena e remove etapas do funil pela
interface, sem editar código e sem rodar seed.

**Arquitetura:** o banco passa a ser dono do funil e `client.funil` vira semente de
instalação. Um módulo novo `src/core/pipeline/` ganha schema Zod, serviço e cinco Server
Actions; a tela `/etapas` segue o molde de `/usuarios`. A reordenação troca duas etapas
dentro de uma transação usando uma posição de estacionamento negativa, porque
`UNIQUE(ordem)` é verificado a cada `UPDATE`.

**Stack:** Next.js 16.3 (App Router, Server Actions), Prisma + Postgres (Supabase), Zod,
Vitest, Playwright, Tailwind, shadcn/Base UI.

**Spec:** `docs/superpowers/specs/2026-08-14-crud-etapas-do-funil-design.md`. Leia antes de
começar — este plano executa aquelas decisões e não as rediscute.

## Restrições globais

- **Zero migração.** `PipelineStage` já tem tudo. Se você achar que precisa de `migrate`,
  parou de seguir o plano — pare e pergunte.
- **O Postgres é REAL e compartilhado com produção.** Só `SELECT`, exceto para limpar
  linhas que o próprio teste criou. Nunca `prisma migrate dev` contra ele.
- **Nunca leia, imprima ou commite `.env`.** Variável se verifica por presença.
- Toda Server Action devolve `ResultadoAcao` (`{ok:true} | {ok:false;erro:string}`) e
  **nunca lança**. Ver `src/lib/acao.ts`.
- A checagem de permissão roda **dentro** do `try` de cada action. Fora dele, uma sessão
  expirada rejeita a promise sem produzir `ResultadoAcao` e a tela não mostra nada.
- `src/core/` **não pode** importar de `src/modules/` (erro de ESLint).
- **Todo teste novo é sabotado antes de ser aceito:** quebre o código de propósito, veja o
  vermelho, desfaça. As sabotagens estão nas tarefas.
- Nenhuma linha crua de Prisma atravessa a fronteira servidor→cliente. Componentes recebem
  DTO montado com `.map()`.
- Commits em português **sem acentos**, formato Conventional Commits, com o trailer
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Antes de merge ou PR:** Fase 1 da skill `auditoria-seguranca`, relatório entregue, e
  **para**.

## Verificação, ao fim de cada tarefa

```
npm run typecheck && npm run lint
npx vitest run
```

E ao fim das tarefas 11 e 12, também `npm run test:e2e`.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `src/core/pipeline/schema.ts` | Zod de `nome` e `cor` |
| `src/core/pipeline/service.ts` | as cinco operações + `EtapaInvalidaError` |
| `src/core/pipeline/actions.ts` | as cinco Server Actions + invalidação de cache |
| `src/app/(painel)/etapas/page.tsx` | a página, com o portão de ADMIN |
| `src/components/pipeline/etapa-form.tsx` | formulário de criar |
| `src/components/pipeline/etapas-table.tsx` | a tabela, setas, marcador |
| `src/components/pipeline/editar-etapa-dialogo.tsx` | diálogo de nome + cor |
| `src/components/pipeline/excluir-etapa-dialogo.tsx` | diálogo com `<select>` de destino |
| `tests/unit/pipeline-schema.test.ts` | Zod |
| `tests/unit/pipeline-transacoes.test.ts` | forma das transações, Prisma mockado |
| `tests/unit/pipeline-service.test.ts` | invariantes e exclusão, Postgres real |
| `tests/unit/pipeline-actions.test.ts` | permissão, `ResultadoAcao`, invalidação |
| `tests/unit/etapas-table.test.tsx` | ramos da tabela |
| `tests/e2e/etapas.spec.ts` | ciclo ponta a ponta |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `src/core/auth/permissions.ts` | `gerenciar_funil`, só ADMIN |
| `src/core/audit/log.ts` | separar `gravarLinhaDeAuditoria` de `registrarAuditoria` |
| `src/core/audit/alerta.ts` | `excluir_etapa` em `ACOES_SENSIVEIS` |
| `src/core/pipeline/stages.ts` | `contarLeadsQueSeguramEtapa()` |
| `prisma/seed.ts` | semear só com tabela vazia; apagar `reconciliarEtapasOrfas` |
| `prisma/seed-demo.ts` | mensagem do guarda |
| `src/components/dashboard/stage-summary.tsx` | grid, `key`, comentário |
| `src/components/dashboard/conversion-chart.tsx` | `key` |
| `src/app/(painel)/page.tsx` | comentário que passou a mentir |
| `src/components/nav-links.tsx` | ícone `etapas` |
| `src/components/painel-nav.tsx` | item de menu |
| `tests/unit/seed.test.ts` | asserções acopladas a `client.funil` |
| `tests/unit/seed-demo.test.ts` | `describe.skipIf` |
| `tests/unit/pipeline-stages.test.ts` | asserções acopladas a `client.funil` |

**Ordem das tarefas importa em dois pontos.** A tarefa 2 (seed) vem antes de qualquer teste
que crie etapa no banco real: enquanto `reconciliarEtapasOrfas` existir, ela apaga etapas de
`ordem >= 5` — e **aborta o seed inteiro** se elas tiverem lead. A tarefa 10 (painel) vem
antes da 12 (e2e), que afirma sobre o painel.

---

## Tarefa 1: Permissão nova e auditoria transacionável

**Arquivos:**
- Modificar: `src/core/auth/permissions.ts`
- Modificar: `src/core/audit/alerta.ts:52-59`
- Modificar: `src/core/audit/log.ts`
- Teste: `tests/unit/permissions.test.ts` (existente)

**Interfaces:**
- Produz: `Acao` ganha `"gerenciar_funil"`;
  `gravarLinhaDeAuditoria(params: ParamsDeAuditoria, cliente?: Prisma.TransactionClient): Promise<void>`;
  `registrarAuditoria(params: ParamsDeAuditoria): Promise<void>` (assinatura inalterada).

- [ ] **Passo 1: escrever o teste que falha**

Acrescente em `tests/unit/permissions.test.ts`:

```ts
describe("gerenciar_funil", () => {
  it("só ADMIN gerencia o funil — GESTOR e VENDEDOR não", () => {
    expect(hasPermission("ADMIN", "gerenciar_funil")).toBe(true);
    expect(hasPermission("GESTOR", "gerenciar_funil")).toBe(false);
    expect(hasPermission("VENDEDOR", "gerenciar_funil")).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/permissions.test.ts`
Esperado: erro de tipo/compilação — `"gerenciar_funil"` não existe na união `Acao`.

- [ ] **Passo 3: adicionar a permissão**

Em `src/core/auth/permissions.ts`, acrescente à união `Acao`, depois de
`"ver_documento_contato"`:

```ts
  /**
   * Criar, renomear, recolorir, reordenar e remover etapas do funil.
   *
   * Exclusiva de ADMIN pelo mesmo motivo de `gerenciar_usuarios`: renomear uma
   * etapa muda o vocabulário de todo mundo que usa o CRM, e remover uma
   * reescreve `stageId` de leads em massa. Estreitar depois é fácil; alargar
   * depois de estragar, não.
   */
  | "gerenciar_funil";
```

E `"gerenciar_funil"` ao array de `ADMIN` na `matriz`. **Não** adicione a GESTOR nem a
VENDEDOR.

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/permissions.test.ts` → PASS

- [ ] **Passo 5: registrar `excluir_etapa` como ação sensível**

Em `src/core/audit/alerta.ts`, acrescente ao array `ACOES_SENSIVEIS` (antes de
`"exportar_leads"`):

```ts
  "excluir_etapa",
```

E acrescente ao docblock da constante, depois da frase sobre `desarquivar_lead`:

```
 * `excluir_etapa` entra: destrói estrutura do funil e reescreve `stageId` de
 * leads em massa. As outras operações de funil (`criar_etapa`, `editar_etapa`,
 * `reordenar_etapa`) ficam de fora, junto com o trabalho normal.
```

- [ ] **Passo 6: separar gravação de detecção em `log.ts`**

Substitua o corpo de `src/core/audit/log.ts` mantendo o docblock existente sobre a coerção
de `antes`/`depois`, e acrescentando o que segue:

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { avaliarAtividadeSuspeita } from "./alerta";

export type ParamsDeAuditoria = {
  userId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  ip?: string;
};

/**
 * Grava a linha, e só isso.
 *
 * Existe separada porque `excluirEtapa` (`core/pipeline/service.ts`) precisa da
 * linha DENTRO da transação que apaga a etapa: aquela é a única entrada
 * forense da operação — não há entrada por lead —, e a etapa de origem deixa de
 * existir, então não há de onde reconstituir para onde os leads foram. Ou a
 * etapa some com o rastro, ou nada some.
 *
 * O que NÃO entra na transação é `avaliarAtividadeSuspeita`: ela faz `count` no
 * `AuditLog`, `findMany` de ADMINs e `createMany` de notificações, e rodar isso
 * segurando lock em linhas de `Lead` alonga a transação por trabalho que não é
 * do domínio dela.
 *
 * `cliente` aceita tanto o `prisma` do módulo quanto o `tx` de um
 * `$transaction` interativo.
 */
export async function gravarLinhaDeAuditoria(
  params: ParamsDeAuditoria,
  cliente: Prisma.TransactionClient = prisma
): Promise<void> {
  await cliente.auditLog.create({
    data: {
      userId: params.userId,
      acao: params.acao,
      entidade: params.entidade,
      entidadeId: params.entidadeId,
      antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
      depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
      ip: params.ip,
    },
  });
}

export async function registrarAuditoria(params: ParamsDeAuditoria): Promise<void> {
  await gravarLinhaDeAuditoria(params);

  // (mantenha aqui, sem alterar, o comentário longo existente sobre por que a
  // detecção de rajada mora neste funil e por que a falha é engolida.)
  try {
    await avaliarAtividadeSuspeita({ userId: params.userId, acao: params.acao });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }
}
```

- [ ] **Passo 7: rodar a suíte inteira**

`npm run typecheck && npm run lint && npx vitest run`
Esperado: verde. `registrarAuditoria` manteve a assinatura, então os 20+ chamadores não
mudam.

- [ ] **Passo 8: sabotagem**

Troque `hasPermission("GESTOR", "gerenciar_funil")` na matriz adicionando `"gerenciar_funil"`
ao array de `GESTOR`. Rode `npx vitest run tests/unit/permissions.test.ts` → deve ficar
**vermelho**. Desfaça.

- [ ] **Passo 9: commit**

```bash
git add src/core/auth/permissions.ts src/core/audit/alerta.ts src/core/audit/log.ts tests/unit/permissions.test.ts
git commit -m "feat(funil): permissao gerenciar_funil e auditoria transacionavel"
```

---

## Tarefa 2: O seed deixa de mandar no funil

**Arquivos:**
- Modificar: `prisma/seed.ts`
- Modificar: `prisma/seed-demo.ts:269-276`
- Modificar: `tests/unit/seed.test.ts`
- Modificar: `tests/unit/seed-demo.test.ts`

**Interfaces:**
- Consome: nada das tarefas anteriores.
- Produz: `seed()` deixa de renomear, recolorir, reordenar ou apagar etapas existentes.
  `reconciliarEtapasOrfas` deixa de existir.

**Por que esta tarefa vem cedo:** enquanto `reconciliarEtapasOrfas` existir, qualquer etapa
criada com `ordem >= client.funil.length` — que é como toda etapa nova nasce — é apagada na
próxima execução do seed, e **o seed inteiro aborta** se ela tiver lead. Isso quebraria as
tarefas 5 a 8, que criam etapas no banco real.

- [ ] **Passo 1: reescrever as asserções que morrem**

Em `tests/unit/seed.test.ts`, três mudanças.

Na asserção de idempotência (linha ~59), troque `stages: client.funil.length` por uma
comparação relativa. O bloco fica:

```ts
      // NÃO `client.funil.length`: desde o CRUD de etapas o banco pode
      // legitimamente ter 6, 3 ou 40 etapas, criadas pela tela. O que este
      // teste prova é que rodar o seed duas vezes NÃO DUPLICA — não que o
      // funil tem o tamanho do config.
      expect(contagemAposSegundaExecucao).toEqual(contagemAposPrimeiraExecucao);
      expect(contagemAposSegundaExecucao.stages).toBeGreaterThanOrEqual(1);
      expect(contagemAposSegundaExecucao.users).toBe(2);
      expect(contagemAposSegundaExecucao.contacts).toBe(4);
      expect(contagemAposSegundaExecucao.leads).toBe(4);
```

No `describe` "contrato ehGanho" (linhas 74-81), o `it` passa a provar só a invariante que
sobrevive:

```ts
    it("marca exatamente UMA etapa como ehGanho — e nenhuma outra", async () => {
      const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
      const marcadasComoGanho = etapas.filter((etapa) => etapa.ehGanho);

      expect(marcadasComoGanho).toHaveLength(1);
      // As asserções `.ordem === client.funil.length - 1` e `.nome ===
      // client.funil[length - 1]` saíram: a etapa de fechamento passou a ser
      // escolhida na tela e pode estar em QUALQUER posição, com qualquer nome.
      // Criar "Negociação" no fim e marcá-la como fechamento é o caso de uso
      // central do CRUD de etapas, e derrubaria as duas.
    });
```

Apague inteiro o `describe` de reconciliação de órfãs (linhas ~105-188 — **um** describe com
dois `it`): ele testa `reconciliarEtapasOrfas`, que está sendo removida.

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/seed.test.ts`
Esperado: FAIL — o seed atual ainda reconcilia, e o import de `reconciliarEtapasOrfas` pode
ficar órfão.

- [ ] **Passo 3: semear só com a tabela vazia**

Em `prisma/seed.ts`, substitua o laço de `client.funil.entries()` por:

```ts
  // O funil só nasce do config na PRIMEIRA vez. Depois disso quem manda é o
  // banco, porque `/etapas` (ADMIN) cria, renomeia, recolore, reordena e
  // remove etapa.
  //
  // O `upsert` por `ordem` que morava aqui reconciliava a tabela com
  // `client.funil` a cada execução — e passou a ser destrutivo no dia em que a
  // tela existiu: renomearia "Negociação" para "Fechado" e recoloriria por
  // índice. `client.funil` virou SEMENTE de instalação, e é isso que permite
  // um fork nascer com o funil dele.
  const etapasExistentes = await prisma.pipelineStage.count();
  if (etapasExistentes === 0) {
    for (const [index, nome] of client.funil.entries()) {
      await prisma.pipelineStage.create({
        data: {
          nome,
          ordem: index,
          cor: CORES[index % CORES.length],
          ehGanho: index === client.funil.length - 1,
          ehPerdido: false,
        },
      });
    }
  }

  await confirmarInvarianteEhGanho();
```

Apague a função `reconciliarEtapasOrfas` inteira e a chamada a ela.

- [ ] **Passo 4: encolher o alvo de `confirmarInvarianteEhGanho`**

Substitua o docblock daquela função (mantendo a função) por:

```ts
/**
 * Confere que o banco tem exatamente 1 `PipelineStage` com `ehGanho: true` — o
 * painel calcula a taxa de conversão a partir dessa flag.
 *
 * O alvo encolheu com o CRUD de etapas. Antes esta checagem defendia "exatamente
 * uma, e é a última do funil", garantida pelo laço de upsert acima. A parte "é a
 * última" foi revogada: a etapa de fechamento passou a ser escolhida na tela e
 * pode estar em qualquer posição. O dono da invariante hoje é
 * `core/pipeline/service.ts` (`definirEtapaDeFechamento`, que desliga todas antes
 * de ligar a escolhida, na mesma transação).
 *
 * O que sobra aqui é o alarme, e ele continua valendo a pena: se algum caminho
 * futuro deixar zero ou duas flags ligadas, é aqui que se descobre, em vez de o
 * dado errado seguir silenciosamente para o dashboard.
 */
```

- [ ] **Passo 5: rodar e ver passar**

`npx vitest run tests/unit/seed.test.ts` → PASS

- [ ] **Passo 6: corrigir o guarda do seed de demonstração**

Em `prisma/seed-demo.ts:269-276`, a distribuição *hardcoded* fica; muda a mensagem, que hoje
culpa só `client.funil`:

```ts
  if (etapas.length !== 5) {
    throw new Error(
      `seed-demo.ts assume um funil de 5 etapas — encontrei ${etapas.length} PipelineStage no banco. ` +
        "Duas causas possíveis: (1) o funil nunca foi semeado, e aí rode `npx prisma db seed` primeiro; " +
        "(2) alguém criou ou removeu etapa pela tela /etapas, e aí a distribuição hardcoded " +
        "(CONTAGEM_POR_ETAPA/FAIXA_DIAS_ATRAS) precisa ser ajustada para o novo tamanho do funil. " +
        "O seed de demonstração continua acoplado ao funil de 5 etapas de propósito — ver a § 3 da spec " +
        "docs/superpowers/specs/2026-08-14-crud-etapas-do-funil-design.md."
    );
  }
```

- [ ] **Passo 7: o portão de merge não pode ficar vermelho para sempre**

`tests/unit/seed-demo.test.ts` chama `seedDemo()` num `beforeAll` único do arquivo. Com 6
etapas no banco, aquele `beforeAll` lança e o arquivo inteiro cai — ou seja, `npx vitest run`
sai não-zero para sempre a partir da primeira etapa criada pela tela.

Acrescente, antes do `describe` principal, e troque `describe(` por `describe.skipIf(...)`:

```ts
/**
 * `seedDemo()` exige um funil de exatamente 5 etapas (`seed-demo.ts`), e desde o
 * CRUD de etapas o funil deste banco pode ter qualquer tamanho. Sem esta guarda,
 * a primeira etapa criada pela tela derrubaria o `beforeAll` e, com ele, o
 * arquivo inteiro — deixando `npx vitest run`, que é o portão de merge do
 * projeto, vermelho para sempre por uma razão que não é defeito de ninguém.
 *
 * Pulado com motivo impresso é honesto; vermelho permanente treina a equipe a
 * ignorar o portão, que é o pior desfecho possível.
 */
const funilTemCincoEtapas = (await prisma.pipelineStage.count()) === 5;

describe.skipIf(!funilTemCincoEtapas)("prisma/seed-demo.ts", () => {
```

Se o arquivo não puder usar `await` no topo, mova a contagem para dentro de um
`beforeAll` e use `it.skipIf` por teste — mas prefira o *top-level await*, que o Vitest
suporta em ESM e que este repositório já usa (ver `await import(...)` em
`tests/unit/task-list.test.tsx`).

- [ ] **Passo 8: rodar a suíte inteira**

`npm run typecheck && npm run lint && npx vitest run` → verde.

- [ ] **Passo 9: sabotagem**

Reintroduza o `upsert` por `ordem` no lugar do `create` condicional, rode
`npx vitest run tests/unit/seed.test.ts`. Com o banco de hoje (5 etapas com os nomes do
config) isso pode passar — então a prova real é outra: crie à mão uma etapa
`{ nome: "Sabotagem", ordem: 5, cor: "#000000" }`, rode `npx prisma db seed`, e confirme que
**com o código novo ela sobrevive** e **com o antigo ela é apagada**. Apague a etapa de teste
depois:

```
npx prisma db seed
```

Confirme com uma leitura e limpe:

```sql
SELECT id, nome, ordem FROM "PipelineStage" ORDER BY ordem;
```

- [ ] **Passo 10: sabotagem do portão de merge**

A que prova por que o `describe.skipIf` existe. Crie uma 6ª etapa à mão e rode:

```
npx vitest run tests/unit/seed-demo.test.ts
```

Com o `skipIf`: **pulado, com o motivo impresso**. Sem ele (remova temporariamente): o
`beforeAll` lança e o arquivo inteiro fica **vermelho** — que é o estado em que o portão de
merge do projeto ficaria para sempre a partir da primeira etapa criada pela tela. Restaure o
`skipIf` e apague a etapa de teste.

- [ ] **Passo 11: commit**

```bash
git add prisma/seed.ts prisma/seed-demo.ts tests/unit/seed.test.ts tests/unit/seed-demo.test.ts
git commit -m "refactor(seed): funil vira semente, o banco passa a mandar"
```

---

## Tarefa 3: A contagem que a chave estrangeira enxerga

**Arquivos:**
- Modificar: `src/core/pipeline/stages.ts`
- Modificar: `tests/unit/pipeline-stages.test.ts`

**Interfaces:**
- Produz: `contarLeadsQueSeguramEtapa(): Promise<Record<string, number>>`.

**O defeito que esta tarefa evita:** `contarLeadsPorEtapa()` (`core/leads/queries.ts:165`)
filtra `arquivadoEm: null`. Uma etapa com 0 leads ativos e 5 arquivados apareceria vazia, o
diálogo não pediria destino, e o `delete` bateria na FK `RESTRICT` com um erro genérico. A
etapa ficaria indeletável.

- [ ] **Passo 1: escrever o teste que falha**

Substitua o primeiro `it` de `tests/unit/pipeline-stages.test.ts` (linhas 32-38) e acrescente
o novo `describe`:

```ts
  it("devolve TODAS as linhas de PipelineStage, na ordem de `ordem`", async () => {
    const etapas = await listarEtapas();
    const direto = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });

    // Comparação com o banco, e não com `client.funil`: desde o CRUD de etapas
    // o funil pode ter qualquer tamanho, qualquer nome e `ordem` com buracos
    // (apagar a etapa de ordem 2 deixa 0,1,3,4 — e isso é correto, ver § 5 da
    // spec). A asserção antiga exigia `ordem` DENSA, o contrário direto disso.
    expect(etapas.map((e) => e.id)).toEqual(direto.map((e) => e.id));
    expect(etapas.length).toBeGreaterThanOrEqual(1);
  });
```

Acrescente ao topo do arquivo o import de `prisma` e de `contarLeadsQueSeguramEtapa`:

```ts
import { listarEtapas, contarLeadsQueSeguramEtapa } from "../../src/core/pipeline/stages";
import { prisma } from "../../src/lib/prisma";
```

E o `describe` novo, no fim do arquivo:

```ts
describe("contarLeadsQueSeguramEtapa", () => {
  it("conta arquivados junto — é o número que a chave estrangeira enxerga", async () => {
    const etapa = await prisma.pipelineStage.create({
      data: { nome: `Etapa Teste Contagem ${Date.now()}`, ordem: 9001, cor: "#123456" },
    });
    const contato = await prisma.contact.create({
      data: { nome: "Contato Teste Contagem", telefone: `5511${Date.now()}`.slice(0, 13) },
    });
    const lead = await prisma.lead.create({
      data: {
        contactId: contato.id,
        stageId: etapa.id,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    });

    try {
      const { contarLeadsPorEtapa } = await import("../../src/core/leads/queries");
      const ativos = await contarLeadsPorEtapa();
      const seguram = await contarLeadsQueSeguramEtapa();

      // A distinção inteira em duas linhas: o funil não vê o arquivado, a FK vê.
      expect(ativos[etapa.id] ?? 0).toBe(0);
      expect(seguram[etapa.id]).toBe(1);
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
      await prisma.pipelineStage.delete({ where: { id: etapa.id } });
    }
  });
});
```

O `try/finally` não é estilo: sem ele, uma asserção que falha deixa lead, contato e etapa
no Postgres **de produção**.

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-stages.test.ts`
Esperado: FAIL — `contarLeadsQueSeguramEtapa` não existe.

- [ ] **Passo 3: implementar**

Acrescente em `src/core/pipeline/stages.ts`:

```ts
/**
 * Quantos leads SEGURAM cada etapa — arquivados incluídos.
 *
 * É o número que o `ON DELETE RESTRICT` de `Lead_stageId_fkey` enxerga, e
 * portanto o único que pode decidir se uma etapa é apagável.
 *
 * **Não confundir com `contarLeadsPorEtapa`** (`core/leads/queries.ts`), que
 * filtra `arquivadoEm: null` de propósito porque arquivado sai do funil por
 * definição. As duas divergem sempre que alguém arquivou um lead sem tirá-lo da
 * etapa, que é o caso comum — e usar aquela aqui produziria o pior desfecho
 * desta tela: uma etapa com 5 arquivados e nenhum ativo apareceria vazia, o
 * diálogo de exclusão não pediria destino, e o `delete` morreria na chave
 * estrangeira com uma mensagem que manda "tentar de novo" para uma condição
 * permanente.
 *
 * Mesma distinção que `core/contacts/queries.ts:173-176` já registra: arquivado
 * some das listagens, não some das referências.
 */
export async function contarLeadsQueSeguramEtapa(): Promise<Record<string, number>> {
  const grupos = await prisma.lead.groupBy({
    by: ["stageId"],
    _count: { _all: true },
  });

  const porEtapa: Record<string, number> = {};
  for (const grupo of grupos) {
    porEtapa[grupo.stageId] = grupo._count._all;
  }
  return porEtapa;
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-stages.test.ts` → PASS

- [ ] **Passo 5: sabotagem**

Acrescente `where: { arquivadoEm: null }` ao `groupBy`. Rode o teste → **vermelho** em
`expect(seguram[etapa.id]).toBe(1)`. Desfaça.

- [ ] **Passo 6: commit**

```bash
git add src/core/pipeline/stages.ts tests/unit/pipeline-stages.test.ts
git commit -m "feat(funil): contagem estrutural que enxerga lead arquivado"
```

---

## Tarefa 4: Zod de `nome` e `cor`

**Arquivos:**
- Criar: `src/core/pipeline/schema.ts`
- Criar: `tests/unit/pipeline-schema.test.ts`

**Interfaces:**
- Produz: `etapaSchema` (Zod), `LIMITE_NOME_ETAPA = 40`,
  `type CamposDaEtapa = { nome: string; cor: string }`.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/pipeline-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { etapaSchema, LIMITE_NOME_ETAPA } from "../../src/core/pipeline/schema";

describe("etapaSchema — nome", () => {
  it("aceita um nome comum e apara os espaços das pontas", () => {
    const analisado = etapaSchema.safeParse({ nome: "  Negociação  ", cor: "#0f62fe" });
    expect(analisado.success).toBe(true);
    if (analisado.success) expect(analisado.data.nome).toBe("Negociação");
  });

  it("recusa nome em branco, e a mensagem diz o que fazer", () => {
    const analisado = etapaSchema.safeParse({ nome: "   ", cor: "#0f62fe" });
    expect(analisado.success).toBe(false);
    if (!analisado.success) {
      expect(analisado.error.issues[0].message).toMatch(/em branco/i);
    }
  });

  it(`recusa nome acima de ${LIMITE_NOME_ETAPA} caracteres`, () => {
    const analisado = etapaSchema.safeParse({
      nome: "x".repeat(LIMITE_NOME_ETAPA + 1),
      cor: "#0f62fe",
    });
    expect(analisado.success).toBe(false);
  });
});

describe("etapaSchema — cor", () => {
  it("normaliza para minúsculas: #0F62FE vira #0f62fe", () => {
    const analisado = etapaSchema.safeParse({ nome: "Proposta", cor: "#0F62FE" });
    expect(analisado.success).toBe(true);
    if (analisado.success) expect(analisado.data.cor).toBe("#0f62fe");
  });

  // O teste que dá razão a esta validação existir. `etapa.cor` cai direto num
  // `style={{ borderTopColor }}` do kanban e num `fill=` do gráfico do painel;
  // o `<input type="color">` da tela só produz #rrggbb, mas Server Action é
  // endpoint HTTP e responde a qualquer POST.
  it.each([
    "red",
    "#fff",
    "#0f62f",
    "#0f62fee",
    "red; background: url(x)",
    "rgb(0,0,0)",
    "",
  ])("recusa a cor %j", (cor) => {
    expect(etapaSchema.safeParse({ nome: "Proposta", cor }).success).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-schema.test.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar**

`src/core/pipeline/schema.ts`:

```ts
import { z } from "zod";

/**
 * Validação declarativa dos campos de uma etapa do funil.
 *
 * Segue a decisão da branch de cadastro de contato: Zod valida entrada de
 * usuário dentro de `core/`, com `safeParse` convertido em erro de domínio por
 * quem tem o erro. O `throw` NÃO mora aqui — `EtapaInvalidaError` é declarado em
 * `service.ts`, e `service.ts` importa este arquivo. Importar de volta fecharia
 * um ciclo de módulos, que às vezes funciona em ESM e às vezes entrega
 * `undefined` na hora do `new`.
 */

/**
 * Teto do nome. É limite de produto, não de banco: a coluna é `text`. Quarenta
 * caracteres cabem em "Proposta enviada aguardando retorno" e não cabem numa
 * frase — o nome de etapa é rótulo de coluna do kanban, e um rótulo que quebra
 * em três linhas estraga o quadro para todo mundo.
 */
export const LIMITE_NOME_ETAPA = 40;

export const etapaSchema = z.object({
  nome: z.preprocess(
    (valor) => (typeof valor === "string" ? valor.trim() : valor),
    z
      .string()
      .min(1, "O nome da etapa não pode ficar em branco.")
      .max(LIMITE_NOME_ETAPA, `Nome: o limite é ${LIMITE_NOME_ETAPA} caracteres.`)
  ),

  /**
   * Só `#rrggbb`, minúsculo, sempre.
   *
   * Isto é validação de SEGURANÇA, não de estética. `etapa.cor` atravessa para
   * `style={{ borderTopColor }}` em `components/leads/kanban-board.tsx` e para
   * `fill=` em `components/dashboard/conversion-chart.tsx`. Até esta branch o
   * valor vinha de uma constante do seed; agora vem de quem digitou. O
   * `<input type="color">` da tela só produz este formato — mas ele é
   * conveniência de navegador, e a Server Action responde a qualquer POST.
   *
   * A normalização para minúsculas vem antes da regra para que `#0F62FE` e
   * `#0f62fe` não virem duas cores diferentes na mesma coluna.
   */
  cor: z.preprocess(
    (valor) => (typeof valor === "string" ? valor.trim().toLowerCase() : valor),
    z.string().regex(/^#[0-9a-f]{6}$/, "Cor inválida: use o formato #rrggbb, como #0f62fe.")
  ),
});

export type CamposDaEtapa = z.infer<typeof etapaSchema>;
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-schema.test.ts` → PASS

- [ ] **Passo 5: sabotagem**

Troque o regex por `/^#[0-9a-f]{3,8}$/i`. Rode → **vermelho** em `#fff` e `#0f62fee`.
Desfaça.

- [ ] **Passo 6: commit**

```bash
git add src/core/pipeline/schema.ts tests/unit/pipeline-schema.test.ts
git commit -m "feat(funil): schema zod de nome e cor da etapa"
```

---

## Tarefa 5: Serviço — criar e editar, com nome único

**Arquivos:**
- Criar: `src/core/pipeline/service.ts`
- Criar: `tests/unit/pipeline-service.test.ts`

**Interfaces:**
- Consome: `etapaSchema` (tarefa 4), `registrarAuditoria` (tarefa 1).
- Produz: `EtapaInvalidaError`;
  `criarEtapa(input: { nome: string; cor: string; autorId: string }): Promise<PipelineStage>`;
  `editarEtapa(input: { etapaId: string; nome: string; cor: string; autorId: string }): Promise<PipelineStage>`.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/pipeline-service.test.ts`:

```ts
// Este arquivo usa o Prisma real contra o Postgres do Supabase — mesma
// disciplina de seed.test.ts e audit-log.test.ts. Carrega DATABASE_URL aqui,
// não em vitest.config.ts, para não injetar credencial em teste que não toca
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, vi, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  criarEtapa,
  editarEtapa,
  EtapaInvalidaError,
} from "../../src/core/pipeline/service";

/**
 * TODA etapa criada aqui nasce com prefixo próprio e é apagada no fim. O banco é
 * o mesmo de produção: um teste que falha no meio sem limpar deixa lixo numa
 * base real, e uma etapa órfã aparece no kanban de quem estiver trabalhando.
 */
const PREFIXO = `ZZ Teste Servico ${Date.now()}`;
const criadas: string[] = [];

async function novaEtapa(sufixo: string) {
  const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
  const etapa = await criarEtapa({ nome: `${PREFIXO} ${sufixo}`, cor: "#123456", autorId: admin.id });
  criadas.push(etapa.id);
  return etapa;
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entidadeId: { in: criadas } } });
  await prisma.pipelineStage.deleteMany({ where: { id: { in: criadas } } });
  await prisma.$disconnect();
}, 60_000);

describe("criarEtapa", () => {
  it("nasce no fim do funil, sem ehGanho, com a cor normalizada", async () => {
    const antes = await prisma.pipelineStage.aggregate({ _max: { ordem: true } });
    const etapa = await novaEtapa("nasce no fim");

    expect(etapa.ordem).toBe((antes._max.ordem ?? -1) + 1);
    expect(etapa.ehGanho).toBe(false);
    expect(etapa.ehPerdido).toBe(false);
    expect(etapa.cor).toBe("#123456");
  });

  it("recusa nome repetido, sem diferenciar maiúscula", async () => {
    const etapa = await novaEtapa("repetido");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    await expect(
      criarEtapa({ nome: etapa.nome.toUpperCase(), cor: "#654321", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("recusa cor fora do formato com erro de domínio, não erro do Prisma", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    await expect(
      criarEtapa({ nome: `${PREFIXO} cor ruim`, cor: "red; background: url(x)", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("grava auditoria de criar_etapa", async () => {
    const etapa = await novaEtapa("auditoria");
    const linhas = await prisma.auditLog.findMany({ where: { entidadeId: etapa.id } });

    expect(linhas).toHaveLength(1);
    expect(linhas[0].acao).toBe("criar_etapa");
    expect(linhas[0].entidade).toBe("PipelineStage");
  });
});

describe("editarEtapa", () => {
  it("troca nome e cor sem mexer em ordem nem em ehGanho", async () => {
    const etapa = await novaEtapa("editar");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: `${PREFIXO} editada`,
      cor: "#ABCDEF",
      autorId: admin.id,
    });

    expect(depois.nome).toBe(`${PREFIXO} editada`);
    expect(depois.cor).toBe("#abcdef");
    expect(depois.ordem).toBe(etapa.ordem);
    expect(depois.ehGanho).toBe(etapa.ehGanho);
  });

  // O caminho mais provável do nome duplicado é este, não a criação: quem já
  // tem "Proposta" e "Proposta enviada" renomeia uma delas.
  it("recusa RENOMEAR para um nome que já existe", async () => {
    const primeira = await novaEtapa("alvo do conflito");
    const segunda = await novaEtapa("vai tentar colidir");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    await expect(
      editarEtapa({ etapaId: segunda.id, nome: primeira.nome, cor: "#123456", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("permite salvar a própria etapa sem mudar o nome (não colide consigo mesma)", async () => {
    const etapa = await novaEtapa("mesmo nome");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: etapa.nome,
      cor: "#000000",
      autorId: admin.id,
    });
    expect(depois.cor).toBe("#000000");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-service.test.ts`
Esperado: FAIL — `src/core/pipeline/service.ts` não existe.

- [ ] **Passo 3: implementar**

`src/core/pipeline/service.ts`:

```ts
import "server-only";

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
import { etapaSchema } from "./schema";
import type { PipelineStage } from "@prisma/client";

export class EtapaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EtapaInvalidaError";
  }
}

/** `safeParse` → erro de domínio. Sem isto a falha cairia no ramo genérico da action. */
function validar(entrada: { nome: string; cor: string }) {
  const analisado = etapaSchema.safeParse(entrada);
  if (!analisado.success) {
    throw new EtapaInvalidaError(analisado.error.issues[0].message);
  }
  return analisado.data;
}

/**
 * Recusa nome repetido, ignorando diferença de maiúscula.
 *
 * A checagem é aqui e não no banco: um índice único case-insensitive em Postgres
 * é funcional (`LOWER(nome)`), o Prisma não o representa, e ele viraria drift no
 * próximo diff — o mesmo motivo pelo qual a branch de contato recusou o índice
 * `pg_trgm` (ver `prisma/schema.prisma`).
 *
 * **Isto NÃO é atômico**, e o comentário existe para ninguém acreditar que é.
 * Dois ADMINs criando o mesmo nome no mesmo instante conseguem. Com a permissão
 * restrita a ADMIN a janela é quase inalcançável, e o pior desfecho — duas
 * colunas com o mesmo nome — se conserta renomeando uma. Aceito, não resolvido.
 */
async function recusarNomeRepetido(nome: string, ignorarId: string | null): Promise<void> {
  const existente = await prisma.pipelineStage.findFirst({
    where: {
      nome: { equals: nome, mode: "insensitive" },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true },
  });

  if (existente) {
    throw new EtapaInvalidaError(`Já existe uma etapa chamada "${nome}".`);
  }
}

export async function criarEtapa(input: {
  nome: string;
  cor: string;
  autorId: string;
}): Promise<PipelineStage> {
  const campos = validar(input);
  await recusarNomeRepetido(campos.nome, null);

  // Etapa nova entra no FIM. `ordem` pode ter buracos (apagar a de ordem 2
  // deixa 0,1,3,4) e isso é correto — por isso `max + 1`, e não `count()`.
  const maior = await prisma.pipelineStage.aggregate({ _max: { ordem: true } });

  const etapa = await prisma.pipelineStage.create({
    data: {
      nome: campos.nome,
      cor: campos.cor,
      ordem: (maior._max.ordem ?? -1) + 1,
      ehGanho: false,
      ehPerdido: false,
    },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "criar_etapa",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    depois: { nome: etapa.nome, cor: etapa.cor, ordem: etapa.ordem },
  });

  return etapa;
}

export async function editarEtapa(input: {
  etapaId: string;
  nome: string;
  cor: string;
  autorId: string;
}): Promise<PipelineStage> {
  const campos = validar(input);

  const atual = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!atual) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  await recusarNomeRepetido(campos.nome, atual.id);

  const depois = await prisma.pipelineStage.update({
    where: { id: atual.id },
    data: { nome: campos.nome, cor: campos.cor },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "editar_etapa",
    entidade: "PipelineStage",
    entidadeId: atual.id,
    antes: { nome: atual.nome, cor: atual.cor },
    depois: { nome: depois.nome, cor: depois.cor },
  });

  return depois;
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-service.test.ts` → PASS

- [ ] **Passo 5: confirmar que o banco ficou limpo**

```sql
SELECT id, nome FROM "PipelineStage" WHERE nome LIKE 'ZZ Teste%';
```

Esperado: zero linhas. Se sobrar alguma, o `afterAll` falhou — apague à mão antes de seguir.

- [ ] **Passo 6: sabotagem**

Passe `null` em vez de `atual.id` no `recusarNomeRepetido` de `editarEtapa`. Rode → o teste
"permite salvar a própria etapa sem mudar o nome" fica **vermelho**. Desfaça.

- [ ] **Passo 7: commit**

```bash
git add src/core/pipeline/service.ts tests/unit/pipeline-service.test.ts
git commit -m "feat(funil): criar e editar etapa, com nome unico"
```

---

## Tarefa 6: Serviço — reordenar com estacionamento negativo

**Arquivos:**
- Modificar: `src/core/pipeline/service.ts`
- Criar: `tests/unit/pipeline-transacoes.test.ts`
- Modificar: `tests/unit/pipeline-service.test.ts`

**Interfaces:**
- Produz: `ORDEM_ESTACIONAMENTO = -1`;
  `moverNaOrdem(input: { etapaId: string; direcao: "cima" | "baixo"; autorId: string }): Promise<void>`.

**O problema:** `CREATE UNIQUE INDEX "PipelineStage_ordem_key"` é verificado a cada
`UPDATE`, não no fim da transação. Dois `UPDATE`s diretos falham no primeiro.

- [ ] **Passo 1: escrever o teste de FORMA que falha**

`tests/unit/pipeline-transacoes.test.ts`:

```ts
// Prisma MOCKADO de propósito, e este arquivo é o único lugar onde dá para
// provar o que precisa ser provado: a SEQUÊNCIA de escritas dentro da
// transação. Contra o Postgres real só se vê o resultado — e o resultado é
// idêntico com e sem o estacionamento negativo, quando funciona.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const updateMock = vi.fn();
const updateManyMock = vi.fn();
const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: {
      update: (...a: unknown[]) => updateMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      findFirst: (...a: unknown[]) => findFirstMock(...a),
    },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}));

vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: vi.fn(),
  gravarLinhaDeAuditoria: vi.fn(),
}));

const { moverNaOrdem, ORDEM_ESTACIONAMENTO } = await import("../../src/core/pipeline/service");

/** Executa o callback do `$transaction` com um `tx` espião. */
function transacaoQueRegistra(escritas: unknown[]) {
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      pipelineStage: {
        update: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({});
        },
        updateMany: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({ count: 0 });
        },
      },
    };
    return callback(tx);
  };
}

beforeEach(() => {
  updateMock.mockReset();
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  transactionMock.mockReset();
});

describe("moverNaOrdem — a forma da transação", () => {
  it("emite TRÊS updates, com o estacionamento negativo no meio", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });
    findFirstMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });

    const escritas: any[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-b", direcao: "cima", autorId: "admin-1" });

    expect(escritas).toHaveLength(3);
    // 1º: a etapa que se move sai do caminho.
    expect(escritas[0]).toEqual({ where: { id: "etapa-b" }, data: { ordem: ORDEM_ESTACIONAMENTO } });
    // 2º: a vizinha ocupa a posição que vagou.
    expect(escritas[1]).toEqual({ where: { id: "etapa-a" }, data: { ordem: 1 } });
    // 3º: a que se move ocupa a posição da vizinha.
    expect(escritas[2]).toEqual({ where: { id: "etapa-b" }, data: { ordem: 0 } });
  });

  it("o estacionamento é NEGATIVO — nenhuma etapa real pode ocupar essa posição", () => {
    expect(ORDEM_ESTACIONAMENTO).toBeLessThan(0);
  });

  it("recusa subir a primeira etapa: não há vizinha acima", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });
    findFirstMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-a", direcao: "cima", autorId: "admin-1" })
    ).rejects.toThrow(/já é a primeira/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("recusa descer a última etapa: não há vizinha abaixo", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-z", ordem: 9, nome: "Z" });
    findFirstMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-z", direcao: "baixo", autorId: "admin-1" })
    ).rejects.toThrow(/já é a última/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // Buracos em `ordem` são legais (apagar a de ordem 2 deixa 0,1,3,4). A
  // vizinha é a de ordem imediatamente menor/maior, não `ordem - 1`.
  it("acha a vizinha por comparação, não por aritmética — funciona com buracos", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-d", ordem: 4, nome: "D" });
    findFirstMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });

    const escritas: any[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-d", direcao: "cima", autorId: "admin-1" });

    expect(escritas[1]).toEqual({ where: { id: "etapa-b" }, data: { ordem: 4 } });
    expect(escritas[2]).toEqual({ where: { id: "etapa-d" }, data: { ordem: 1 } });
    expect(findFirstMock.mock.calls[0][0]).toMatchObject({
      where: { ordem: { lt: 4 } },
      orderBy: { ordem: "desc" },
    });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-transacoes.test.ts`
Esperado: FAIL — `moverNaOrdem` não existe.

- [ ] **Passo 3: implementar**

Acrescente em `src/core/pipeline/service.ts`:

```ts
/**
 * Posição de estacionamento usada durante a troca de duas etapas.
 *
 * `PipelineStage_ordem_key` é um índice ÚNICO, e o Postgres o verifica a cada
 * `UPDATE` — não no fim da transação. Trocar as etapas de ordem 0 e 1 com dois
 * `UPDATE`s diretos falha no primeiro, porque por um instante duas linhas
 * teriam a mesma `ordem`.
 *
 * Negativo de propósito: nenhuma etapa real ocupa posição negativa, então o
 * valor nunca colide com uma linha legítima. Ele existe por microssegundos
 * dentro de uma transação atômica — nenhuma leitura o vê.
 *
 * A alternativa idiomática seria uma constraint `DEFERRABLE INITIALLY DEFERRED`,
 * que o Prisma não representa e que viraria drift no próximo diff. Ver § 5 da
 * spec.
 */
export const ORDEM_ESTACIONAMENTO = -1;

export async function moverNaOrdem(input: {
  etapaId: string;
  direcao: "cima" | "baixo";
  autorId: string;
}): Promise<void> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // A vizinha é achada por COMPARAÇÃO, não por `ordem ± 1`: buracos em `ordem`
  // são legais e esperados (apagar a etapa de ordem 2 deixa 0,1,3,4).
  const subindo = input.direcao === "cima";
  const vizinha = await prisma.pipelineStage.findFirst({
    where: subindo ? { ordem: { lt: etapa.ordem } } : { ordem: { gt: etapa.ordem } },
    orderBy: { ordem: subindo ? "desc" : "asc" },
  });

  // A tela não desenha ↑ na primeira nem ↓ na última, mas Server Action é
  // endpoint HTTP público. A página não é a defesa.
  if (!vizinha) {
    throw new EtapaInvalidaError(
      subindo ? "Esta etapa já é a primeira do funil." : "Esta etapa já é a última do funil."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.pipelineStage.update({
      where: { id: etapa.id },
      data: { ordem: ORDEM_ESTACIONAMENTO },
    });
    await tx.pipelineStage.update({
      where: { id: vizinha.id },
      data: { ordem: etapa.ordem },
    });
    await tx.pipelineStage.update({
      where: { id: etapa.id },
      data: { ordem: vizinha.ordem },
    });
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "reordenar_etapa",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    antes: { nome: etapa.nome, ordem: etapa.ordem },
    depois: { nome: etapa.nome, ordem: vizinha.ordem },
  });
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-transacoes.test.ts` → PASS

- [ ] **Passo 5: provar contra o Postgres real, entre etapas do próprio teste**

Acrescente em `tests/unit/pipeline-service.test.ts`:

```ts
describe("moverNaOrdem — contra o banco real", () => {
  // As DUAS etapas são criadas pelo teste, e nascem no fim do funil. A troca
  // escreve só linhas que este teste criou: nenhuma etapa semeada é tocada, e a
  // adjacência das cinco de produção fica intacta durante a execução inteira.
  it("troca duas etapas de posição sem violar UNIQUE(ordem)", async () => {
    const primeira = await novaEtapa("troca A");
    const segunda = await novaEtapa("troca B");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    await moverNaOrdem({ etapaId: segunda.id, direcao: "cima", autorId: admin.id });

    const depoisPrimeira = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: primeira.id } });
    const depoisSegunda = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: segunda.id } });

    expect(depoisSegunda.ordem).toBe(primeira.ordem);
    expect(depoisPrimeira.ordem).toBe(segunda.ordem);
  });

  it("nenhuma etapa fica na posição de estacionamento depois da troca", async () => {
    const estacionadas = await prisma.pipelineStage.count({ where: { ordem: { lt: 0 } } });
    expect(estacionadas).toBe(0);
  });
});
```

E ao import: `moverNaOrdem`.

- [ ] **Passo 6: rodar e ver passar**

`npx vitest run tests/unit/pipeline-service.test.ts` → PASS

- [ ] **Passo 7: sabotagem — a mais importante desta branch**

Remova o primeiro `update` (o do estacionamento) da transação, deixando só os dois diretos.
Rode `npx vitest run tests/unit/pipeline-transacoes.test.ts tests/unit/pipeline-service.test.ts`
→ o de forma fica **vermelho** por contar 2 escritas em vez de 3, e o do banco real fica
**vermelho** com violação de `PipelineStage_ordem_key`. Desfaça.

- [ ] **Passo 8: commit**

```bash
git add src/core/pipeline/service.ts tests/unit/pipeline-transacoes.test.ts tests/unit/pipeline-service.test.ts
git commit -m "feat(funil): reordenar etapa com estacionamento negativo"
```

---

## Tarefa 7: Serviço — a etapa de fechamento

**Arquivos:**
- Modificar: `src/core/pipeline/service.ts`
- Modificar: `tests/unit/pipeline-transacoes.test.ts`

**Interfaces:**
- Produz:
  `definirEtapaDeFechamento(input: { etapaId: string; autorId: string }): Promise<void>`.

**Esta função é provada com Prisma MOCKADO, e não contra o banco real, de propósito.** Ela
desliga `ehGanho` de *todas* as etapas antes de ligar a escolhida — rodá-la contra o
Postgres compartilhado apagaria a flag da "Fechado" de produção, e "limpa o que criou" não
restaura flag de linha que o teste não criou.

- [ ] **Passo 1: escrever o teste que falha**

Acrescente em `tests/unit/pipeline-transacoes.test.ts`:

```ts
describe("definirEtapaDeFechamento — a forma da transação", () => {
  it("desliga TODAS antes de ligar a escolhida, na mesma transação", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-nova", ordem: 3, nome: "Negociação", ehGanho: false });

    const escritas: any[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await definirEtapaDeFechamento({ etapaId: "etapa-nova", autorId: "admin-1" });

    expect(escritas).toHaveLength(2);
    // A ordem importa: ligar antes de desligar deixaria duas flags ativas no
    // meio da transação, e um erro no segundo passo persistiria as duas — que é
    // exatamente o bug que `confirmarInvarianteEhGanho` existe para alarmar.
    expect(escritas[0]).toEqual({ where: { ehGanho: true }, data: { ehGanho: false } });
    expect(escritas[1]).toEqual({ where: { id: "etapa-nova" }, data: { ehGanho: true } });
  });

  it("recusa etapa que não existe mais", async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(
      definirEtapaDeFechamento({ etapaId: "some", autorId: "admin-1" })
    ).rejects.toThrow(/não existe mais/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
```

E acrescente `definirEtapaDeFechamento` ao `await import(...)` no topo do arquivo, e
`updateManyMock.mockReset();` ao `beforeEach`.

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-transacoes.test.ts`
Esperado: FAIL — `definirEtapaDeFechamento` não existe.

- [ ] **Passo 3: implementar**

Acrescente em `src/core/pipeline/service.ts`:

```ts
/**
 * Marca UMA etapa como a de fechamento, desligando a anterior no mesmo commit.
 *
 * O painel calcula a taxa de conversão a partir de `ehGanho`
 * (`app/(painel)/page.tsx`), e o sistema depende de existir exatamente uma etapa
 * com a flag ligada — `confirmarInvarianteEhGanho` (`prisma/seed.ts`) é o alarme
 * que dispara se isso deixar de valer. Até esta branch a invariante era garantida
 * por construção pelo laço do seed; agora é garantida aqui.
 *
 * Desligar vem ANTES de ligar: na ordem inversa, um erro entre os dois passos
 * deixaria duas flags ativas — que é exatamente o bug que o alarme foi escrito
 * para pegar.
 */
export async function definirEtapaDeFechamento(input: {
  etapaId: string;
  autorId: string;
}): Promise<void> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.pipelineStage.updateMany({ where: { ehGanho: true }, data: { ehGanho: false } });
    await tx.pipelineStage.update({ where: { id: etapa.id }, data: { ehGanho: true } });
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "definir_etapa_de_fechamento",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    depois: { nome: etapa.nome },
  });
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-transacoes.test.ts` → PASS

- [ ] **Passo 5: sabotagem**

Inverta as duas escritas (ligar antes de desligar). Rode → **vermelho** na asserção de
ordem. Desfaça.

- [ ] **Passo 6: commit**

```bash
git add src/core/pipeline/service.ts tests/unit/pipeline-transacoes.test.ts
git commit -m "feat(funil): escolher a etapa de fechamento pela tela"
```

---

## Tarefa 8: Serviço — excluir movendo os leads

**Arquivos:**
- Modificar: `src/core/pipeline/service.ts`
- Modificar: `tests/unit/pipeline-service.test.ts`

**Interfaces:**
- Consome: `gravarLinhaDeAuditoria` e `avaliarAtividadeSuspeita` (tarefa 1).
- Produz:
  `excluirEtapa(input: { etapaId: string; destinoId: string | null; autorId: string }): Promise<number>`
  — devolve quantos leads foram movidos.

- [ ] **Passo 1: escrever o teste que falha**

Acrescente em `tests/unit/pipeline-service.test.ts`:

```ts
describe("excluirEtapa", () => {
  it("etapa vazia sai sem destino", async () => {
    const etapa = await novaEtapa("vazia");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    const movidos = await excluirEtapa({ etapaId: etapa.id, destinoId: null, autorId: admin.id });

    expect(movidos).toBe(0);
    expect(await prisma.pipelineStage.findUnique({ where: { id: etapa.id } })).toBeNull();
  });

  // O caso que nenhum outro teste alcança, e o motivo de `contarLeadsQueSeguramEtapa`
  // existir: arquivar NÃO tira o lead da etapa, e a FK é ON DELETE RESTRICT.
  it("etapa com lead ARQUIVADO recusa sem destino — com erro de domínio, não P2003", async () => {
    const etapa = await novaEtapa("so arquivado");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    const contato = await prisma.contact.create({
      data: { nome: "Contato Teste Arquivado", telefone: `5511${Date.now()}`.slice(0, 13) },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contato.id, stageId: etapa.id, canal: "MANUAL", arquivadoEm: new Date() },
    });

    try {
      await expect(
        excluirEtapa({ etapaId: etapa.id, destinoId: null, autorId: admin.id })
      ).rejects.toBeInstanceOf(EtapaInvalidaError);
      // E a etapa continua lá — a recusa aconteceu ANTES de qualquer escrita.
      expect(await prisma.pipelineStage.findUnique({ where: { id: etapa.id } })).not.toBeNull();
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("com destino, move o arquivado junto e apaga a etapa", async () => {
    const origem = await novaEtapa("origem");
    const destino = await novaEtapa("destino");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    const contato = await prisma.contact.create({
      data: { nome: "Contato Teste Movido", telefone: `5511${Date.now()}`.slice(0, 13) },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contato.id, stageId: origem.id, canal: "MANUAL", arquivadoEm: new Date() },
    });

    try {
      const movidos = await excluirEtapa({
        etapaId: origem.id,
        destinoId: destino.id,
        autorId: admin.id,
      });

      expect(movidos).toBe(1);
      const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(depois.stageId).toBe(destino.id);
      // Mudar a estrutura do funil não é interação com o lead.
      expect(depois.arquivadoEm).not.toBeNull();
      expect(await prisma.pipelineStage.findUnique({ where: { id: origem.id } })).toBeNull();
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("a auditoria registra o número REAL de leads movidos, e nasce junto com a exclusão", async () => {
    const origem = await novaEtapa("auditoria origem");
    const destino = await novaEtapa("auditoria destino");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    const contato = await prisma.contact.create({
      data: { nome: "Contato Teste Auditoria", telefone: `5511${Date.now()}`.slice(0, 13) },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contato.id, stageId: origem.id, canal: "MANUAL", arquivadoEm: new Date() },
    });

    try {
      await excluirEtapa({ etapaId: origem.id, destinoId: destino.id, autorId: admin.id });

      const linha = await prisma.auditLog.findFirstOrThrow({
        where: { entidadeId: origem.id, acao: "excluir_etapa" },
      });
      expect((linha.depois as { leadsMovidos: number }).leadsMovidos).toBe(1);
      expect((linha.depois as { destinoId: string }).destinoId).toBe(destino.id);
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("recusa apagar a etapa de fechamento", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    const fechamento = await prisma.pipelineStage.findFirstOrThrow({ where: { ehGanho: true } });

    await expect(
      excluirEtapa({ etapaId: fechamento.id, destinoId: null, autorId: admin.id })
    ).rejects.toThrow(/fechamento/i);
    // Não escreveu nada: a etapa de produção continua lá, com a flag intacta.
    const depois = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: fechamento.id } });
    expect(depois.ehGanho).toBe(true);
  });
});
```

Acrescente `excluirEtapa` ao import.

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-service.test.ts`
Esperado: FAIL — `excluirEtapa` não existe.

- [ ] **Passo 3: implementar**

Acrescente em `src/core/pipeline/service.ts` (e ao topo,
`import { gravarLinhaDeAuditoria, registrarAuditoria } from "@/core/audit/log";` e
`import { avaliarAtividadeSuspeita } from "@/core/audit/alerta";`):

```ts
/**
 * Remove uma etapa, movendo antes todos os leads dela para um destino.
 *
 * Devolve quantos leads foram movidos.
 *
 * ## Por que a transação é INTERATIVA e não a de array
 *
 * Na forma `$transaction([...])` nenhuma operação pode depender do resultado de
 * outra — e o número de leads movidos só existe depois que o `updateMany` roda.
 * Auditar um número lido ANTES da transação seria auditar uma estimativa.
 *
 * ## Por que a linha de auditoria nasce DENTRO
 *
 * Esta é a única entrada forense da operação: não há uma entrada por lead, de
 * propósito — 40 linhas `mover_etapa` afogariam a que importa. E a etapa de
 * origem deixa de existir, então não há de onde reconstituir para onde os leads
 * foram. Ou a etapa some com o rastro, ou nada some. Mesmo raciocínio do
 * fail-closed da exportação de leads, registrado em `core/audit/log.ts`.
 *
 * `avaliarAtividadeSuspeita` fica FORA: ela faz `count`, `findMany` de ADMINs e
 * `createMany` de notificações, e rodar isso segurando lock em linhas de `Lead`
 * alonga a transação por trabalho que não é do domínio dela. A falha dela é
 * engolida, como no funil normal — o registro já está gravado.
 */
export async function excluirEtapa(input: {
  etapaId: string;
  destinoId: string | null;
  autorId: string;
}): Promise<number> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  if (etapa.ehGanho) {
    throw new EtapaInvalidaError(
      "Esta é a etapa de fechamento. Marque outra etapa como fechamento antes de remover esta."
    );
  }

  if ((await prisma.pipelineStage.count()) <= 1) {
    throw new EtapaInvalidaError("O funil precisa de pelo menos uma etapa.");
  }

  // Contagem SEM filtro de `arquivadoEm`: é o número que o `ON DELETE RESTRICT`
  // enxerga. `contarLeadsPorEtapa` (`core/leads/queries.ts`) filtra arquivados e
  // faria uma etapa com 5 arquivados parecer vazia — o `delete` morreria na FK
  // e a etapa ficaria indeletável com um erro genérico.
  const leadsQueSeguram = await prisma.lead.count({ where: { stageId: etapa.id } });

  let destino: PipelineStage | null = null;
  if (leadsQueSeguram > 0) {
    if (!input.destinoId) {
      throw new EtapaInvalidaError(
        `Esta etapa ainda tem ${leadsQueSeguram} lead(s), incluindo arquivados. ` +
          "Escolha para onde eles vão."
      );
    }
    destino = await prisma.pipelineStage.findUnique({ where: { id: input.destinoId } });
    if (!destino || destino.id === etapa.id) {
      throw new EtapaInvalidaError("Escolha uma etapa de destino diferente desta.");
    }
  }

  const leadsMovidos = await prisma.$transaction(async (tx) => {
    let movidos = 0;
    if (destino) {
      // Sem filtro de `arquivadoEm`, e correto assim: a etapa vai deixar de
      // existir, então quem segura a chave estrangeira tem que sair junto.
      //
      // NÃO toca `ultimaInteracaoEm`: mudar a estrutura do funil não é interação
      // com o lead, e marcar 40 leads como interagidos hoje corromperia a única
      // coluna que diz o contrário.
      const resultado = await tx.lead.updateMany({
        where: { stageId: etapa.id },
        data: { stageId: destino.id },
      });
      movidos = resultado.count;
    }

    await tx.pipelineStage.delete({ where: { id: etapa.id } });

    await gravarLinhaDeAuditoria(
      {
        userId: input.autorId,
        acao: "excluir_etapa",
        entidade: "PipelineStage",
        entidadeId: etapa.id,
        antes: { nome: etapa.nome, ordem: etapa.ordem, cor: etapa.cor },
        // O `count` da própria escrita, nunca uma leitura anterior.
        depois: { destinoId: destino?.id ?? null, leadsMovidos: movidos },
      },
      tx
    );

    return movidos;
  });

  try {
    await avaliarAtividadeSuspeita({ userId: input.autorId, acao: "excluir_etapa" });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }

  return leadsMovidos;
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-service.test.ts` → PASS

- [ ] **Passo 5: confirmar que o banco ficou limpo**

```sql
SELECT id, nome FROM "PipelineStage" WHERE nome LIKE 'ZZ Teste%';
SELECT id, nome FROM "Contact" WHERE nome LIKE 'Contato Teste%';
```

Esperado: zero linhas nas duas.

- [ ] **Passo 6: sabotagem**

Troque `prisma.lead.count({ where: { stageId: etapa.id } })` por uma contagem que filtre
arquivados:

```ts
const leadsQueSeguram = await prisma.lead.count({
  where: { stageId: etapa.id, arquivadoEm: null },
});
```

Rode → o teste "etapa com lead ARQUIVADO recusa sem destino" fica **vermelho**, com violação
da FK `Lead_stageId_fkey` em vez de `EtapaInvalidaError`. Desfaça.

Segunda sabotagem, a da invariante do fechamento: remova o bloco

```ts
  if (etapa.ehGanho) { throw new EtapaInvalidaError(...); }
```

Rode → "recusa apagar a etapa de fechamento" fica **vermelho**. **Desfaça imediatamente e
confirme no banco** que a "Fechado" de produção continua com `ehGanho: true` — esta é a
única sabotagem do plano que, se rodada com o código quebrado, apagaria uma etapa real:

```sql
SELECT nome, "ehGanho" FROM "PipelineStage" WHERE "ehGanho" = true;
```

- [ ] **Passo 7: commit**

```bash
git add src/core/pipeline/service.ts tests/unit/pipeline-service.test.ts
git commit -m "feat(funil): excluir etapa movendo os leads, auditado no mesmo commit"
```

---

## Tarefa 9: As cinco Server Actions

**Arquivos:**
- Criar: `src/core/pipeline/actions.ts`
- Criar: `tests/unit/pipeline-actions.test.ts`

**Interfaces:**
- Consome: tudo de `service.ts`.
- Produz, todas `Promise<ResultadoAcao>`:
  `criarEtapaAction({ nome, cor })`,
  `editarEtapaAction({ etapaId, nome, cor })`,
  `moverEtapaNaOrdemAction({ etapaId, direcao })`,
  `definirEtapaDeFechamentoAction(etapaId)`,
  `excluirEtapaAction({ etapaId, destinoId })`.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/pipeline-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const { EtapaInvalidaErroFalso } = vi.hoisted(() => {
  class EtapaInvalidaErroFalso extends Error {
    constructor(m: string) {
      super(m);
      this.name = "EtapaInvalidaError";
    }
  }
  return { EtapaInvalidaErroFalso };
});

const criarEtapaMock = vi.fn();
const editarEtapaMock = vi.fn();
const moverNaOrdemMock = vi.fn();
const definirFechamentoMock = vi.fn();
const excluirEtapaMock = vi.fn();

vi.mock("@/core/pipeline/service", () => ({
  EtapaInvalidaError: EtapaInvalidaErroFalso,
  criarEtapa: (...a: unknown[]) => criarEtapaMock(...a),
  editarEtapa: (...a: unknown[]) => editarEtapaMock(...a),
  moverNaOrdem: (...a: unknown[]) => moverNaOrdemMock(...a),
  definirEtapaDeFechamento: (...a: unknown[]) => definirFechamentoMock(...a),
  excluirEtapa: (...a: unknown[]) => excluirEtapaMock(...a),
}));

const acoes = await import("../../src/core/pipeline/actions");

beforeEach(() => {
  revalidatePathMock.mockReset();
  usuarioAtualMock.mockReset().mockResolvedValue({ id: "admin-1", papel: "ADMIN" });
  criarEtapaMock.mockReset().mockResolvedValue({ id: "etapa-1" });
  editarEtapaMock.mockReset().mockResolvedValue({ id: "etapa-1" });
  moverNaOrdemMock.mockReset().mockResolvedValue(undefined);
  definirFechamentoMock.mockReset().mockResolvedValue(undefined);
  excluirEtapaMock.mockReset().mockResolvedValue(0);
});

describe("permissão", () => {
  it.each([
    ["GESTOR"],
    ["VENDEDOR"],
  ])("%s não gerencia o funil: recusa sem chamar o serviço", async (papel) => {
    usuarioAtualMock.mockResolvedValue({ id: "u-1", papel });

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/permissão/i) });
    expect(criarEtapaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("contrato ResultadoAcao", () => {
  it("sucesso devolve { ok: true } e NUNCA a linha do banco", async () => {
    criarEtapaMock.mockResolvedValue({
      id: "etapa-1", nome: "Nova", cor: "#0f62fe", ordem: 5, ehGanho: false, ehPerdido: false,
    });

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    // O retorno de Server Action é serializado para o navegador. Devolver a
    // linha mandaria colunas que a tela não pede — mesmo padrão que produziu o
    // vazamento do funil e que a branch anterior fechou.
    expect(resultado).toEqual({ ok: true });
  });

  it("erro de domínio vira { ok: false } com a frase do serviço, sem lançar", async () => {
    criarEtapaMock.mockRejectedValue(new EtapaInvalidaErroFalso('Já existe uma etapa chamada "Proposta".'));

    const resultado = await acoes.criarEtapaAction({ nome: "Proposta", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: 'Já existe uma etapa chamada "Proposta".' });
  });

  it("erro inesperado NÃO vaza detalhe para a tela", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    criarEtapaMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).not.toMatch(/ECONNREFUSED/);
    erroDoConsole.mockRestore();
  });

  it("sessão inválida vira a mensagem de sessão, não a genérica", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/sessão expirou/i) });
    erroDoConsole.mockRestore();
  });
});

describe("invalidação de cache", () => {
  const CINCO_CAMINHOS = [
    ["/"],
    ["/leads"],
    ["/leads/kanban"],
    ["/(painel)/leads/[id]", "page"],
    ["/(painel)/contatos/[id]", "page"],
  ];

  it("uma etapa criada invalida os CINCO caminhos", async () => {
    await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });
    expect(revalidatePathMock.mock.calls).toEqual(CINCO_CAMINHOS);
  });

  // `/contatos/[id]` é o mais fácil de esquecer, e o que motivou esta asserção:
  // `contatos/[id]/page.tsx` renderiza a coluna "Etapa" via `lead.etapaNome`.
  it("renomear invalida o detalhe do CONTATO também", async () => {
    await acoes.editarEtapaAction({ etapaId: "etapa-1", nome: "Renomeada", cor: "#0f62fe" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/(painel)/contatos/[id]", "page");
  });

  it("ação recusada não invalida nada", async () => {
    criarEtapaMock.mockRejectedValue(new EtapaInvalidaErroFalso("Nome repetido."));
    await acoes.criarEtapaAction({ nome: "Proposta", cor: "#0f62fe" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["moverEtapaNaOrdemAction", () => acoes.moverEtapaNaOrdemAction({ etapaId: "e-1", direcao: "cima" as const })],
    ["definirEtapaDeFechamentoAction", () => acoes.definirEtapaDeFechamentoAction("e-1")],
    ["excluirEtapaAction", () => acoes.excluirEtapaAction({ etapaId: "e-1", destinoId: "e-2" })],
  ])("%s invalida os cinco caminhos", async (_nome, chamar) => {
    await chamar();
    expect(revalidatePathMock.mock.calls).toEqual(CINCO_CAMINHOS);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/pipeline-actions.test.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar**

`src/core/pipeline/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import {
  criarEtapa,
  editarEtapa,
  moverNaOrdem,
  definirEtapaDeFechamento,
  excluirEtapa,
  EtapaInvalidaError,
} from "./service";

/**
 * Server Actions da gestão do funil.
 *
 * Todas devolvem `ResultadoAcao` em vez de lançar — o Next redige erro não
 * tratado em produção, e aqui a distinção entre "já existe uma etapa com esse
 * nome", "esta é a etapa de fechamento" e "banco fora do ar" é justamente o que
 * faz a pessoa agir diferente. Ver `src/lib/acao.ts`.
 *
 * Todas exigem `gerenciar_funil` (só ADMIN). A checagem é aqui, no servidor:
 * esconder o item do menu não protege nada, porque Server Action é endpoint HTTP
 * público e pode ser chamada direto.
 *
 * `autorId` sempre sai de `usuarioAtual()`, nunca de parâmetro.
 */

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para gerenciar o funil.";

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof EtapaInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação sobre o funil negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

/**
 * Roda SEMPRE dentro do `try`. Fora dele, uma sessão expirada rejeitaria a
 * promise sem produzir `ResultadoAcao`, e a tela não mostraria nem sucesso nem
 * erro — achado real de revisão nas actions do WhatsApp.
 */
async function exigirGestorDoFunil() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "gerenciar_funil")) {
    throw new EtapaInvalidaError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

/**
 * Invalidação explícita, caminho por caminho, no molde de
 * `invalidarCaminhosDeLead` (`core/leads/actions.ts`).
 *
 * Os dois últimos usam PADRÃO de rota com `type: "page"`, e não caminho literal,
 * porque aqui não existe UM lead ou UM contato afetado: renomear "Proposta" muda
 * o `<select>` de todo lead e a coluna "Etapa" de toda pessoa que tenha um lead
 * ali. O prefixo `/(painel)` entra porque `revalidatePath` opera na estrutura de
 * ARQUIVOS da rota, não na URL visível — ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
 * e o comentário longo em `core/leads/actions.ts:82-98`.
 *
 * Não confiar no comportamento temporário: a mesma doc diz que hoje
 * `revalidatePath` também atualiza páginas já visitadas, e que isso "is temporary".
 * É o que mascararia um caminho esquecido nesta lista.
 */
function invalidarCaminhosDeFunil() {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/kanban");
  revalidatePath("/(painel)/leads/[id]", "page");
  revalidatePath("/(painel)/contatos/[id]", "page");
}

export async function criarEtapaAction(dados: { nome: string; cor: string }): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await criarEtapa({ nome: dados.nome, cor: dados.cor, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível criar a etapa. Tente novamente.");
  }
  // Fora do `try`: invalidar cache não faz parte de "a etapa foi criada". Uma
  // falha de revalidação viraria "não foi possível criar" para uma etapa que JÁ
  // existe no banco, e a pessoa tentaria de novo — colidindo no nome.
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function editarEtapaAction(dados: {
  etapaId: string;
  nome: string;
  cor: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await editarEtapa({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível salvar a etapa. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function moverEtapaNaOrdemAction(dados: {
  etapaId: string;
  direcao: "cima" | "baixo";
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await moverNaOrdem({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível reordenar o funil. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function definirEtapaDeFechamentoAction(etapaId: string): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await definirEtapaDeFechamento({ etapaId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível marcar a etapa de fechamento. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function excluirEtapaAction(dados: {
  etapaId: string;
  destinoId: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await excluirEtapa({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível remover a etapa. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run tests/unit/pipeline-actions.test.ts` → PASS

- [ ] **Passo 5: sabotagem**

Remova `revalidatePath("/(painel)/contatos/[id]", "page")` de `invalidarCaminhosDeFunil`.
Rode → **vermelho** em "renomear invalida o detalhe do CONTATO também" e nos cinco caminhos.
Desfaça.

- [ ] **Passo 6: commit**

```bash
git add src/core/pipeline/actions.ts tests/unit/pipeline-actions.test.ts
git commit -m "feat(funil): cinco server actions com ResultadoAcao"
```

---

## Tarefa 10: O painel para de presumir cinco etapas

**Arquivos:**
- Modificar: `src/components/dashboard/stage-summary.tsx:19,26,28`
- Modificar: `src/components/dashboard/conversion-chart.tsx:30`
- Modificar: `src/app/(painel)/page.tsx:53-58`

**Interfaces:** nenhuma nova. Três linhas de código e dois comentários.

**Por que está no escopo:** `md:grid-cols-5` é o único lugar do sistema onde o tamanho do
funil está fixado em constante de layout — exatamente o número que esta branch torna
variável. Com seis etapas, um cartão fica sozinho numa segunda linha.

- [ ] **Passo 1: soltar o grid**

Em `src/components/dashboard/stage-summary.tsx:26`, troque:

```tsx
    <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
```

`auto-fit` colapsa as trilhas vazias e distribui o `1fr` entre as que sobram: com as cinco
etapas semeadas o resultado é **idêntico ao de hoje**.

- [ ] **Passo 2: trocar a chave do React**

Em `stage-summary.tsx:28`, `key={etapa.nome}` vira `key={etapa.id}` — e o mesmo `<Card>`
ganha `data-testid="cartao-de-etapa"`, de que a asserção do painel no e2e da tarefa 12
depende:

```tsx
        <Card key={etapa.id} data-testid="cartao-de-etapa">
```

Em `conversion-chart.tsx:30`, `<Cell key={etapa.nome} .../>` vira `<Cell key={etapa.id} .../>`.

Se `ConversionChart` ainda não receber `id` na prop, acrescente ao tipo e ao `.map()` do
servidor que a alimenta (`app/(painel)/page.tsx`).

O motivo não é a corrida de nome duplicado — com um ADMIN só ela é quase inalcançável. É
que `id` já é a chave do kanban e do `<select>` de etapa, e o painel deixa de se apoiar numa
unicidade que o serviço declaradamente não garante no banco.

- [ ] **Passo 3: corrigir os dois comentários que passaram a mentir**

Em `src/app/(painel)/page.tsx:53-58`, o comentário afirma que a etapa ganha é *"SEMPRE a
última do funil e SEMPRE única — invariante garantida por `confirmarInvarianteEhGanho()`
(prisma/seed.ts)"*. Substitua por:

```tsx
  // A etapa de fechamento é ÚNICA, mas não é mais "a última do funil": desde o
  // CRUD de etapas ela é escolhida na tela (`/etapas`) e pode estar em qualquer
  // posição. Quem garante a unicidade é `definirEtapaDeFechamento`
  // (`core/pipeline/service.ts`), que desliga todas antes de ligar a escolhida na
  // mesma transação; `confirmarInvarianteEhGanho()` (prisma/seed.ts) continua
  // como alarme, checando só "exatamente uma".
  //
  // `etapaGanho` pode vir `undefined` num banco recém-criado, antes do primeiro
  // seed — daí o `?? 0` abaixo.
```

Em `src/components/dashboard/stage-summary.tsx:19`, troque *"(Task 9: exatamente uma, sempre
a última do funil)"* por *"(exatamente uma; a posição dela no funil é escolhida em
`/etapas`)"*.

Estes dois comentários não têm teste, tipo nem lint que os aponte um dia. Ou saem nesta
branch, ou ficam para sempre.

- [ ] **Passo 4: rodar a suíte**

`npm run typecheck && npm run lint && npx vitest run` → verde.

- [ ] **Passo 5: conferir a olho que o painel não mudou com 5 etapas**

Suba o dev server **em segundo plano** (nunca de forma bloqueante) e abra `/`. Os cinco
cartões devem estar exatamente como antes.

- [ ] **Passo 6: commit**

```bash
git add src/components/dashboard/stage-summary.tsx src/components/dashboard/conversion-chart.tsx "src/app/(painel)/page.tsx"
git commit -m "fix(painel): grid deixa de fixar cinco etapas"
```

---

## Tarefa 11: A tela `/etapas`

**Arquivos:**
- Criar: `src/app/(painel)/etapas/page.tsx`
- Criar: `src/components/pipeline/etapa-form.tsx`
- Criar: `src/components/pipeline/etapas-table.tsx`
- Criar: `src/components/pipeline/editar-etapa-dialogo.tsx`
- Criar: `src/components/pipeline/excluir-etapa-dialogo.tsx`
- Criar: `tests/unit/etapas-table.test.tsx`
- Modificar: `src/components/nav-links.tsx:10,22-29`
- Modificar: `src/components/painel-nav.tsx:38-45`

**Interfaces:**
- Consome: as cinco actions da tarefa 9; `listarEtapas` e `contarLeadsQueSeguramEtapa`
  (tarefa 3); `contarLeadsPorEtapa` (`core/leads/queries.ts`).
- Produz: `type EtapaNaTela = { id: string; nome: string; cor: string; ehGanho: boolean; leadsAtivos: number; leadsTotais: number }`.

- [ ] **Passo 1: escrever o teste de componente que falha**

`tests/unit/etapas-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const moverMock = vi.fn();
const definirFechamentoMock = vi.fn();
const excluirMock = vi.fn();
const editarMock = vi.fn();
vi.mock("@/core/pipeline/actions", () => ({
  moverEtapaNaOrdemAction: (...a: unknown[]) => moverMock(...a),
  definirEtapaDeFechamentoAction: (...a: unknown[]) => definirFechamentoMock(...a),
  excluirEtapaAction: (...a: unknown[]) => excluirMock(...a),
  editarEtapaAction: (...a: unknown[]) => editarMock(...a),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { EtapasTable } = await import("../../src/components/pipeline/etapas-table");

const ETAPAS = [
  { id: "e-1", nome: "Novo", cor: "#0f62fe", ehGanho: false, leadsAtivos: 4, leadsTotais: 4 },
  { id: "e-2", nome: "Proposta", cor: "#24a148", ehGanho: false, leadsAtivos: 0, leadsTotais: 3 },
  { id: "e-3", nome: "Fechado", cor: "#8a3ffc", ehGanho: true, leadsAtivos: 2, leadsTotais: 2 },
];

afterEach(() => {
  cleanup();
  moverMock.mockReset();
  definirFechamentoMock.mockReset();
  excluirMock.mockReset();
  refreshMock.mockReset();
});

describe("EtapasTable — setas", () => {
  it("a primeira linha não tem seta para cima", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const primeira = screen.getByText("Novo").closest("tr")!;
    expect(primeira.querySelector('[aria-label="Subir etapa"]')).toBeNull();
    expect(primeira.querySelector('[aria-label="Descer etapa"]')).not.toBeNull();
  });

  it("a última linha não tem seta para baixo", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const ultima = screen.getByText("Fechado").closest("tr")!;
    expect(ultima.querySelector('[aria-label="Descer etapa"]')).toBeNull();
    expect(ultima.querySelector('[aria-label="Subir etapa"]')).not.toBeNull();
  });

  it("clicar em subir chama a action com a direção certa", async () => {
    moverMock.mockResolvedValue({ ok: true });
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Subir etapa"]')!);

    await waitFor(() =>
      expect(moverMock).toHaveBeenCalledWith({ etapaId: "e-2", direcao: "cima" })
    );
  });

  it("falha de REDE avisa em vez de ficar em silêncio", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    moverMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Subir etapa"]')!);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/falar com o servidor/i)
    );
    erroDoConsole.mockRestore();
  });
});

describe("EtapasTable — marcador de fechamento", () => {
  it("a etapa de fechamento mostra badge, não botão", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Fechado").closest("tr")!;
    expect(linha.textContent).toMatch(/Fechamento/);
    expect(
      Array.from(linha.querySelectorAll("button")).some(
        (b) => b.textContent === "Marcar como fechamento"
      )
    ).toBe(false);
  });

  it("as demais mostram o botão de marcar", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Novo").closest("tr")!;
    expect(
      Array.from(linha.querySelectorAll("button")).some(
        (b) => b.textContent === "Marcar como fechamento"
      )
    ).toBe(true);
  });
});

describe("EtapasTable — contagem", () => {
  // O número que a tela mostra é o ESTRUTURAL. Mostrar só os ativos faria a
  // etapa "Proposta" (0 ativos, 3 arquivados) parecer vazia — e vazia é
  // justamente a que o usuário tenta apagar sem escolher destino.
  it("mostra o total, e separa os ativos quando divergem", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Proposta").closest("tr")!;
    expect(linha.textContent).toMatch(/3/);
    expect(linha.textContent).toMatch(/0 ativos/);
  });

  it("etapa sem divergência mostra um número só", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Novo").closest("tr")!;
    expect(linha.textContent).not.toMatch(/ativos/);
  });
});

describe("EtapasTable — exclusão", () => {
  it("etapa COM leads exige destino: confirmar fica desabilitado até escolher", async () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Remover etapa"]')!);

    const confirmar = await screen.findByRole("button", { name: "Remover etapa" });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Mover os leads para"), { target: { value: "e-1" } });
    await waitFor(() => expect((confirmar as HTMLButtonElement).disabled).toBe(false));
  });

  it("etapa SEM lead nenhum não pede destino", async () => {
    const vazia = [
      { id: "e-9", nome: "Vazia", cor: "#000000", ehGanho: false, leadsAtivos: 0, leadsTotais: 0 },
      ...ETAPAS,
    ];
    render(<EtapasTable etapas={vazia} />);
    const linha = screen.getByText("Vazia").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Remover etapa"]')!);

    await screen.findByRole("button", { name: "Remover etapa" });
    expect(screen.queryByLabelText("Mover os leads para")).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run tests/unit/etapas-table.test.tsx`
Esperado: FAIL — os componentes não existem.

- [ ] **Passo 3: o diálogo de exclusão**

`src/components/pipeline/excluir-etapa-dialogo.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Diálogo próprio, e não `ConfirmarDialogo`, porque este precisa de um campo: a
 * etapa vai deixar de existir e os leads dela têm que ir para algum lugar.
 *
 * O `<select>` aparece quando `leadsTotais > 0` — TOTAL, arquivados incluídos.
 * Decidir por leads ativos faria uma etapa com 5 arquivados parecer vazia, o
 * diálogo não pediria destino, e o `delete` morreria na chave estrangeira. Ver
 * `contarLeadsQueSeguramEtapa` (`core/pipeline/stages.ts`).
 */
export function ExcluirEtapaDialogo({
  nome,
  leadsAtivos,
  leadsTotais,
  destinosPossiveis,
  onConfirmar,
}: {
  nome: string;
  leadsAtivos: number;
  leadsTotais: number;
  destinosPossiveis: { id: string; nome: string }[];
  onConfirmar: (destinoId: string | null) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [destinoId, setDestinoId] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  const precisaDeDestino = leadsTotais > 0;
  const arquivados = leadsTotais - leadsAtivos;

  const descricao = precisaDeDestino
    ? `Esta etapa tem ${leadsTotais} lead(s)` +
      (arquivados > 0 ? ` (${leadsAtivos} ativos, ${arquivados} arquivados)` : "") +
      ". Todos serão movidos para a etapa que você escolher."
    : `A etapa "${nome}" não tem nenhum lead e será removida do funil.`;

  async function confirmar() {
    setConfirmando(true);
    try {
      await onConfirmar(precisaDeDestino ? destinoId : null);
      setAberto(false);
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Remover etapa"
        onClick={() => setAberto(true)}
      >
        Remover
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Remover &ldquo;{nome}&rdquo;?</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>

          {precisaDeDestino && (
            <div className="space-y-1">
              <label htmlFor="destino-da-etapa" className="text-sm font-medium">
                Mover os leads para
              </label>
              <select
                id="destino-da-etapa"
                className="w-full rounded-md border px-2 py-1 text-sm"
                value={destinoId}
                onChange={(evento) => setDestinoId(evento.target.value)}
              >
                <option value="">Escolha uma etapa</option>
                {destinosPossiveis.map((destino) => (
                  <option key={destino.id} value={destino.id}>
                    {destino.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={confirmando}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmar}
              disabled={confirmando || (precisaDeDestino && destinoId === "")}
            >
              {confirmando ? "Removendo..." : "Remover etapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Passo 4: o diálogo de edição**

`src/components/pipeline/editar-etapa-dialogo.tsx`:

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Nome e cor, num diálogo — não edição *inline*.
 *
 * O nome de uma etapa é vocabulário compartilhado por todo mundo que usa o CRM,
 * e um campo que salva ao sair do foco torna fácil demais renomear sem querer.
 */
export function EditarEtapaDialogo({
  nomeAtual,
  corAtual,
  onSalvar,
}: {
  nomeAtual: string;
  corAtual: string;
  onSalvar: (dados: { nome: string; cor: string }) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(nomeAtual);
  const [cor, setCor] = useState(corAtual);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await onSalvar({ nome, cor });
      setAberto(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" aria-label="Editar etapa" onClick={() => setAberto(true)}>
        Editar
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Editar etapa</DialogTitle>

          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="nome-da-etapa" className="text-sm font-medium">
                Nome
              </label>
              <Input
                id="nome-da-etapa"
                value={nome}
                maxLength={40}
                onChange={(evento) => setNome(evento.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cor-da-etapa" className="text-sm font-medium">
                Cor
              </label>
              {/* `<input type="color">` só produz #rrggbb. Isso é conveniência —
                  a defesa é o regex no servidor (`core/pipeline/schema.ts`). */}
              <input
                id="cor-da-etapa"
                type="color"
                className="h-9 w-16 rounded border"
                value={cor}
                onChange={(evento) => setCor(evento.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Passo 5: a tabela**

`src/components/pipeline/etapas-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarFalhaDeRede, type ResultadoAcao } from "@/lib/acao";
import {
  definirEtapaDeFechamentoAction,
  editarEtapaAction,
  excluirEtapaAction,
  moverEtapaNaOrdemAction,
} from "@/core/pipeline/actions";
import { EditarEtapaDialogo } from "./editar-etapa-dialogo";
import { ExcluirEtapaDialogo } from "./excluir-etapa-dialogo";

/**
 * DTO montado no servidor. NENHUMA linha crua de `PipelineStage` atravessa a
 * fronteira — mesma regra que o quadro do funil passou a seguir.
 */
export type EtapaNaTela = {
  id: string;
  nome: string;
  cor: string;
  ehGanho: boolean;
  /** Leads ativos, como o painel conta. */
  leadsAtivos: number;
  /** Leads que SEGURAM a etapa, arquivados inclusive — o número da chave estrangeira. */
  leadsTotais: number;
};

export function EtapasTable({ etapas }: { etapas: EtapaNaTela[] }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);

  /**
   * Todo chamador precisa dos DOIS caminhos: `{ ok: false }` é VALOR e chega
   * pelo retorno; queda de rede é EXCEÇÃO e rejeita a promise antes de a action
   * entrar no `try`. Tratar só um deixa o botão voltar ao normal sem dizer nada.
   * Ver `src/lib/acao.ts`.
   */
  async function executar(acao: () => Promise<ResultadoAcao>, contexto: string) {
    setErro(null);
    try {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    } catch (erroCapturado) {
      setErro(registrarFalhaDeRede(contexto, erroCapturado));
    }
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div role="alert" className="flex items-center justify-between rounded-md border border-destructive/50 p-3 text-sm">
          <span>{erro}</span>
          <Button variant="ghost" size="sm" onClick={() => setErro(null)}>
            Dispensar
          </Button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Etapa</th>
            <th className="py-2">Leads</th>
            <th className="py-2">Ordem</th>
            <th className="py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {etapas.map((etapa, indice) => {
            const arquivados = etapa.leadsTotais - etapa.leadsAtivos;
            return (
              <tr key={etapa.id} className="border-b">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    {/* `style` inline com valor validado no servidor
                        (`/^#[0-9a-f]{6}$/`). Mesma prática do kanban. */}
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: etapa.cor }}
                      aria-hidden
                    />
                    {etapa.nome}
                    {etapa.ehGanho && <Badge>Fechamento</Badge>}
                  </span>
                </td>

                <td className="py-2">
                  {etapa.leadsTotais}
                  {arquivados > 0 && (
                    <span className="text-muted-foreground"> ({etapa.leadsAtivos} ativos)</span>
                  )}
                </td>

                <td className="py-2">
                  <span className="flex gap-1">
                    {indice > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Subir etapa"
                        onClick={() =>
                          executar(
                            () => moverEtapaNaOrdemAction({ etapaId: etapa.id, direcao: "cima" }),
                            "Falha ao subir a etapa"
                          )
                        }
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    )}
                    {indice < etapas.length - 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Descer etapa"
                        onClick={() =>
                          executar(
                            () => moverEtapaNaOrdemAction({ etapaId: etapa.id, direcao: "baixo" }),
                            "Falha ao descer a etapa"
                          )
                        }
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    )}
                  </span>
                </td>

                <td className="py-2 text-right">
                  <span className="flex justify-end gap-1">
                    {/* Botão, e não `<input type="radio">`: o rádio sugere que a
                        mudança acontece ao selecionar, quando cada clique é uma
                        ida ao servidor. Um rádio que volta sozinho quando a rede
                        cai é pior que um botão que mostra erro. */}
                    {!etapa.ehGanho && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          executar(
                            () => definirEtapaDeFechamentoAction(etapa.id),
                            "Falha ao marcar a etapa de fechamento"
                          )
                        }
                      >
                        Marcar como fechamento
                      </Button>
                    )}

                    <EditarEtapaDialogo
                      nomeAtual={etapa.nome}
                      corAtual={etapa.cor}
                      onSalvar={(dados) =>
                        executar(
                          () => editarEtapaAction({ etapaId: etapa.id, ...dados }),
                          "Falha ao salvar a etapa"
                        )
                      }
                    />

                    <ExcluirEtapaDialogo
                      nome={etapa.nome}
                      leadsAtivos={etapa.leadsAtivos}
                      leadsTotais={etapa.leadsTotais}
                      destinosPossiveis={etapas
                        .filter((outra) => outra.id !== etapa.id)
                        .map((outra) => ({ id: outra.id, nome: outra.nome }))}
                      onConfirmar={(destinoId) =>
                        executar(
                          () => excluirEtapaAction({ etapaId: etapa.id, destinoId }),
                          "Falha ao remover a etapa"
                        )
                      }
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Passo 6: o formulário de criar**

`src/components/pipeline/etapa-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarFalhaDeRede } from "@/lib/acao";
import { criarEtapaAction } from "@/core/pipeline/actions";

const COR_PADRAO = "#0f62fe";

export function EtapaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(COR_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const resultado = await criarEtapaAction({ nome, cor });
      if (!resultado.ok) {
        // Não limpa o formulário: o que a pessoa digitou continua lá.
        setErro(resultado.erro);
        return;
      }
      setNome("");
      setCor(COR_PADRAO);
      router.refresh();
    } catch (erroCapturado) {
      setErro(registrarFalhaDeRede("Falha ao criar a etapa", erroCapturado));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="nome-da-nova-etapa" className="text-sm font-medium">
          Nome da etapa
        </label>
        <Input
          id="nome-da-nova-etapa"
          value={nome}
          maxLength={40}
          onChange={(evento) => setNome(evento.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="cor-da-nova-etapa" className="text-sm font-medium">
          Cor
        </label>
        <input
          id="cor-da-nova-etapa"
          type="color"
          className="h-9 w-16 rounded border"
          value={cor}
          onChange={(evento) => setCor(evento.target.value)}
        />
      </div>

      <Button type="submit" disabled={salvando}>
        {salvando ? "Criando..." : "Adicionar etapa"}
      </Button>

      {erro && (
        <p role="alert" className="w-full text-sm text-destructive">
          {erro}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Passo 7: a página**

`src/app/(painel)/etapas/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarEtapas, contarLeadsQueSeguramEtapa } from "@/core/pipeline/stages";
import { contarLeadsPorEtapa } from "@/core/leads/queries";
import { EtapaForm } from "@/components/pipeline/etapa-form";
import { EtapasTable, type EtapaNaTela } from "@/components/pipeline/etapas-table";

/**
 * Gestão do funil — ADMIN apenas (`gerenciar_funil`).
 *
 * `usuarioAtualOuLogin()` e não `usuarioAtual()`: esta rota vira item de MENU, e
 * `<Link>` pré-carrega — o porquê está no docstring daquela função
 * (`core/auth/session.ts`) e no comentário de `usuarios/page.tsx`.
 *
 * `redirect` em vez de `notFound()` para quem não é ADMIN: um GESTOR que clicou
 * num link antigo entende melhor voltar ao painel. Não é a defesa — a defesa é a
 * checagem dentro de cada Server Action (`core/pipeline/actions.ts`), que vale
 * mesmo para um POST que nunca passou por esta página.
 */
export default async function EtapasPage() {
  const usuario = await usuarioAtualOuLogin();

  if (!hasPermission(usuario.papel, "gerenciar_funil")) {
    redirect("/");
  }

  const [etapas, ativosPorEtapa, totaisPorEtapa] = await Promise.all([
    listarEtapas(),
    contarLeadsPorEtapa(),
    contarLeadsQueSeguramEtapa(),
  ]);

  // O `.map()` é a fronteira servidor→cliente, não o `select`: é aqui que se
  // decide o que atravessa.
  const paraTela: EtapaNaTela[] = etapas.map((etapa) => ({
    id: etapa.id,
    nome: etapa.nome,
    cor: etapa.cor,
    ehGanho: etapa.ehGanho,
    leadsAtivos: ativosPorEtapa[etapa.id] ?? 0,
    leadsTotais: totaisPorEtapa[etapa.id] ?? 0,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Etapas</h1>
        <p className="text-sm text-muted-foreground">
          As etapas do funil, na ordem em que aparecem no quadro. Remover uma etapa move os
          leads dela para a etapa que você escolher.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-medium">Adicionar etapa</h2>
        <EtapaForm />
      </div>

      <EtapasTable etapas={paraTela} />
    </div>
  );
}
```

- [ ] **Passo 8: o item de menu**

Em `src/components/nav-links.tsx`, acrescente `SlidersHorizontal` ao import do lucide,
`"etapas"` à união `IconeDoPainel` (linha 10-11) e `etapas: SlidersHorizontal` ao
`Record ICONES`. O `Record<IconeDoPainel, LucideIcon>` faz o compilador exigir a entrada —
não há como esquecer metade.

Em `src/components/painel-nav.tsx`, dentro de `grupoExtra`, depois do item de Equipe:

```tsx
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_funil")
      ? [{ href: "/etapas", label: "Etapas", icone: "etapas" as const }]
      : []),
```

**O rótulo é "Etapas", não "Funil".** O menu já tem um item "Funil" (`/leads/kanban`,
linha 17). Dois links com o mesmo nome acessível são ambíguos para leitor de tela e quebram
locators por nome no e2e.

- [ ] **Passo 9: rodar e ver passar**

`npx vitest run tests/unit/etapas-table.test.tsx` → PASS
`npm run typecheck && npm run lint && npx vitest run` → verde.

- [ ] **Passo 10: sabotagens**

1. Troque `leadsTotais > 0` por `leadsAtivos > 0` em `excluir-etapa-dialogo.tsx` →
   **vermelho** em "etapa COM leads exige destino" (a etapa "Proposta" tem 0 ativos).
2. Remova a condição `indice > 0` da seta de subir → **vermelho** em "a primeira linha não
   tem seta para cima".
3. Troque o rótulo do item de menu para "Funil" e rode `npm run test:e2e` → **vermelho** por
   *strict mode violation* nos testes que navegam pelo menu.

Desfaça as três.

- [ ] **Passo 11: commit**

```bash
git add "src/app/(painel)/etapas" src/components/pipeline src/components/nav-links.tsx src/components/painel-nav.tsx tests/unit/etapas-table.test.tsx
git commit -m "feat(funil): tela /etapas com criar, editar, reordenar e remover"
```

---

## Tarefa 12: E2E, sem quebrar os outros arquivos

**Arquivos:**
- Criar: `tests/e2e/etapas.spec.ts`

**Interfaces:** consome a tela da tarefa 11.

**O risco que esta tarefa contém.** O e2e roda contra o banco real **e em paralelo**:
`playwright.config.ts:29` tem `fullyParallel: true` e `:49` tem `workers: 3`.
`lead-to-won.spec.ts` depende da adjacência Proposta↔Fechado — `arrastarComTeclado` anda
uma coluna por toque (`COLUNA_PASSO_PX = 304`). Se este teste trocar uma etapa criada com a
"Fechado", aquele arquivo fica vermelho de forma intermitente, e é exatamente a assinatura
do defeito que motivou a regra de auditoria do `AGENTS.md`.

**A regra:** o teste cria **duas** etapas, que nascem nas duas últimas posições, e a troca
acontece só entre elas. Etapa acrescentada no fim não desloca nenhuma anterior, então a
adjacência das cinco semeadas fica intacta durante a execução inteira — inclusive no meio da
troca.

- [ ] **Passo 1: escrever o e2e**

`tests/e2e/etapas.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

import { SESSAO_ADMIN } from "./credenciais";

/**
 * Este arquivo toca o MESMO Postgres real e compartilhado que o app usa, e roda
 * em PARALELO com os outros arquivos de e2e (`fullyParallel: true`,
 * `workers: 3`).
 *
 * Por isso ele nunca escreve numa etapa que não criou. As duas etapas abaixo
 * nascem no FIM do funil (`ordem = max + 1`), e a troca ↑/↓ acontece entre elas
 * — nunca com "Fechado". Uma troca com "Fechado" mudaria a adjacência
 * Proposta↔Fechado de que `lead-to-won.spec.ts` depende, e o quebraria de forma
 * intermitente enquanto os dois arquivos rodassem juntos.
 *
 * O sufixo aleatório evita colisão de nome entre duas execuções simultâneas —
 * o serviço recusa nome repetido.
 */
const SUFIXO = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PRIMEIRA = `ZZ E2E Alfa ${SUFIXO}`;
const SEGUNDA = `ZZ E2E Beta ${SUFIXO}`;

function linhaDa(page: Page, nome: string) {
  return page.getByRole("row").filter({ hasText: nome });
}

/** Índice da linha que contém o nome, dentro da tabela de `/etapas`. */
async function posicaoNaTabela(page: Page, nome: string): Promise<number> {
  const linhas = await page.getByRole("row").allTextContents();
  return linhas.findIndex((texto) => texto.includes(nome));
}

// Sessão salva por `auth.setup.ts`, e não login por teste: o limite é 10
// tentativas por conta a cada 10 minutos, e estourá-lo derruba um teste
// distante por timeout. Ver `tests/e2e/credenciais.ts`.
test.use({ storageState: SESSAO_ADMIN });

// `mode: "serial"` serializa os testes DENTRO deste arquivo — não entre
// arquivos. A contenção contra `lead-to-won.spec.ts` é o desenho das etapas
// nascerem no fim, não isto.
test.describe.configure({ mode: "serial" });

test.describe("gestão de etapas do funil", () => {
  test("cria, renomeia, reordena e remove — sem tocar nas etapas semeadas", async ({ page }) => {
    await page.goto("/etapas");

    // ─── criar as duas ─────────────────────────────────────────────────
    for (const nome of [PRIMEIRA, SEGUNDA]) {
      await page.getByLabel("Nome da etapa").fill(nome);
      await page.getByRole("button", { name: "Adicionar etapa" }).click();
      await expect(linhaDa(page, nome)).toBeVisible();
    }

    // ─── as duas nasceram no fim, nesta ordem ──────────────────────────
    expect(await posicaoNaTabela(page, PRIMEIRA)).toBeLessThan(
      await posicaoNaTabela(page, SEGUNDA)
    );
    // E nasceram DEPOIS de todas as semeadas — é o que mantém a adjacência
    // Proposta↔Fechado, de que `lead-to-won.spec.ts` depende.
    expect(await posicaoNaTabela(page, "Fechado")).toBeLessThan(
      await posicaoNaTabela(page, PRIMEIRA)
    );

    // ─── renomear ──────────────────────────────────────────────────────
    const RENOMEADA = `${PRIMEIRA} renomeada`;
    await linhaDa(page, PRIMEIRA).getByLabel("Editar etapa").click();
    await page.getByLabel("Nome").fill(RENOMEADA);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(linhaDa(page, RENOMEADA)).toBeVisible();

    // ─── subir a ÚLTIMA: a troca é entre as duas etapas deste teste ────
    await linhaDa(page, SEGUNDA).getByLabel("Subir etapa").click();
    await expect
      .poll(async () => (await posicaoNaTabela(page, SEGUNDA)) < (await posicaoNaTabela(page, RENOMEADA)))
      .toBe(true);

    // "Fechado" continua onde estava: a troca escreveu só as duas linhas que
    // este teste criou.
    expect(await posicaoNaTabela(page, "Fechado")).toBeLessThan(
      await posicaoNaTabela(page, SEGUNDA)
    );

    // ─── e descer de volta ─────────────────────────────────────────────
    await linhaDa(page, SEGUNDA).getByLabel("Descer etapa").click();
    await expect
      .poll(async () => (await posicaoNaTabela(page, RENOMEADA)) < (await posicaoNaTabela(page, SEGUNDA)))
      .toBe(true);

    // ─── o painel mostra um cartão por etapa, com o funil maior ────────
    // A única coisa nesta branch que exercita um funil de tamanho diferente na
    // tela onde todo mundo entra primeiro. Barato porque as etapas extras já
    // existem por outro motivo.
    //
    // O total é lido ANTES de navegar (menos 1 pelo cabeçalho da tabela). Ler
    // depois exigiria voltar para `/etapas` no meio da asserção, e aí o número
    // comparado não seria mais o da tela que está aberta.
    const totalDeEtapas = (await page.getByRole("row").count()) - 1;
    await page.goto("/");
    await expect(page.getByTestId("cartao-de-etapa")).toHaveCount(totalDeEtapas);

    // ─── remover as duas ───────────────────────────────────────────────
    await page.goto("/etapas");
    for (const nome of [SEGUNDA, RENOMEADA]) {
      await linhaDa(page, nome).getByLabel("Remover etapa").click();
      await page.getByRole("button", { name: "Remover etapa" }).click();
      await expect(linhaDa(page, nome)).toHaveCount(0);
    }
  });

  test("a etapa de fechamento não pode ser removida", async ({ page }) => {
    await page.goto("/etapas");

    const linhaDeFechamento = page.getByRole("row").filter({ hasText: "Fechamento" });
    await linhaDeFechamento.getByLabel("Remover etapa").click();
    await page.getByRole("button", { name: "Remover etapa" }).click();

    await expect(page.getByRole("alert")).toContainText(/etapa de fechamento/i);
    // E ela continua lá: a recusa aconteceu antes de qualquer escrita.
    await expect(linhaDeFechamento).toBeVisible();
  });
});
```

O `data-testid="cartao-de-etapa"` de que a asserção do painel depende é acrescentado na
tarefa 10, junto com as outras mudanças de `StageSummary`.

- [ ] **Passo 2: rodar**

```
npm run test:e2e
```

**Nunca** `npx playwright test` direto — o script encadeia uma guarda de porta.

- [ ] **Passo 3: confirmar que o banco ficou limpo**

```sql
SELECT id, nome, ordem FROM "PipelineStage" ORDER BY ordem;
```

Esperado: as cinco semeadas, com `ordem` 0..4, e nada com prefixo `ZZ E2E`. Se sobrou, o
teste falhou no meio — apague à mão antes de seguir.

- [ ] **Passo 4: a sabotagem que prova a contenção**

Esta é a mais importante do plano, e ela roda **manualmente**, uma vez:

1. Crie à mão uma etapa **entre** "Proposta" e "Fechado" (ou seja, mova a nova para a
   posição 4 pela própria tela).
2. Rode `npm run test:e2e`.
3. Esperado: `lead-to-won.spec.ts` **vermelho** no `toPass` de `arrastarComTeclado` — a
   prova de que uma etapa no meio do funil quebra o outro arquivo.
4. Mova a etapa extra de volta para o fim do funil e rode de novo: **verde**. É a prova de
   que "criar no fim e trocar só entre as próprias" contém o problema.
5. Remova a etapa de teste.

Registre no PR o que você viu nos passos 3 e 4 — sem isso, a contenção é afirmação.

- [ ] **Passo 5: commit**

```bash
git add tests/e2e/etapas.spec.ts src/components/dashboard/stage-summary.tsx
git commit -m "test(funil): e2e do ciclo de etapas, isolado das cinco semeadas"
```

---

## Fecho da branch

- [ ] **Verificação completa na árvore final**

```
npm run typecheck && npm run lint
npx vitest run
npm run test:e2e
```

- [ ] **Árvore limpa e banco limpo**

```
git status --porcelain
```

```sql
SELECT id, nome, ordem FROM "PipelineStage" ORDER BY ordem;
SELECT count(*) FROM "Contact" WHERE nome LIKE 'Contato Teste%';
```

- [ ] **Fase 1 da `auditoria-seguranca`, e PARE**

Superfície a auditar: as cinco Server Actions novas, a permissão `gerenciar_funil`, a
escrita em massa de `Lead.stageId`, o valor de `cor` que atravessa para atributo `style` e
para `fill` do gráfico, a mudança em `core/audit/log.ts`, e o que entra no `AuditLog`.

**Entregue o relatório e pare.** Correção só depois da aprovação do dono. Não faça merge nem
abra PR antes disso — é regra do `AGENTS.md`, e ela existe porque uma branch anterior deixou
passar um logout que um prefetch de `<Link>` desfazia.
