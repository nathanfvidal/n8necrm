# n8necrm — Ciclo 0 (Fundação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A base de `RodrigoLR1/CRM` vira o projeto `nathanfvidal/n8necrm`, rodando contra um Supabase próprio, com a fila do WhatsApp atrás de uma interface — sem nenhuma feature nova.

**Architecture:** Cópia de histórico via git puro (sem fork no GitHub), re-identificação do fork em `config/client.ts` / `package.json` / docs, extração de `@vercel/queue` para um adaptador atrás de `FilaTurnos` (espelhando a estrutura que `src/modules/whatsapp/gateway/` já usa: `tipos.ts` + adaptador + `index.ts` com singleton preguiçoso), e apontamento do Prisma para o projeto Supabase `uzumzfxjcxrbxaucvfsr`.

**Tech Stack:** Next.js 16.3, React 19.2, Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase, região `sa-east-1`), Auth.js v5 beta, Tailwind 4, shadcn, Zod 4, Vitest 4, Playwright 1.62, `@vercel/queue` 0.4.

**Spec:** `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`

## Global Constraints

Valem para toda tarefa deste plano. Não repetidas em cada uma.

- **Idioma do código é português.** Nomes de arquivo, funções, variáveis, testes e comentários seguem o que a base já faz (`publicarTurno`, `obterGateway`, `tipos.ts`). Não introduzir nomes em inglês.
- **Comentário explica POR QUE, com evidência.** É o padrão da base inteira: cada decisão não-óbvia carrega o modo de falha que a motivou. Comentário que só reafirma o código ("// envia a mensagem") não passa em revisão aqui.
- **`AGENTS.md` da base é herdado:** nenhuma branch é integrada sem auditoria de segurança sobre a superfície que ela mexeu. Vale para este ciclo.
- **Nenhum segredo entra no repositório.** Valores reais só em `.env` (que o `.gitignore` da base já cobre). `.env.example` recebe o nome da variável e o comentário, nunca o valor.
- **Provar, não presumir.** Todo critério de aceite exige o comando executado e a saída obtida colada no relatório. "Deve funcionar" não fecha tarefa.
- **Nada de feature nova.** Sem `companyId`, sem RLS novo, sem tela nova, sem mexer no módulo `whatsapp` além da troca de fila. Isso é Ciclo 1 em diante.
- **Toda mensagem de commit termina com:**
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Identidade git já configurada e verificada:** `nathanfvidal` / `nathanfv.dev@gmail.com`. Push para `nathanfvidal/n8necrm` **já foi confirmado por dry-run** (`* [new branch] HEAD -> main`), então não há passo de autenticação neste plano.
- **Branch de trabalho: `ciclo-0-fundacao`.** Só a Task 1 toca a `main` — ela é a cópia da base, não há como estabelecer a `main` de outro jeito. As Tasks 2 a 5 trabalham na branch, criada no fim da Task 1. Decidido em 2026-08-19: comitar direto na branch padrão conflita com a regra global do usuário e tira o ponto de merge onde a auditoria de segurança que o `AGENTS.md` da base exige tem onde acontecer.

---

### Task 1: Copiar a base e criar o clone de trabalho

**Files:**
- Create: `.git/` no diretório do projeto (via `git init` + `fetch`, não `clone` — ver Step 3)
- Nenhum arquivo do código-fonte é modificado nesta tarefa

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: a árvore completa da base em `d:\Projetos Programação\N8n + Crm`, com `origin` apontando para `https://github.com/nathanfvidal/n8necrm.git` e `node_modules/` instalado. Toda tarefa seguinte assume esse diretório como raiz.

**Por que `git init` + `fetch` e não `git clone`:** o diretório do projeto **já contém** `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md` e este próprio plano, escritos durante o brainstorm. `git clone` recusa diretório não-vazio. Nenhum dos dois arquivos existe na origem, então não há conflito de checkout.

- [ ] **Step 1: Clonar a origem como bare, fora do diretório do projeto**

```bash
cd /c/Users/NOTEBO~1/AppData/Local/Temp/claude/d--Projetos-Programa--o-N8n---Crm/dfde43e0-e999-4381-825f-84bb558af8bf/scratchpad
rm -rf crm-origem.git
git clone --bare https://github.com/RodrigoLR1/CRM.git crm-origem.git
```

Esperado: `Cloning into bare repository 'crm-origem.git'...` e término sem erro.

- [ ] **Step 2: Empurrar só `main` e as tags para o destino**

Decisão 7 do spec: as branches de feature em aberto da origem (`feat/crud-etapas-do-funil`, `feat/funil-ordem-e-exclusao`, `feat/painel-menos-idas-ao-banco`, `feature/conversa-aguardando-humano`) **não** são copiadas. Por isso `refs/heads/main` explícito, e não `--mirror` (que levaria tudo).

```bash
cd /c/Users/NOTEBO~1/AppData/Local/Temp/claude/d--Projetos-Programa--o-N8n---Crm/dfde43e0-e999-4381-825f-84bb558af8bf/scratchpad/crm-origem.git
git push https://github.com/nathanfvidal/n8necrm.git refs/heads/main:refs/heads/main
git push --tags https://github.com/nathanfvidal/n8necrm.git
```

Esperado: `* [new branch] main -> main`. O `--tags` pode reportar `Everything up-to-date` se a origem não tiver tags — isso é sucesso, não falha.

- [ ] **Step 3: Materializar o clone de trabalho no diretório do projeto**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git init
git remote add origin https://github.com/nathanfvidal/n8necrm.git
git fetch origin
git checkout -b main origin/main
```

Esperado: `Switched to a new branch 'main'` e `branch 'main' set up to track 'origin/main'`.

- [ ] **Step 4: Provar que o histórico veio inteiro e que o spec sobreviveu**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git log --oneline | wc -l
git log -1 --format=%H
git status --short
```

Esperado: contagem de commits maior que 1 (histórico real, não commit único); o hash de `HEAD` igual a `d2a44dc3f251d7c271df1158ba2218b1ef4c2212` (o `HEAD` da origem medido no levantamento); e `git status` listando `docs/superpowers/specs/` e `docs/superpowers/plans/` como **untracked** — os arquivos do brainstorm continuam ali, não foram sobrescritos.

- [ ] **Step 5: Instalar dependências**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm install
```

Esperado: instalação conclui e o `postinstall` roda `prisma generate` com sucesso. `prisma generate` **não** precisa de `DATABASE_URL` — ele lê só `prisma/schema.prisma`. Se ele reclamar de variável de ambiente aqui, pare e reporte: significa que algo mudou no schema em relação ao que este plano assume.

- [ ] **Step 6: Commitar o spec e o plano**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md docs/superpowers/plans/2026-08-19-n8necrm-ciclo-0-fundacao.md
git commit -m "docs: spec do programa n8necrm e plano do Ciclo 0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin main
```

Esperado: push aceito, `main -> main`.

- [ ] **Step 7: Criar a branch de trabalho**

Só esta tarefa toca a `main`. Tudo a partir da Task 2 acontece na branch.

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b ciclo-0-fundacao
git push -u origin ciclo-0-fundacao
```

Esperado: `Switched to a new branch 'ciclo-0-fundacao'` e o push criando a branch remota.

---

### Task 2: Identidade do projeto

**Files:**
- Modify: `package.json` (campo `name`)
- Modify: `config/client.ts` (bloco inteiro passado a `clientConfigSchema.parse`)
- Modify: `README.md` (hoje contém só `# CRM`)
- Modify: `CLAUDE.md` (hoje contém só `@AGENTS.md`)
- Test: `tests/unit/client-config.test.ts` (existente — **não** precisa de alteração, ver Step 1)

**Interfaces:**
- Consumes: a árvore instalada da Task 1.
- Produces: `client.nome === "n8necrm"`, `client.vertical === "generico"`, `client.modulos === ["whatsapp"]`, `client.entidade.singular === "Item"` / `.plural === "Itens"`. A Task 5 verifica esses valores; o Ciclo 1 os move de arquivo para tabela.

**Por que `client-config.test.ts` não muda:** ele foi escrito **estruturalmente** — afirma que `funil` não tem duplicata, que `modulos` não tem duplicata, que `modulos` recusa valor fora do enum, e que `marca.corPrimaria` passa no piso de croma. Não afirma nenhum valor do Autus. Trocar a config mantém ele válido, e é justamente por isso que ele é o portão desta tarefa.

- [ ] **Step 1: Rodar o teste de config ANTES de mexer, para ter a linha de base**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/client-config.test.ts
```

Esperado: PASS. Se falhar aqui, o problema é da base e não da sua mudança — pare e reporte antes de continuar.

- [ ] **Step 2: Reescrever `config/client.ts`**

Substituir o objeto passado a `clientConfigSchema.parse(...)` inteiro. **Manter o comentário de bloco existente acima da chamada** (ele explica por que é `parse` e não anotação de tipo — continua verdade).

```ts
export const client = clientConfigSchema.parse({
  nome: "n8necrm",
  // Decisão 8 do spec (2026-08-19): a identidade do produto está EM ABERTO de
  // propósito. "generico" é o marcador dessa decisão adiada, não um
  // placeholder esquecido — `vertical` é obrigatório no schema e string vazia
  // passaria na validação sem dizer nada a quem ler depois.
  vertical: "generico",
  marca: {
    nome: "n8necrm",
    // Croma acima do piso de `CROMA_MINIMO` (config/client.schema.ts): o
    // schema RECUSA cinza, porque abaixo desse piso as superfícies derivadas
    // ficam indistinguíveis de neutro e o white-label para de funcionar em
    // silêncio. Ou seja: não existe "cor neutra provisória" aqui.
    corPrimaria: "#6D4AFF",
    fonte: "Geist",
    // `logo` omitido: é opcional, e sem arquivo o painel mostra o nome em
    // texto. Não inventar caminho para asset que não existe — o regex de
    // `caminhoDeAsset` aceitaria, e a imagem quebraria só em runtime.
  },
  // O enum de `modulos` em client.schema.ts JÁ inclui "automation", que é onde
  // o módulo de fluxos do n8n entra no Ciclo 4 — não há enum a estender lá.
  // Aqui fica só "whatsapp", o único com código funcionando hoje.
  modulos: ["whatsapp"],
  // Entidade genérica, mas NÃO vazia. `campos: []` passa no schema, e mesmo
  // assim está errado: testes e telas iteram sobre `client.entidade.campos`
  // (export de leads, formulário de lead, filtros de listagem), e uma lista
  // vazia os deixa exercitando o caminho degenerado em vez do caminho real.
  // Dois campos, um de cada tipo básico, mantêm a paridade de forma com a
  // config que a base tinha.
  entidade: {
    singular: "Item",
    plural: "Itens",
    campos: [
      { nome: "titulo", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "valor", tipo: "numero", obrigatorio: false, filtravel: true },
    ],
  },
  funil: ["Novo", "Em contato", "Proposta", "Fechado"],
  whatsapp: {
    numero: "5511999999999",
    mensagem: "Olá, tenho interesse em {item}",
  },
});
```

- [ ] **Step 3: Rodar o teste de config e provar que a nova config é válida**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/client-config.test.ts
```

Esperado: PASS. Se o piso de croma reprovar `#6D4AFF`, a mensagem de erro do Zod dirá o croma medido — escolher outra cor com croma maior e **não** afrouxar o schema.

- [ ] **Step 4: Trocar o nome do pacote**

Em `package.json`, linha 2: `"name": "crm-geral"` vira `"name": "n8necrm"`.

- [ ] **Step 5: Escrever o `README.md`**

Substituir o conteúdo inteiro (hoje é `# CRM`). A cerca externa abaixo usa
**quatro** crases porque o conteúdo do README contém uma cerca de três:

````markdown
# n8necrm

CRM de atendimento por WhatsApp com automação, derivado da base `RodrigoLR1/CRM`.

## Stack

Next.js 16 · React 19 · Prisma 7 · Postgres (Supabase) · Auth.js v5 · Tailwind 4 · shadcn · Zod 4 · Vitest · Playwright

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencher os valores — ver comentários no arquivo
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Suíte unitária (Vitest) |
| `npm run test:e2e` | Suíte end-to-end (Playwright) — exige `E2E_SENHA` |
| `npx prisma db seed` | Seed real (usuários, funil, config do bot) |
| `npm run seed:demo` | Dados de demonstração — **não** rodar em banco de cliente |

## Arquitetura

`src/core/` é o núcleo, sempre presente. `src/modules/` são módulos opcionais,
ligados por `config/client.ts` e barrados na rota por `exigirModulo()`, que
devolve 404 — módulo desligado não some só do menu.

## Documentação

Specs em `docs/superpowers/specs/`, planos em `docs/superpowers/plans/`,
auditorias em `docs/auditorias/`. O spec do programa atual é
`docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`.
````

- [ ] **Step 6: Escrever o `CLAUDE.md` do projeto**

Hoje o arquivo é só `@AGENTS.md`. **Manter essa linha** — ela importa as regras da base, incluindo a auditoria de segurança obrigatória — e acrescentar o resto:

```markdown
@AGENTS.md

# n8necrm

CRM de atendimento por WhatsApp com automação. Derivado de `RodrigoLR1/CRM`
em 2026-08-19, sem vínculo de fork no GitHub.

## Stack

Next.js 16.3 · React 19.2 · Prisma 7.9 (`@prisma/adapter-pg`) · Postgres 17.6
no Supabase `uzumzfxjcxrbxaucvfsr` (região `sa-east-1`) · Auth.js v5 beta ·
Tailwind 4 · shadcn · Zod 4 · Vitest 4 · Playwright 1.62 · Vercel (deploy e fila)

## Infra externa

| Serviço | Onde | Verificado em |
| --- | --- | --- |
| n8n | `https://n8n.nateksoft.com` | 2026-08-19, API pública responde |
| Evolution API | `https://evolution.nateksoft.com`, v2.3.7 | 2026-08-19, `GET /` |
| Supabase | projeto `uzumzfxjcxrbxaucvfsr` | 2026-08-19, Postgres 17.6.1 |

## Skills que se aplicam

- Banco, RLS, migrations, schema: `supabase`, `supabase-postgres-best-practices`,
  `auditing-supabase-security` — **sempre as três juntas**
- n8n e workflows: família `n8n-*`, `using-n8n-mcp-skills`
- Processo: `superpowers:brainstorming` antes de desenhar,
  `superpowers:writing-plans` antes de codar,
  `superpowers:test-driven-development` ao implementar
- Revisão e debug: `code-review`, `adversarial-review`, `diagnosing-bugs`
- React e performance de front: `vercel-react-best-practices`

## Decisões travadas

Decididas no brainstorm de 2026-08-19. Reabrir qualquer uma invalida os ciclos
que dependem dela — ver `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`.

1. **Utmify fora de escopo.** Sem rastreamento de UTM, plataformas de anúncio,
   taxas, despesas ou ROI.
2. **Multi-empresa por baixo, UI de empresa única.** `companyId` em todo modelo
   e RLS desde o Ciclo 1; a interface serve uma empresa só.
3. **n8n: painel via API + editor em iframe.** O painel é a base de sustentação
   se o iframe cair.
4. **Evolution: conexões com QR Code pelo CRM**, multi-instância.
5. **Tempo real: Supabase Realtime**, com RLS como trava do canal.
6. **Hospedagem: Vercel.** A fila continua Vercel Queues; o que mudou no Ciclo 0
   é que ela virou adaptador atrás de uma interface.
7. **Cópia da base: histórico completo, sem vínculo de fork.** As branches de
   feature em aberto da origem não vieram.
8. **Identidade do produto: EM ABERTO.** `config/client.ts` está genérico de
   propósito. Isto é uma decisão adiada, não um esquecimento.

## Armadilhas conhecidas

- **RLS não protege o caminho do Prisma.** Ele conecta com papel dono de tabela,
  que ignora política de linha. O isolamento por empresa são DUAS defesas: escopo
  obrigatório de query em `src/core/` e RLS para o caminho do navegador.
- **A base é blindada contra `anon`/`authenticated`** por três migrations e um
  teste e2e (`tests/e2e/banco-blindado.spec.ts`). O Realtime do Ciclo 3 precisa
  abrir uma exceção NOMEADA: `SELECT` numa tabela só, com política junto, e o
  teste atualizado para afirmar essa exceção — nunca afrouxado.
- **`DIRECT_URL` nunca aponta para `db.<projeto>.supabase.co`**: esse host
  resolve só em IPv6 (medido em 2026-08-19) e dá `ENETUNREACH`. Usar o session
  pooler.
- **`DATABASE_URL` na porta 6543, `DIRECT_URL` na 5432.** Trocar as duas faz
  `prisma migrate` ficar PENDURADO sem imprimir nada — parece lentidão, é falha.
- **Validar env em escopo de módulo derruba o build.** `next build` avalia
  módulos alcançáveis; validação no topo do arquivo roda sem as variáveis. O
  padrão da base é construção preguiçosa (ver `gateway/index.ts` e `fila/`).
```

- [ ] **Step 7: Rodar a suíte inteira — o portão real desta tarefa**

A troca de `config/client.ts` toca tudo que lê `client.*`: menu, funil, formulário de lead, export, tema. Só a suíte completa prova que nada quebrou.

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm test
```

Esperado: verde. Se algum teste falhar por causa de `entidade.campos`, **não** reverta para os campos do Autus — ajuste o teste para não depender de nomes de campo específicos, ou reporte qual teste e por quê.

- [ ] **Step 8: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add package.json config/client.ts README.md CLAUDE.md
git commit -m "chore: reidentificar o fork como n8necrm

config/client.ts fica generico de proposito (decisao 8 do spec): a
identidade do produto esta em aberto. Entidade generica com dois campos,
nao vazia, porque telas e testes iteram sobre entidade.campos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 3: Fila de turnos atrás de uma interface

**Files:**
- Create: `src/modules/whatsapp/fila/tipos.ts`
- Create: `src/modules/whatsapp/fila/vercel.ts`
- Create: `src/modules/whatsapp/fila/index.ts`
- Delete: `src/modules/whatsapp/fila.ts`
- Create: `tests/unit/whatsapp-fila-vercel.test.ts`
- Test (existente, **não alterar**): `tests/unit/whatsapp-fila.test.ts`

**Interfaces:**
- Consumes: nada das tarefas anteriores.
- Produces:
  - `interface TurnoJob { conversationId: string; seq: number; tentativaReagendamento?: number }`
  - `interface OpcoesPublicacao { delaySeconds?: number }`
  - `interface FilaTurnos { publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> }`
  - `class FilaVercel implements FilaTurnos`
  - `async function publicarTurno(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void>`
  - Re-export de tipos a partir de `src/modules/whatsapp/fila/index.ts`

**Por que os importadores não mudam:** hoje são três — `src/app/api/whatsapp/evolution/[token]/route.ts:10`, `src/modules/whatsapp/turno.ts:8` e `:15`. Todos importam de `"./fila"` ou `"@/modules/whatsapp/fila"`, que passam a resolver para `fila/index.ts` automaticamente. **Nenhum arquivo consumidor é editado nesta tarefa** — e é exatamente por isso que `tests/unit/whatsapp-fila.test.ts`, `whatsapp-turno.test.ts` e `whatsapp-webhook-route.test.ts` continuam passando sem alteração. Se algum deles precisar mudar, a refatoração vazou e está errada.

Esta estrutura espelha `src/modules/whatsapp/gateway/` (`tipos.ts` + adaptador + `index.ts` com singleton preguiçoso). Não é um padrão novo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/whatsapp-fila-vercel.test.ts`. Ele exercita o **adaptador direto**, não `publicarTurno` — é o que prova que a costura existe de verdade e não é só um arquivo renomeado.

```ts
// Testa o ADAPTADOR (FilaVercel) direto, não a função de conveniência
// `publicarTurno`. `whatsapp-fila.test.ts` já cobre o caminho público; este
// arquivo existe para provar que a implementação da Vercel é UMA
// implementação de `FilaTurnos`, substituível, e não a única forma possível.
import { describe, it, expect, vi, beforeEach } from "vitest";

class DuplicateMessageErrorFake extends Error {
  constructor(
    message: string,
    public readonly idempotencyKey?: string
  ) {
    super(message);
    this.name = "DuplicateMessageError";
  }
}

interface OpcoesSendFake {
  idempotencyKey?: string;
  delaySeconds?: number;
}

const sendMock = vi.fn(async (_topico: string, _payload: unknown, _opcoes?: OpcoesSendFake) => ({
  messageId: "msg-1",
}));

vi.mock("@vercel/queue", () => ({
  send: (...args: [string, unknown, OpcoesSendFake?]) => sendMock(...args),
  DuplicateMessageError: DuplicateMessageErrorFake,
}));

process.env.WHATSAPP_QUEUE_SECRET = "segredo-teste-adaptador";

const { FilaVercel } = await import("../../src/modules/whatsapp/fila/vercel");

describe("FilaVercel — adaptador de @vercel/queue", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("publica no tópico whatsapp-turn com o segredo embutido no payload", async () => {
    await new FilaVercel().publicar({ conversationId: "conv-1", seq: 3 });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [topico, payload] = sendMock.mock.calls[0] ?? [];
    expect(topico).toBe("whatsapp-turn");
    expect(payload).toMatchObject({
      conversationId: "conv-1",
      seq: 3,
      segredo: "segredo-teste-adaptador",
    });
  });

  it("usa a chave de idempotência sem sufixo na publicação original, e delay padrão de 8s", async () => {
    await new FilaVercel().publicar({ conversationId: "conv-1", seq: 3 });

    const opcoes = sendMock.mock.calls[0]?.[2];
    expect(opcoes?.idempotencyKey).toBe("conv-1:3");
    expect(opcoes?.delaySeconds).toBe(8);
  });

  it("sufixa a chave por tentativa de reagendamento e respeita o delay informado", async () => {
    await new FilaVercel().publicar(
      { conversationId: "conv-2", seq: 5, tentativaReagendamento: 2 },
      { delaySeconds: 5 }
    );

    const opcoes = sendMock.mock.calls[0]?.[2];
    expect(opcoes?.idempotencyKey).toBe("conv-2:5:r2");
    expect(opcoes?.delaySeconds).toBe(5);
  });
});
```

**Três casos, de propósito.** Um quarto caso ("satisfaz o contrato `FilaTurnos`")
foi cortado deste plano em 2026-08-19: ele só afirmaria que a promessa resolve, e
o `implements` do TypeScript já garante a conformidade de tipo em tempo de
compilação — `npm run typecheck` (Step 9) é quem cobre isso. Teste que não afirma
nada em runtime é ruído, não cobertura.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/whatsapp-fila-vercel.test.ts
```

Esperado: FALHA com erro de resolução de módulo apontando para `src/modules/whatsapp/fila/vercel` — o arquivo ainda não existe.

- [ ] **Step 3: Criar `src/modules/whatsapp/fila/tipos.ts`**

```ts
/**
 * Contrato da fila de turnos de conversa.
 *
 * Vive num arquivo próprio, sem `server-only` e sem importar `@vercel/queue`,
 * pelo MESMO motivo de `gateway/tipos.ts`: quem só precisa nomear o tipo (o
 * consumidor, um teste, um adaptador futuro) não deveria arrastar junto o SDK
 * de um provedor específico nem a marcação de servidor.
 */

/**
 * Um turno de conversa a ser processado.
 *
 * `tentativaReagendamento` é o contador do NOSSO reagendamento deliberado
 * (quando `turno.ts` encontra o lease da conversa ocupado) — não confundir
 * com o retry nativo da fila. `undefined`/`0` = publicação original, feita
 * por `ingest.ts`.
 */
export interface TurnoJob {
  conversationId: string;
  seq: number;
  tentativaReagendamento?: number;
}

export interface OpcoesPublicacao {
  /** Atraso antes da entrega. Padrão 8s (janela de buffer); 5s no reagendamento. */
  delaySeconds?: number;
}

/**
 * Abstração sobre o provedor de fila — mesmo padrão de `WhatsappGateway`.
 *
 * Hoje só existe `FilaVercel`. A decisão 6 do spec (2026-08-19) mantém a
 * Vercel como runtime e exige esta costura para que mover o CRM para a VPS
 * seja escrever um segundo adaptador (pg-boss, BullMQ), não reescrever o
 * módulo de WhatsApp.
 */
export interface FilaTurnos {
  publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void>;
}
```

- [ ] **Step 4: Criar `src/modules/whatsapp/fila/vercel.ts`**

Todo o raciocínio abaixo (segredo no payload, chave de idempotência por tentativa) vem do arquivo original `fila.ts` e **não pode ser perdido na mudança** — é o registro de dois achados de revisão.

```ts
import { send } from "@vercel/queue";
import { z } from "zod";

import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

/**
 * Tópico. Tem que bater com o nome do diretório da rota consumidora
 * (`src/app/api/queues/whatsapp-turn/route.ts`) e com o binding declarado em
 * `vercel.json` — os três precisam concordar.
 */
const TOPICO_TURNO = "whatsapp-turn";

const segredoEnvSchema = z.object({
  WHATSAPP_QUEUE_SECRET: z.string().min(1, {
    message: "WHATSAPP_QUEUE_SECRET ausente — defina no .env (openssl rand -hex 32)",
  }),
});

/**
 * Lido a cada publicação, não no escopo do módulo. Importar este arquivo não
 * pode exigir a variável: `next build` avalia módulos alcançáveis para coletar
 * configuração de rota, e validação no topo já derrubou o deploy deste projeto
 * uma vez pelo módulo do gateway (ver `gateway/index.ts`).
 */
function getSegredoFila(): string {
  const resultado = segredoEnvSchema.safeParse({
    WHATSAPP_QUEUE_SECRET: process.env.WHATSAPP_QUEUE_SECRET,
  });
  if (!resultado.success) {
    throw new Error(
      `Configuração da fila do WhatsApp inválida: ${resultado.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return resultado.data.WHATSAPP_QUEUE_SECRET;
}

/**
 * Adaptador de Vercel Queues.
 *
 * ## Por que o segredo vai no PAYLOAD, e não num header
 *
 * A documentação da Vercel garante que uma rota consumidora configurada por
 * `experimentalTriggers` fica air-gapped da internet, só invocável pela
 * infraestrutura interna de fila. O SDK, por sua vez, NÃO verifica assinatura
 * nenhuma na requisição recebida — confia inteiramente nessa garantia de rede.
 * O segredo no payload é a segunda camada barata: se o air-gapping falhar por
 * bug ou configuração errada, um POST forjado ainda não dispara `processarTurno`
 * com um `conversationId` arbitrário. Vai no payload e não em
 * `SendOptions.headers` porque a documentação não confirma que headers chegam
 * como header HTTP na entrega por push — o payload nós mesmos serializamos e
 * desserializamos, sem depender de comportamento não verificado de plataforma.
 *
 * ## Por que a chave de idempotência muda a cada reagendamento
 *
 * Achado CRÍTICO de revisão na base: o reagendamento reusava a MESMA chave da
 * publicação original. A janela de dedupe do Vercel Queues é `min(retenção, 24h)`,
 * muito maior que os 8s entre a publicação e o primeiro reagendamento — então
 * TODA tentativa de reagendar por lease ocupado colidia, `send()` lançava
 * `DuplicateMessageError`, o handler respondia 500, e quem reentregava era o
 * retry padrão de 30s da fila, nunca o reagendamento de 5s pretendido. Sob
 * contenção sustentada isso queimava tentativas de entrega mais rápido que o
 * necessário e podia derrubar o turno antes de qualquer resposta sair.
 */
export class FilaVercel implements FilaTurnos {
  async publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
    const tentativa = job.tentativaReagendamento ?? 0;
    const idempotencyKey =
      tentativa > 0
        ? `${job.conversationId}:${job.seq}:r${tentativa}`
        : `${job.conversationId}:${job.seq}`;

    await send(
      TOPICO_TURNO,
      { ...job, segredo: getSegredoFila() },
      {
        delaySeconds: opcoes?.delaySeconds ?? 8,
        idempotencyKey,
      }
    );
  }
}
```

- [ ] **Step 5: Criar `src/modules/whatsapp/fila/index.ts`**

```ts
import "server-only";

import { FilaVercel } from "./vercel";
import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

export type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

let instancia: FilaTurnos | null = null;

/**
 * Construção preguiçosa, mesmo raciocínio de `gateway/index.ts`: importar não
 * pode custar nada além do import. Trocar de provedor (pg-boss na VPS, BullMQ)
 * é trocar a linha abaixo, ou lê-la de uma variável tipo `FILA_PROVEDOR` —
 * sem tocar em `ingest.ts`, `turno.ts` ou na rota do webhook, que só conhecem
 * `publicarTurno`.
 */
function obterFila(): FilaTurnos {
  if (instancia) return instancia;
  instancia = new FilaVercel();
  return instancia;
}

/**
 * Mesma assinatura de sempre. Os três importadores existentes
 * (`api/whatsapp/evolution/[token]/route.ts`, `turno.ts` em duas linhas) não
 * mudam: `"./fila"` e `"@/modules/whatsapp/fila"` resolvem para este arquivo.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
  return obterFila().publicar(job, opcoes);
}
```

- [ ] **Step 6: Apagar o arquivo antigo**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git rm src/modules/whatsapp/fila.ts
```

Esperado: `rm 'src/modules/whatsapp/fila.ts'`. Se o `git rm` reclamar de alteração local não commitada, pare — significa que o arquivo foi editado por engano nesta tarefa em vez de substituído pelo diretório.

- [ ] **Step 7: Rodar o teste novo e confirmar que passa**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/whatsapp-fila-vercel.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 8: Provar que os consumidores não perceberam a mudança**

Este é o passo que define se a refatoração foi correta. Os três arquivos de teste abaixo **não foram tocados**; se algum falhar, a costura vazou.

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/whatsapp-fila.test.ts tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-webhook-route.test.ts tests/unit/whatsapp-queue-consumer-route.test.ts
```

Esperado: todos PASS, sem nenhuma edição neles.

- [ ] **Step 9: Typecheck**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
```

Esperado: sem saída de erro.

- [ ] **Step 10: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/modules/whatsapp/fila tests/unit/whatsapp-fila-vercel.test.ts
git commit -m "refactor: fila de turnos atras da interface FilaTurnos

@vercel/queue deixa de ser importado direto e vira o adaptador FilaVercel,
espelhando a estrutura de gateway/ (tipos + adaptador + index preguicoso).
Comportamento identico: os tres importadores e os quatro testes de
consumidor nao mudaram uma linha.

Decisao 6 do spec: a Vercel continua sendo o runtime; a costura existe para
que mover o CRM para a VPS seja escrever um segundo adaptador.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 4: Apontar o banco para o Supabase do projeto

**Files:**
- Create: `.env` (local, **nunca** commitado — o `.gitignore` da base já cobre)
- Modify: nenhum arquivo versionado, salvo se o Step 7 revelar variável faltando em `.env.example`

**Interfaces:**
- Consumes: a árvore com dependências instaladas (Task 1) e `prisma generate` já executado.
- Produces: o banco `uzumzfxjcxrbxaucvfsr` com as 14 migrations aplicadas e o seed real rodado. A Task 5 verifica login contra ele.

**REQUERIDO ANTES DE COMEÇAR — invocar as três skills de banco, juntas**, conforme a regra do `CLAUDE.md` global do usuário: `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Esta tarefa aplica migrations que contêm RLS e revogação de privilégio; é exatamente o domínio delas.

**Dados do projeto, já verificados em 2026-08-19:**

| Campo | Valor |
| --- | --- |
| Ref do projeto | `uzumzfxjcxrbxaucvfsr` |
| Nome | `n8necrm` |
| Região | `sa-east-1` |
| Postgres | 17.6.1 |
| Schema `public` | **vazio** — nenhuma tabela |

- [ ] **Step 1: Coletar os segredos com o dono do projeto**

Nenhum destes pode ser adivinhado nem lido por ferramenta. **Pare e peça** antes de seguir:

| Variável | Onde obter |
| --- | --- |
| Senha do banco | Painel do Supabase → Settings → Database. Se ninguém tiver, usar "Reset database password" |
| String do **transaction pooler** (`:6543`) | Painel → Connect → Connection string → Transaction pooler. **Copiar o host literalmente** — `aws-0-` e `aws-1-sa-east-1.pooler.supabase.com` ambos existem e só o painel diz qual é o deste projeto |
| String do **session pooler** (`:5432`) | Painel → Connect → Connection string → Session pooler |
| `SUPABASE_SERVICE_ROLE_KEY` | Painel → Settings → API → `service_role` |
| `OPENAI_API_KEY` | platform.openai.com/api-keys |
| `EVOLUTION_APIKEY` | Painel da Evolution em `https://evolution.nateksoft.com/manager` |
| `EVOLUTION_INSTANCE` | Nome da instância pareada nesse mesmo painel |

- [ ] **Step 2: Criar o `.env` a partir do exemplo**

```bash
cd "d:/Projetos Programação/N8n + Crm"
cp .env.example .env
```

Preencher. Valores que já são conhecidos e **não** precisam ser perguntados:

```ini
SUPABASE_URL="https://uzumzfxjcxrbxaucvfsr.supabase.co"
EVOLUTION_DOMAIN="https://evolution.nateksoft.com"
```

Gerar os três segredos locais (não vêm de serviço nenhum):

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # WHATSAPP_WEBHOOK_TOKEN
openssl rand -hex 32      # WHATSAPP_QUEUE_SECRET  (valor DIFERENTE do de cima)
openssl rand -base64 24   # E2E_SENHA
```

- [ ] **Step 3: Conferir que `.env` não vai para o git**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git status --short .env
git check-ignore -v .env
```

Esperado: `git status` **não** lista `.env`, e `check-ignore` confirma a regra do `.gitignore` que o cobre. Se `.env` aparecer como untracked, **pare** — não commite nada até resolver.

- [ ] **Step 4: Aplicar as migrations**

São 14 migrations, incluindo três de segurança (`enable_rls_and_revoke_anon_grants`, `revoke_default_privileges_future_tables`, `blindar_privilegios_padrao`).

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate deploy
```

Esperado: `14 migrations found` e `All migrations have been successfully applied`.

**Se o comando ficar pendurado sem imprimir nada:** não é lentidão, é `DIRECT_URL` na porta errada. O motor de migração usa advisory lock e estado de sessão, que o transaction pooler não suporta. Conferir que `DIRECT_URL` está na `:5432`. E **nunca** apontar `DIRECT_URL` para `db.uzumzfxjcxrbxaucvfsr.supabase.co`: medido em 2026-08-19, esse host resolve só em IPv6 e dá `ENETUNREACH`.

- [ ] **Step 5: Rodar o seed real**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma db seed
```

Esperado: execução de `tsx prisma/seed.ts` (declarado em `prisma.config.ts`) sem erro.

**Não rodar `npm run seed:demo`.** É outra coisa — dados de demonstração — e não faz parte do Ciclo 0.

- [ ] **Step 6: Provar que as tabelas existem e que a blindagem sobreviveu**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate status
```

Esperado: `Database schema is up to date!`

E, com a ferramenta MCP do Supabase, `list_tables` no projeto `uzumzfxjcxrbxaucvfsr` deve passar a listar as tabelas do schema (`User`, `Contact`, `Lead`, `PipelineStage`, `Task`, `Conversation`, `WhatsappMessage`, `BotConfig`, entre outras) — antes desta tarefa a lista era vazia. Colar a saída no relatório.

- [ ] **Step 7: Conferir se `.env.example` ficou completo**

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -oE '^[A-Z_]+=' .env | sort > /tmp/env-real.txt
grep -oE '^[A-Z_]+=' .env.example | sort > /tmp/env-exemplo.txt
diff /tmp/env-exemplo.txt /tmp/env-real.txt
```

Esperado: sem diferença. Se houver variável só no `.env`, acrescentá-la ao `.env.example` **com comentário explicando para que serve e onde obter** — é o padrão do arquivo — e commitar.

---

### Task 5: Portão de verificação do Ciclo 0

**Files:**
- Nenhum arquivo criado ou modificado. Esta tarefa só executa e registra.

**Interfaces:**
- Consumes: tudo das Tasks 1 a 4.
- Produces: o relatório de fechamento do Ciclo 0.

**Regra:** cada item abaixo fecha com **o comando executado e a saída obtida**, colados. Item que este ambiente não permitir provar sai marcado como não verificado, com o comando que um humano precisa rodar — nunca como "ok" presumido. É a regra que o `AGENTS.md` da base impõe.

- [ ] **Step 1: Typecheck**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
```

Esperado: `tsc --noEmit` sem erro.

- [ ] **Step 2: Suíte unitária completa**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm test
```

Esperado: todos os arquivos de teste passando, incluindo os 4 de fila/turno/webhook que não foram editados na Task 3.

- [ ] **Step 3: Build de produção**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run build
```

Esperado: build conclui. Este passo é o que pega validação de env em escopo de módulo — o modo de falha que já derrubou o deploy da base uma vez. Se falhar com `Failed to collect configuration for /api/...`, a causa é validação rodando na importação, não em uso.

- [ ] **Step 4: Subir em dev e provar o login**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run dev
```

Abrir `http://localhost:3000`, entrar com um usuário criado pelo `prisma/seed.ts` e chegar ao painel. Registrar qual usuário foi usado (**sem a senha**) e o que apareceu na tela.

- [ ] **Step 5: Conferir os critérios de aceite do spec, um a um**

Do spec, seção "Critérios de aceite":

- [ ] `npm run typecheck` sem erro — Step 1
- [ ] `npm test` verde — Step 2
- [ ] `npm run build` conclui — Step 3
- [ ] `npm run dev` sobe e login funciona — Step 4
- [ ] `nathanfvidal/n8necrm` tem o histórico da `main` da origem — Task 1, Step 4
- [ ] O schema do Supabase tem as tabelas do Prisma — Task 4, Step 6

- [ ] **Step 6: Registrar o que ficou pendente para os ciclos seguintes**

Escrever em `docs/superpowers/plans/2026-08-19-n8necrm-ciclo-0-relatorio.md` o que o Ciclo 0 **não** cobriu e bloqueia o que vem depois:

- Chave da API do n8n para o CRM — bloqueia o Ciclo 4
- Domínio do projeto na Vercel — bloqueia o `frame-ancestors` do Ciclo 4
- Segredo JWT do Supabase, e se o projeto usa chave simétrica legada ou assimétrica — bloqueia o Ciclo 1
- Se a suíte e2e (`npm run test:e2e`) foi rodada ou não, e por quê

- [ ] **Step 7: Commit do relatório**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add docs/superpowers/plans/2026-08-19-n8necrm-ciclo-0-relatorio.md
git commit -m "docs: relatorio de fechamento do Ciclo 0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```
