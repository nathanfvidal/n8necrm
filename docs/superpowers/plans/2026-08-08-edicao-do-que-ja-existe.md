# Editar o que já existe — plano de implementação

> **Para quem executa com agentes:** SUB-SKILL OBRIGATÓRIA — use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** tornar corrigível o que hoje só se cria — lead (valor, responsável, etapa),
tarefa e nota — e dar ao CRM a capacidade de arquivar lead e de registrar quanto vale um
negócio.

**Arquitetura:** três camadas já estabelecidas neste projeto. Serviço em `src/core/*`
recebe `autorId` explícito, valida chave estrangeira antes de escrever e grava auditoria;
Server Action em `actions.ts` deriva `autorId` de `usuarioAtual()` e devolve
`ResultadoAcao`; tela consome a action. Dinheiro ganha um módulo puro em `src/lib/`, no
molde de `src/lib/date.ts`.

**Tecnologias:** Next.js 16 (App Router, Server Actions), Prisma 7 + Postgres (Supabase),
Vitest, Playwright, react-hook-form + zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-08-edicao-do-que-ja-existe-design.md`

## Restrições globais

- **Nunca ler, imprimir ou commitar o `.env`.** Verificar variável por presença.
- **Banco compartilhado com produção.** Teste que escreve limpa o que criou, por prefixo.
- **E2E só por `npm run test:e2e`** (encadeia o guarda de porta). Nunca `npx playwright test`.
- **`npm run dev` nunca de forma bloqueante.**
- **Custo do bcrypt continua 10** — nada nesta entrega toca senha, mas vale o lembrete.
- **Commits pela skill `caveman-commit`**, em português sem acento, com o trailer
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Todo teste novo é sabotado antes de ser aceito**: quebre a implementação de propósito,
  confirme que o teste falha pelo motivo certo, desfaça a sabotagem.
- **`core/` nunca importa de `modules/`** (ESLint em nível de erro).
- Verificação de cada tarefa: `npm run typecheck`, `npm run lint`, `npx vitest run`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/dinheiro.ts` (novo) | Converter texto ↔ `Decimal`. Puro, sem Prisma |
| `prisma/schema.prisma` | `Lead.arquivadoEm`, `Lead.valorEstimado` com precisão, `LeadNote.editadoEm` |
| `src/core/leads/service.ts` | `atualizarLead`, `arquivarLead`, `desarquivarLead` |
| `src/core/leads/queries.ts` | Filtro de arquivados nas listagens |
| `src/core/leads/notes.ts` | `editarNota`, `excluirNota` |
| `src/core/tasks/service.ts` | `editarTask`, `excluirTask` |
| `src/core/leads/actions.ts` | Actions de lead e nota |
| `src/core/tasks/actions.ts` | Actions de tarefa |
| `src/components/leads/lead-edit-form.tsx` (novo) | Editar valor/responsável/etapa |
| `src/components/leads/campo-dinheiro.tsx` (novo) | Campo com máscara |
| `src/components/leads/lead-note-list.tsx` (novo) | Notas com edição em linha |
| `src/components/tasks/task-list.tsx` | Edição em linha de tarefa |

### Desvio da spec, deliberado

A spec (§ 8) dizia estender `lead-form.tsx` com uma prop `lead?`, no molde de
`contact-form.tsx`. **Não fazer isso.** `LeadForm` cria contato *e* lead (campos: nome,
telefone, e-mail, responsável); a edição mexe em valor, responsável e etapa. Conjuntos de
campos disjuntos — um componente com os dois teria metade dos campos inertes em cada modo.
Componente próprio, `lead-edit-form.tsx`.

---

### Task 1: Módulo de dinheiro

**Arquivos:**
- Criar: `src/lib/dinheiro.ts`
- Testar: `tests/unit/dinheiro.test.ts`

**Interfaces:**
- Consome: nada (módulo puro, primeira tarefa)
- Produz: `parseValorBR(texto: string): Prisma.Decimal`,
  `formatarValorBR(valor: Prisma.Decimal | string | null): string`,
  `mascararValorBR(digitos: string): string`

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/dinheiro.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { parseValorBR, formatarValorBR, mascararValorBR } from "../../src/lib/dinheiro";

describe("parseValorBR", () => {
  it("aceita o formato brasileiro completo", () => {
    expect(parseValorBR("1.500,50").toString()).toBe("1500.5");
  });

  it("aceita valor sem separador de milhar", () => {
    expect(parseValorBR("1500,50").toString()).toBe("1500.5");
  });

  it("aceita inteiro sem decimais", () => {
    expect(parseValorBR("1500").toString()).toBe("1500");
  });

  // O caso que dá o bug silencioso: parseFloat("1.500") devolve 1.5.
  it("trata ponto como MILHAR, nunca como decimal", () => {
    expect(parseValorBR("1.500").toString()).toBe("1500");
    expect(parseValorBR("1.500.000").toString()).toBe("1500000");
  });

  // Ambíguo entre 1,5 e 15 — recusar é a única resposta honesta.
  it("recusa ponto que não forma grupo de milhar", () => {
    expect(() => parseValorBR("1.5")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("1.50")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("12.34")).toThrow(/Valor inválido/);
  });

  it("recusa mais de duas casas decimais", () => {
    expect(() => parseValorBR("10,123")).toThrow(/Valor inválido/);
  });

  it("recusa texto que não é número", () => {
    expect(() => parseValorBR("mil e quinhentos")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("-100")).toThrow(/Valor inválido/);
  });
});

describe("mascararValorBR", () => {
  // Os algarismos são CENTAVOS: "15050" são 15.050 centavos = R$ 150,50.
  it("monta o valor pela direita, como caixa de banco", () => {
    expect(mascararValorBR("15050")).toBe("150,50");
    expect(mascararValorBR("150050")).toBe("1.500,50");
    expect(mascararValorBR("15000000")).toBe("150.000,00");
    expect(mascararValorBR("150000000")).toBe("1.500.000,00");
  });

  it("preenche centavos quando há poucos dígitos", () => {
    expect(mascararValorBR("5")).toBe("0,05");
    expect(mascararValorBR("")).toBe("");
  });

  it("ignora tudo que não é algarismo", () => {
    expect(mascararValorBR("R$ 1.500,50")).toBe("1.500,50");
  });
});

describe("formatarValorBR", () => {
  it("devolve string vazia para valor ausente", () => {
    expect(formatarValorBR(null)).toBe("");
  });

  it("formata com duas casas e separador de milhar", () => {
    expect(formatarValorBR("1500.5")).toBe("1.500,50");
  });

  // Prova a ida e volta: o que a máscara mostra, o parse aceita.
  it("o que mascararValorBR produz, parseValorBR aceita", () => {
    const mascarado = mascararValorBR("150000000");
    expect(parseValorBR(mascarado).toString()).toBe("1500000");
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/dinheiro.test.ts`
Esperado: FALHA com "Failed to resolve import ... src/lib/dinheiro".

- [ ] **Passo 3: implementar**

`src/lib/dinheiro.ts`:

```ts
import { Prisma } from "@prisma/client";

/**
 * Conversão entre o texto que uma pessoa digita e o `Decimal` do banco.
 *
 * Puro, sem Prisma Client nem Next — só o tipo `Decimal`. Importável por
 * Client e Server Component, igual a `src/lib/date.ts`.
 *
 * ## Por que a regra é estrita
 *
 * "1.500" é ambíguo: 1500 pela convenção brasileira (ponto = milhar) ou 1,5
 * pela americana (ponto = decimal). Nenhuma regra resolve isso a partir do
 * texto. O modo de falhar é o pior possível — `parseFloat("1.500,50")`
 * devolve `1.5` sem erro nenhum, e um negócio de mil e quinhentos vira um e
 * cinquenta no painel do gestor.
 *
 * Aqui o ponto é SEMPRE milhar e precisa formar grupos de três; a vírgula é
 * SEMPRE decimal, com no máximo duas casas. "1.5" é recusado em vez de
 * adivinhado.
 *
 * A tela nem chega a produzir esses casos: `mascararValorBR` faz a pessoa
 * digitar só algarismos e monta o valor pela direita. Este parse é a segunda
 * camada — Server Action é endpoint HTTP público e a máscara vive no cliente.
 */

/** Até 999.999.999.999,99 — o limite de `@db.Decimal(14, 2)`. */
const PADRAO_BR = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

export function parseValorBR(texto: string): Prisma.Decimal {
  const limpo = texto.trim().replace(/^R\$\s*/, "");

  const match = PADRAO_BR.exec(limpo);
  if (!match) {
    throw new Error(
      `Valor inválido: "${texto}" não é um valor em reais. Use 1.500,50 ou 1500,50.`
    );
  }

  const inteiro = match[1].replace(/\./g, "");
  const centavos = (match[2] ?? "").padEnd(2, "0");

  return new Prisma.Decimal(`${inteiro}.${centavos}`);
}

/**
 * Monta o valor pela direita a partir de algarismos, como caixa de banco:
 * "15050" vira "1.500,50". Assim ninguém digita separador, e a ordem de
 * grandeza aparece formada na tela — que é a conferência que protege contra
 * errar entre 150 mil e 1,5 milhão.
 */
export function mascararValorBR(digitos: string): string {
  const so = digitos.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!so) return "";

  const preenchido = so.padStart(3, "0");
  const inteiro = preenchido.slice(0, -2);
  const centavos = preenchido.slice(-2);

  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/**
 * `Decimal` NÃO atravessa a fronteira servidor→cliente (é objeto Decimal.js,
 * não valor serializável). Consultas convertem com `.toString()`; esta função
 * recebe essa string — ou o próprio `Decimal` no servidor — e formata.
 *
 * Nunca `Number`: dinheiro em ponto flutuante é a origem clássica de centavo
 * que some.
 */
export function formatarValorBR(valor: Prisma.Decimal | string | null): string {
  if (valor === null) return "";
  return mascararValorBR(new Prisma.Decimal(valor).toFixed(2));
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/dinheiro.test.ts`
Esperado: PASSA, 12 testes.

- [ ] **Passo 5: sabotar**

Troque `PADRAO_BR` por `/^[\d.,]+$/` e rode de novo. Esperado: os testes "trata ponto como
MILHAR" e "recusa ponto que não forma grupo de milhar" falham. Desfaça.

- [ ] **Passo 6: commitar**

```bash
git add src/lib/dinheiro.ts tests/unit/dinheiro.test.ts
git commit
```

Mensagem: `feat: converte texto em Decimal sem adivinhar separador`. Corpo: explique que
`parseFloat("1.500,50")` devolve 1.5 em silêncio e que "1.500" é ambíguo entre 1500 e 1,5.

---

### Task 2: Migração do schema

**Arquivos:**
- Modificar: `prisma/schema.prisma`
- Criar: `prisma/migrations/<timestamp>_edicao_arquivar_valor/migration.sql` (gerado)

**Interfaces:**
- Consome: nada
- Produz: `Lead.arquivadoEm: DateTime?`, `Lead.valorEstimado: Decimal? @db.Decimal(14,2)`,
  `LeadNote.editadoEm: DateTime?`

- [ ] **Passo 1: editar o schema**

Em `model Lead`, trocar a linha `valorEstimado Decimal?` por:

```prisma
  valorEstimado     Decimal?       @db.Decimal(14, 2)
```

e acrescentar, logo depois de `ultimaInteracaoEm`:

```prisma
  arquivadoEm       DateTime?
```

Acrescentar ao bloco de índices de `Lead`:

```prisma
  @@index([arquivadoEm])
```

Em `model LeadNote`, acrescentar depois de `criadoEm`:

```prisma
  editadoEm DateTime?
```

Acrescentar acima de `arquivadoEm` o comentário:

```prisma
  // `arquivadoEm` (null = ativo) em vez de `ativo Boolean`, e coluna em vez de
  // uma etapa "Arquivado" no funil: uma etapa manteria o lead DENTRO do funil,
  // aparecendo no kanban e somando no painel — o oposto do que arquivar serve.
  // Guarda *quando*, seguindo `Task.concluidaEm`.
  //
  // TODA listagem de lead filtra por esta coluna. Ver `core/leads/queries.ts`.
```

- [ ] **Passo 2: conferir que a redução de precisão não perde dado**

O banco é compartilhado com produção. `valorEstimado` **tem** valores gravados
(`prisma/seed-demo.ts` os escreve — a primeira versão desta spec afirmava que a coluna
estava vazia, e estava errada). Reduzir de `(65,30)` para `(14,2)` arredonda o que tiver
mais de duas casas e falha no que passar de 999.999.999.999,99.

```bash
node -e "require('dotenv').config();const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('SELECT count(*) FILTER (WHERE \"valorEstimado\" <> round(\"valorEstimado\",2)) AS perderiam, count(*) FILTER (WHERE abs(\"valorEstimado\") >= 1e12) AS estourariam FROM \"Lead\" WHERE \"valorEstimado\" IS NOT NULL')).then(r=>console.log(r.rows[0])).finally(()=>c.end())"
```

Esperado: `perderiam: '0'`, `estourariam: '0'`. **Se qualquer um for maior que zero, pare
e pergunte** — a migração perderia dado real.

- [ ] **Passo 3: gerar a migração SEM aplicar**

Rodar: `npx prisma migrate dev --create-only --name edicao_arquivar_valor`

`--create-only` é obrigatório aqui. `migrate dev` sozinho, contra um banco com histórico
divergente, pode oferecer **resetar o banco** — que apagaria a produção. Gere, leia o SQL
gerado, e só então aplique.

- [ ] **Passo 4: aplicar**

Rodar: `npx prisma migrate deploy`

`migrate deploy` é o comando feito para produção: aplica migrações pendentes e nunca
oferece reset.

- [ ] **Passo 3: conferir que o client foi regenerado**

Rodar: `npm run typecheck`
Esperado: passa. Se `arquivadoEm` não existir no tipo, rode `npx prisma generate`.

- [ ] **Passo 4: commitar**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit
```

Mensagem: `feat: colunas de arquivamento, edicao de nota e precisao de valor`.

---

### Task 3: `atualizarLead`

**Arquivos:**
- Modificar: `src/core/leads/service.ts`
- Testar: `tests/unit/leads-atualizar.test.ts`

**Interfaces:**
- Consome: `parseValorBR` (Task 1), `registrarAuditoria` de `@/core/audit/log`
- Produz: `atualizarLead(input: { leadId: string; valorEstimado: string | null;
  responsavelId: string; stageId: string; autorId: string }): Promise<Lead>`

`valorEstimado` chega como **string** (o que o formulário mandou) ou `null` para limpar.
A conversão acontece dentro do serviço, não no chamador — assim qualquer caminho que grave
valor passa pela mesma validação.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/leads-atualizar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  lead: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  pipelineStage: { findUnique: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));
vi.mock("@/core/notifications/dispatch", () => ({ notificarNovoLead: vi.fn() }));

import { atualizarLead } from "../../src/core/leads/service";

const LEAD_ANTES = {
  id: "lead-1",
  valorEstimado: null,
  responsavelId: "user-1",
  stageId: "etapa-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findUniqueOrThrow.mockResolvedValue(LEAD_ANTES);
  prismaMock.user.findUnique.mockResolvedValue({ id: "user-2" });
  prismaMock.pipelineStage.findUnique.mockResolvedValue({ id: "etapa-2" });
  prismaMock.lead.update.mockImplementation(({ data }) => ({ ...LEAD_ANTES, ...data }));
});

describe("atualizarLead", () => {
  it("converte o valor em texto para Decimal", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "1.500,50",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    const dados = prismaMock.lead.update.mock.calls[0][0].data;
    expect(dados.valorEstimado.toString()).toBe("1500.5");
  });

  it("recusa valor mal formado antes de tocar o banco", async () => {
    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: "1.5",
        responsavelId: "user-1",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Valor inválido/);

    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("aceita null para limpar o valor", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.valorEstimado).toBeNull();
  });

  it("recusa responsavel inexistente com erro de dominio, nao violacao de FK", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "fantasma",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Responsável não encontrado/);
    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("recusa etapa inexistente", async () => {
    prismaMock.pipelineStage.findUnique.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "user-1",
        stageId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Etapa não encontrada/);
  });

  it("atualiza ultimaInteracaoEm quando a etapa muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-2",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.ultimaInteracaoEm).toBeInstanceOf(Date);
  });

  it("NAO mexe em ultimaInteracaoEm quando a etapa nao muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "100",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.ultimaInteracaoEm).toBeUndefined();
  });

  it("audita apenas os campos que mudaram", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-2",
      stageId: "etapa-1",
      autorId: "user-9",
    });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-9",
        acao: "atualizar_lead",
        entidade: "Lead",
        entidadeId: "lead-1",
        antes: { responsavelId: "user-1" },
        depois: { responsavelId: "user-2" },
      })
    );
  });

  it("nao grava auditoria quando nada mudou", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(auditoriaMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/leads-atualizar.test.ts`
Esperado: FALHA — `atualizarLead` não é exportada.

- [ ] **Passo 3: implementar**

Acrescentar em `src/core/leads/service.ts` (importe
`import { parseValorBR } from "@/lib/dinheiro";` no topo):

```ts
/**
 * Corrige valor, responsável e etapa de um lead.
 *
 * **Não reusa `moverEtapa`** de propósito. Esta função grava uma auditoria
 * `atualizar_lead`; o arraste do kanban continua gravando `mover_etapa`.
 * Saber se o negócio andou por arraste no funil ou por correção no formulário
 * é informação, não redundância.
 *
 * `valorEstimado` chega como TEXTO (o que o formulário mandou) e é convertido
 * aqui, não no chamador: assim todo caminho que grave valor passa pela mesma
 * validação estrita de `parseValorBR`. `null` limpa o campo.
 *
 * `responsavelId` e `stageId` vêm, em produção, de uma Server Action pública.
 * São conferidos antes de escrever pelo mesmo motivo de `moverEtapa`: sem
 * isso, um id inexistente vira violação de FK crua do Postgres (P2003) em vez
 * de erro legível para quem preencheu.
 *
 * A auditoria registra SÓ os campos que mudaram de fato, e não roda quando
 * nada mudou — uma linha "atualizou" sem diferença nenhuma é ruído que
 * dificulta ler o histórico.
 */
export async function atualizarLead(input: {
  leadId: string;
  valorEstimado: string | null;
  responsavelId: string;
  stageId: string;
  autorId: string;
}): Promise<Lead> {
  const valor = input.valorEstimado === null ? null : parseValorBR(input.valorEstimado);

  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });

  const responsavel = await prisma.user.findUnique({ where: { id: input.responsavelId } });
  if (!responsavel) {
    throw new Error(
      `Responsável não encontrado: "${input.responsavelId}" não corresponde a nenhum usuário.`
    );
  }

  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.stageId } });
  if (!etapa) {
    throw new Error(
      `Etapa não encontrada: "${input.stageId}" não corresponde a nenhuma etapa do funil.`
    );
  }

  const etapaMudou = antes.stageId !== input.stageId;

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: {
      valorEstimado: valor,
      responsavelId: input.responsavelId,
      stageId: input.stageId,
      ...(etapaMudou ? { ultimaInteracaoEm: new Date() } : {}),
    },
  });

  const mudancasAntes: Record<string, unknown> = {};
  const mudancasDepois: Record<string, unknown> = {};

  // `Decimal` não compara com `!==` (são objetos distintos com o mesmo
  // valor); `toString()` de ambos os lados é a comparação que funciona.
  const valorAntes = antes.valorEstimado?.toString() ?? null;
  const valorDepois = depois.valorEstimado?.toString() ?? null;
  if (valorAntes !== valorDepois) {
    mudancasAntes.valorEstimado = valorAntes;
    mudancasDepois.valorEstimado = valorDepois;
  }
  if (antes.responsavelId !== depois.responsavelId) {
    mudancasAntes.responsavelId = antes.responsavelId;
    mudancasDepois.responsavelId = depois.responsavelId;
  }
  if (etapaMudou) {
    mudancasAntes.stageId = antes.stageId;
    mudancasDepois.stageId = depois.stageId;
  }

  if (Object.keys(mudancasDepois).length > 0) {
    await registrarAuditoria({
      userId: input.autorId,
      acao: "atualizar_lead",
      entidade: "Lead",
      entidadeId: depois.id,
      antes: mudancasAntes,
      depois: mudancasDepois,
    });
  }

  return depois;
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/leads-atualizar.test.ts`
Esperado: PASSA, 9 testes.

- [ ] **Passo 5: sabotar**

Remova a checagem `if (!responsavel)`. Esperado: o teste "recusa responsavel inexistente"
falha. Desfaça. Depois troque `parseValorBR` por `Number(...)` e confirme que
"recusa valor mal formado" falha. Desfaça.

- [ ] **Passo 6: commitar**

```bash
git add src/core/leads/service.ts tests/unit/leads-atualizar.test.ts
git commit
```

Mensagem: `feat: atualizarLead corrige valor, responsavel e etapa`.

---

### Task 4: Arquivar, e o filtro nas quatro listagens

Esta é a tarefa de maior risco do plano. Arquivar só funciona se **todas** as consultas
filtrarem; esquecer uma faz o lead reaparecer justamente no painel do gestor.

**Arquivos:**
- Modificar: `src/core/leads/service.ts`, `src/core/leads/queries.ts`,
  `src/app/(painel)/export/leads/route.ts`
- Testar: `tests/unit/leads-arquivar.test.ts`

**Interfaces:**
- Consome: `registrarAuditoria`
- Produz: `arquivarLead(input: { leadId: string; autorId: string }): Promise<Lead>`,
  `desarquivarLead(input: { leadId: string; autorId: string }): Promise<Lead>`,
  `listarLeads(opcoes?: { incluirArquivados?: boolean }): Promise<LeadListado[]>`

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/leads-arquivar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  lead: { findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  pipelineStage: { findMany: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));
vi.mock("@/core/notifications/dispatch", () => ({ notificarNovoLead: vi.fn() }));

import { arquivarLead, desarquivarLead } from "../../src/core/leads/service";
import { listarLeads, listarLeadsPorEtapa } from "../../src/core/leads/queries";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: "lead-1", arquivadoEm: null });
  prismaMock.lead.update.mockImplementation(({ data }) => ({ id: "lead-1", ...data }));
  prismaMock.lead.findMany.mockResolvedValue([]);
  prismaMock.pipelineStage.findMany.mockResolvedValue([]);
});

describe("arquivarLead", () => {
  it("grava a data e audita", async () => {
    await arquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.update.mock.calls[0][0].data.arquivadoEm).toBeInstanceOf(Date);
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "arquivar_lead", entidadeId: "lead-1", userId: "user-1" })
    );
  });

  it("desarquivar limpa a data", async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({
      id: "lead-1",
      arquivadoEm: new Date(),
    });

    await desarquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.update.mock.calls[0][0].data.arquivadoEm).toBeNull();
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "desarquivar_lead" })
    );
  });

  it("recusa arquivar duas vezes", async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({
      id: "lead-1",
      arquivadoEm: new Date(),
    });

    await expect(arquivarLead({ leadId: "lead-1", autorId: "user-1" })).rejects.toThrow(
      /já está arquivado/
    );
  });
});

/**
 * O teste que mais importa desta entrega. Arquivar só funciona se TODA
 * listagem filtrar — a armadilha "regra numa tela, esquecida na outra".
 */
describe("todo caminho de listagem exclui arquivados", () => {
  it("listarLeads filtra por padrao", async () => {
    await listarLeads();
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });

  it("listarLeads pode incluir arquivados quando pedido explicitamente", async () => {
    await listarLeads({ incluirArquivados: true });
    expect(prismaMock.lead.findMany.mock.calls[0][0].where?.arquivadoEm).toBeUndefined();
  });

  it("listarLeadsPorEtapa (kanban e painel) filtra", async () => {
    await listarLeadsPorEtapa();
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/leads-arquivar.test.ts`
Esperado: FALHA — `arquivarLead` não existe.

- [ ] **Passo 3: implementar o serviço**

Em `src/core/leads/service.ts`:

```ts
/**
 * Tira o lead do funil sem apagar nada. Duplicado, engano ou negócio que
 * nunca existiu deixa de poluir kanban, lista, painel e exportação — e
 * continua no histórico do contato, marcado.
 *
 * Recusa arquivar o que já está arquivado (e vice-versa) em vez de aceitar em
 * silêncio: sobrescrever `arquivadoEm` perderia a data original, que é o
 * único registro de QUANDO saiu do funil.
 */
export async function arquivarLead(input: { leadId: string; autorId: string }): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
  if (antes.arquivadoEm) {
    throw new Error("Este lead já está arquivado.");
  }

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { arquivadoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "arquivar_lead",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { arquivadoEm: null },
    depois: { arquivadoEm: depois.arquivadoEm },
  });

  return depois;
}

/** Devolve o lead ao funil. Ver `arquivarLead`. */
export async function desarquivarLead(input: {
  leadId: string;
  autorId: string;
}): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
  if (!antes.arquivadoEm) {
    throw new Error("Este lead não está arquivado.");
  }

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { arquivadoEm: null },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "desarquivar_lead",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { arquivadoEm: antes.arquivadoEm },
    depois: { arquivadoEm: null },
  });

  return depois;
}
```

- [ ] **Passo 4: filtrar nas consultas**

Em `src/core/leads/queries.ts`, acrescente o comentário e o filtro. Em
`listarLeadsPorEtapa`, dentro do `prisma.lead.findMany`:

```ts
  // Arquivado sai do funil por definição — ver `arquivarLead`. Este filtro
  // existe em QUATRO lugares (aqui, `listarLeads`, o painel e o export CSV);
  // `tests/unit/leads-arquivar.test.ts` percorre todos, porque esquecer um faz
  // o lead reaparecer justamente onde arquivar deveria tê-lo removido.
  where: { arquivadoEm: null },
```

Em `listarLeads`, trocar a assinatura e acrescentar o `where`:

```ts
export async function listarLeads(opcoes?: {
  incluirArquivados?: boolean;
}): Promise<LeadListado[]> {
  return prisma.lead.findMany({
    where: opcoes?.incluirArquivados ? {} : { arquivadoEm: null },
    // ...resto igual
```

- [ ] **Passo 5: filtrar no painel e no export**

O painel (`src/app/(painel)/page.tsx`) consome `listarLeadsPorEtapa`, já coberto pelo
passo anterior — confirme lendo o arquivo, não presuma.

Em `src/app/(painel)/export/leads/route.ts`, localize o `prisma.lead.findMany` (ou a
chamada a `listarLeads`) e garanta que arquivados ficam de fora. Se usar `listarLeads()`
sem argumento, já está coberto.

- [ ] **Passo 6: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/leads-arquivar.test.ts`
Esperado: PASSA, 6 testes.

- [ ] **Passo 7: sabotar o teste dos quatro caminhos**

Remova o `where: { arquivadoEm: null }` de `listarLeadsPorEtapa`. Esperado: o teste
"listarLeadsPorEtapa (kanban e painel) filtra" falha. Desfaça e repita para `listarLeads`.

- [ ] **Passo 8: commitar**

```bash
git add src/core/leads/ src/app/\(painel\)/export/ tests/unit/leads-arquivar.test.ts
git commit
```

Mensagem: `feat: arquivar lead tira do funil sem apagar historico`.

---

### Task 5: Editar e excluir nota

**Arquivos:**
- Modificar: `src/core/leads/notes.ts`
- Testar: `tests/unit/leads-notas-editar.test.ts`

**Interfaces:**
- Consome: `registrarAuditoria`, `TEXTO_MAX_LENGTH` (já exportado, vale 4000)
- Produz: `editarNota(input: { notaId: string; texto: string; autorId: string }): Promise<LeadNote>`,
  `excluirNota(input: { notaId: string; autorId: string }): Promise<void>`

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/leads-notas-editar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  leadNote: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { editarNota, excluirNota } from "../../src/core/leads/notes";

const NOTA = { id: "nota-1", leadId: "lead-1", autorId: "user-1", texto: "original" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.leadNote.findUnique.mockResolvedValue(NOTA);
  prismaMock.leadNote.update.mockImplementation(({ data }) => ({ ...NOTA, ...data }));
});

describe("editarNota", () => {
  it("grava o texto novo e marca editadoEm", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    const dados = prismaMock.leadNote.update.mock.calls[0][0].data;
    expect(dados.texto).toBe("corrigido");
    expect(dados.editadoEm).toBeInstanceOf(Date);
  });

  it("recusa quem nao e o autor", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "invasao", autorId: "user-2" })
    ).rejects.toThrow("Nota não encontrada");
    expect(prismaMock.leadNote.update).not.toHaveBeenCalled();
  });

  // A mensagem é a MESMA nos dois casos, de propósito: diferenciá-las
  // confirmaria a quem adivinha ids que aquele id pertence a alguém.
  it("usa a mesma mensagem para inexistente e para nao-e-sua", async () => {
    prismaMock.leadNote.findUnique.mockResolvedValue(null);
    await expect(
      editarNota({ notaId: "sumida", texto: "x", autorId: "user-1" })
    ).rejects.toThrow("Nota não encontrada");
  });

  it("recusa texto vazio", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "   ", autorId: "user-1" })
    ).rejects.toThrow(/Nota vazia/);
  });

  it("recusa texto longo demais", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "x".repeat(4001), autorId: "user-1" })
    ).rejects.toThrow(/muito longa/);
  });

  it("audita com o texto anterior", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "editar_nota",
        entidade: "LeadNote",
        entidadeId: "nota-1",
        antes: { texto: "original" },
      })
    );
  });
});

describe("excluirNota", () => {
  it("apaga e audita guardando o texto que sumiu", async () => {
    await excluirNota({ notaId: "nota-1", autorId: "user-1" });

    expect(prismaMock.leadNote.delete).toHaveBeenCalledWith({ where: { id: "nota-1" } });
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "excluir_nota", antes: { texto: "original" } })
    );
  });

  it("recusa quem nao e o autor", async () => {
    await expect(excluirNota({ notaId: "nota-1", autorId: "user-2" })).rejects.toThrow(
      "Nota não encontrada"
    );
    expect(prismaMock.leadNote.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/leads-notas-editar.test.ts`
Esperado: FALHA — `editarNota` não existe.

- [ ] **Passo 3: implementar**

Em `src/core/leads/notes.ts` (importe `registrarAuditoria` de `@/core/audit/log`):

```ts
/**
 * Regra de dono, igual a `concluirTask`: só o autor edita a própria nota.
 *
 * A mensagem é a MESMA para "não existe" e para "não é sua", de propósito.
 * Diferenciá-las confirmaria, a quem está adivinhando ids, que aquele id
 * pertence a alguém — mesmo sem revelar a quem.
 *
 * `editadoEm` existe para a tela poder marcar "editada". Sem isso o histórico
 * mente por omissão: o texto muda e nada indica que mudou.
 *
 * Auditado (ao contrário de tarefa) porque nota vive num lead — pipeline
 * compartilhado, que a equipe inteira lê. Ver a § 3 da spec.
 */
export async function editarNota(input: {
  notaId: string;
  texto: string;
  autorId: string;
}): Promise<LeadNote> {
  const nota = await prisma.leadNote.findUnique({ where: { id: input.notaId } });
  if (!nota || nota.autorId !== input.autorId) {
    throw new Error("Nota não encontrada");
  }

  const texto = input.texto.trim();
  if (!texto) {
    throw new Error("Nota vazia: informe um texto para a nota.");
  }
  if (texto.length > TEXTO_MAX_LENGTH) {
    throw new Error(
      `Nota muito longa: o texto tem ${texto.length} caracteres, o máximo permitido é ${TEXTO_MAX_LENGTH}.`
    );
  }

  const depois = await prisma.leadNote.update({
    where: { id: input.notaId },
    data: { texto, editadoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "editar_nota",
    entidade: "LeadNote",
    entidadeId: nota.id,
    antes: { texto: nota.texto },
    depois: { texto },
  });

  return depois;
}

/**
 * Remoção real, não lógica: nota não é referenciada por nada, e uma nota
 * "apagada" que continuasse no banco só criaria uma segunda categoria de
 * registro invisível para manter. O texto vai para a auditoria antes de
 * sumir — é lá que fica o rastro.
 */
export async function excluirNota(input: { notaId: string; autorId: string }): Promise<void> {
  const nota = await prisma.leadNote.findUnique({ where: { id: input.notaId } });
  if (!nota || nota.autorId !== input.autorId) {
    throw new Error("Nota não encontrada");
  }

  await prisma.leadNote.delete({ where: { id: input.notaId } });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "excluir_nota",
    entidade: "LeadNote",
    entidadeId: nota.id,
    antes: { texto: nota.texto },
  });
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/leads-notas-editar.test.ts`
Esperado: PASSA, 8 testes.

- [ ] **Passo 5: sabotar**

Troque `nota.autorId !== input.autorId` por `false`. Esperado: os dois testes "recusa quem
nao e o autor" falham. Desfaça.

- [ ] **Passo 6: commitar**

Mensagem: `feat: autor edita e exclui a propria nota`.

---

### Task 6: Editar e excluir tarefa

**Arquivos:**
- Modificar: `src/core/tasks/service.ts`
- Testar: `tests/unit/tasks-editar.test.ts`

**Interfaces:**
- Consome: nada de tarefas anteriores
- Produz: `editarTask(input: { taskId: string; titulo: string; descricao?: string;
  vencimento: Date; leadId?: string | null; autorId: string }): Promise<Task>`,
  `excluirTask(input: { taskId: string; autorId: string }): Promise<void>`

**Sem auditoria**, ao contrário de nota. Consistente com `criarTask` e `concluirTask`, que
já não auditam: tarefa é lembrete pessoal, e uma linha de auditoria por título corrigido é
ruído. Ver § 3 da spec.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/tasks-editar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  lead: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { editarTask, excluirTask } from "../../src/core/tasks/service";

const TASK = { id: "task-1", responsavelId: "user-1", titulo: "original", leadId: null };
const VENCIMENTO = new Date(Date.UTC(2026, 7, 20));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.task.findUnique.mockResolvedValue(TASK);
  prismaMock.task.update.mockImplementation(({ data }) => ({ ...TASK, ...data }));
  prismaMock.lead.findUnique.mockResolvedValue({ id: "lead-1" });
});

describe("editarTask", () => {
  it("grava titulo, descricao e vencimento", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "  corrigido  ",
      descricao: "  detalhe  ",
      vencimento: VENCIMENTO,
      autorId: "user-1",
    });

    const dados = prismaMock.task.update.mock.calls[0][0].data;
    expect(dados.titulo).toBe("corrigido");
    expect(dados.descricao).toBe("detalhe");
    expect(dados.vencimento).toBe(VENCIMENTO);
  });

  it("recusa quem nao e o dono, com a mesma mensagem de inexistente", async () => {
    await expect(
      editarTask({ taskId: "task-1", titulo: "x", vencimento: VENCIMENTO, autorId: "user-2" })
    ).rejects.toThrow("Tarefa não encontrada");
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("recusa titulo vazio", async () => {
    await expect(
      editarTask({ taskId: "task-1", titulo: "   ", vencimento: VENCIMENTO, autorId: "user-1" })
    ).rejects.toThrow(/Título obrigatório/);
  });

  it("recusa vencimento invalido", async () => {
    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "x",
        vencimento: new Date("nao-e-data"),
        autorId: "user-1",
      })
    ).rejects.toThrow(/Vencimento inválido/);
  });

  it("recusa lead inexistente com erro de dominio", async () => {
    prismaMock.lead.findUnique.mockResolvedValue(null);
    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "x",
        vencimento: VENCIMENTO,
        leadId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Lead não encontrado/);
  });

  it("aceita null em leadId para desvincular", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "x",
      vencimento: VENCIMENTO,
      leadId: null,
      autorId: "user-1",
    });
    expect(prismaMock.task.update.mock.calls[0][0].data.leadId).toBeNull();
  });
});

describe("excluirTask", () => {
  it("apaga a propria tarefa", async () => {
    await excluirTask({ taskId: "task-1", autorId: "user-1" });
    expect(prismaMock.task.delete).toHaveBeenCalledWith({ where: { id: "task-1" } });
  });

  it("recusa a tarefa de outra pessoa", async () => {
    await expect(excluirTask({ taskId: "task-1", autorId: "user-2" })).rejects.toThrow(
      "Tarefa não encontrada"
    );
    expect(prismaMock.task.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/tasks-editar.test.ts`
Esperado: FALHA — `editarTask` não existe.

- [ ] **Passo 3: implementar**

Em `src/core/tasks/service.ts`:

```ts
/**
 * Corrige uma tarefa. Regra de dono idêntica a `concluirTask` — inclusive a
 * mensagem única para "não existe" e "não é sua".
 *
 * NÃO audita, de propósito: `criarTask` e `concluirTask` também não, porque
 * tarefa é lembrete pessoal e não pipeline compartilhado. Ver a § 3 da spec
 * e o aviso longo em `concluirTask` sobre não harmonizar as duas naturezas.
 *
 * `leadId` aceita `null` explicitamente para desvincular — `undefined` (campo
 * ausente) e `null` (desvincular) significam coisas diferentes aqui.
 */
export async function editarTask(input: {
  taskId: string;
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string | null;
  autorId: string;
}): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  const titulo = input.titulo.trim();
  if (!titulo) {
    throw new Error("Título obrigatório: informe um título para a tarefa.");
  }
  if (Number.isNaN(input.vencimento.getTime())) {
    throw new Error("Vencimento inválido: informe uma data válida.");
  }
  if (input.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) {
      throw new Error(`Lead não encontrado: "${input.leadId}" não corresponde a nenhum lead.`);
    }
  }

  const descricao = input.descricao?.trim();

  return prisma.task.update({
    where: { id: input.taskId },
    data: {
      titulo,
      descricao: descricao || null,
      vencimento: input.vencimento,
      ...(input.leadId === undefined ? {} : { leadId: input.leadId }),
    },
  });
}

/**
 * Remoção real. `Task` não é referenciada por nenhum modelo, então não há
 * histórico a preservar — e uma tarefa "apagada" que continuasse no banco
 * viraria lixo invisível de manter.
 */
export async function excluirTask(input: { taskId: string; autorId: string }): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  await prisma.task.delete({ where: { id: input.taskId } });
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/tasks-editar.test.ts`
Esperado: PASSA, 8 testes.

- [ ] **Passo 5: sabotar**

Troque `task.responsavelId !== input.autorId` por `false` e confirme que os dois testes de
dono falham. Desfaça.

- [ ] **Passo 6: commitar**

Mensagem: `feat: dono edita e exclui a propria tarefa`.

---

### Task 7: Server Actions

**Arquivos:**
- Modificar: `src/core/leads/actions.ts`, `src/core/tasks/actions.ts`
- Testar: `tests/unit/leads-actions-editar.test.ts`

**Interfaces:**
- Consome: tudo das tarefas 3 a 6; `usuarioAtual` de `@/core/auth/session`;
  `hasPermission` de `@/core/auth/permissions`;
  `ehSessaoInvalida`, `MENSAGEM_SESSAO_INVALIDA`, `ResultadoAcao` de `@/lib/acao`
- Produz: `atualizarLeadAction`, `arquivarLeadAction`, `desarquivarLeadAction`,
  `editarNotaAction`, `excluirNotaAction` (em `leads/actions.ts`);
  `editarTaskAction`, `excluirTaskAction` (em `tasks/actions.ts`).
  Todas devolvem `Promise<ResultadoAcao>`.

- [ ] **Passo 1: ler o padrão antes de escrever**

Leia `src/core/users/actions.ts` inteiro. Ele é o exemplo mais recente e completo do
padrão: `paraResultadoErro`, o gate de permissão dentro do `try`, e `revalidatePath`
específico. Siga-o.

- [ ] **Passo 2: escrever o teste que falha**

`tests/unit/leads-actions-editar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const usuarioAtualMock = vi.hoisted(() => vi.fn());
const atualizarLeadMock = vi.hoisted(() => vi.fn());
const arquivarLeadMock = vi.hoisted(() => vi.fn());

vi.mock("@/core/auth/session", () => ({ usuarioAtual: usuarioAtualMock }));
vi.mock("@/core/leads/service", () => ({
  atualizarLead: atualizarLeadMock,
  arquivarLead: arquivarLeadMock,
  desarquivarLead: vi.fn(),
  criarLead: vi.fn(),
  moverEtapa: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { atualizarLeadAction } from "../../src/core/leads/actions";

const ENTRADA = {
  leadId: "lead-1",
  valorEstimado: "1.500,50",
  responsavelId: "user-1",
  stageId: "etapa-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  usuarioAtualMock.mockResolvedValue({ id: "user-9", papel: "VENDEDOR" });
  atualizarLeadMock.mockResolvedValue({ id: "lead-1" });
});

describe("atualizarLeadAction", () => {
  it("deriva o autor da sessao, nunca do parametro", async () => {
    await atualizarLeadAction(ENTRADA);
    expect(atualizarLeadMock).toHaveBeenCalledWith(
      expect.objectContaining({ autorId: "user-9" })
    );
  });

  it("devolve ok em caso de sucesso", async () => {
    await expect(atualizarLeadAction(ENTRADA)).resolves.toEqual({ ok: true });
  });

  it("recusa quem nao tem mover_lead", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "user-9", papel: "SEM_PAPEL" });
    const resultado = await atualizarLeadAction(ENTRADA);
    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/permissão/) });
    expect(atualizarLeadMock).not.toHaveBeenCalled();
  });

  it("traduz sessao invalida em vez de vazar o erro cru", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    const resultado = await atualizarLeadAction(ENTRADA);
    expect(resultado.ok).toBe(false);
  });

  it("devolve a mensagem de dominio quando o valor e invalido", async () => {
    atualizarLeadMock.mockRejectedValue(new Error('Valor inválido: "1.5" não é um valor em reais.'));
    const resultado = await atualizarLeadAction({ ...ENTRADA, valorEstimado: "1.5" });
    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/Valor inválido/) });
  });
});
```

- [ ] **Passo 3: implementar as sete actions**

Em `src/core/leads/actions.ts`, seguindo `users/actions.ts`. O gate:

```ts
const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para editar leads.";

/**
 * Reusa `mover_lead` em vez de criar permissão nova. Lead é colaborativo
 * neste CRM — qualquer vendedor move o lead de qualquer colega, decisão
 * documentada em `leads/queries.ts` — e editar valor, responsável ou etapa
 * segue a mesma natureza. A auditoria registra quem mexeu.
 *
 * Roda SEMPRE dentro do `try`: fora dele, uma sessão expirada rejeita a
 * promise sem produzir `ResultadoAcao`, e a tela não mostra nem sucesso nem
 * erro.
 */
async function exigirEdicaoDeLead() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "mover_lead")) {
    throw new LeadInvalidoError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}
```

Uma action completa, como molde para as outras seis:

```ts
export async function atualizarLeadAction(dados: {
  leadId: string;
  valorEstimado: string | null;
  responsavelId: string;
  stageId: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirEdicaoDeLead();
    await atualizarLead({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o lead. Tente novamente.");
  }
  revalidatePath("/leads");
  revalidatePath("/leads/kanban");
  revalidatePath(`/leads/${dados.leadId}`);
  revalidatePath("/");
  return { ok: true };
}
```

`paraResultadoErro` segue o de `users/actions.ts`, trocando a família de erro segura de
mostrar: além de `LeadInvalidoError`, ela precisa deixar passar as mensagens de
`parseValorBR` (que começam com `Valor inválido:`) e as de responsável/etapa não
encontrados — são todas escritas para quem preencheu o formulário ler.

`atualizarLeadAction` invalida `/leads`, `/leads/kanban`, `/leads/${leadId}` e `/`.
`arquivarLeadAction` e `desarquivarLeadAction` invalidam os mesmos mais
`/contatos/${contactId}` quando houver contato.

Nota e tarefa não usam permissão — a regra de dono está no serviço. `editarNotaAction` e
`excluirNotaAction` invalidam `/leads/${leadId}`; as de tarefa invalidam `/tasks` e `/`.

Se `LeadInvalidoError` ainda não existir em `leads/`, crie-a no mesmo molde de
`UsuarioInvalidoError` (`src/core/users/service.ts`): classe que estende `Error`, usada
para distinguir "erro seguro de mostrar" de "erro inesperado".

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/leads-actions-editar.test.ts`
Esperado: PASSA, 5 testes.

- [ ] **Passo 5: sabotar**

Mova `const autor = await exigirEdicaoDeLead()` para FORA do `try`. Esperado: o teste
"traduz sessao invalida" falha (a promise rejeita em vez de devolver `ResultadoAcao`).
Desfaça.

- [ ] **Passo 6: commitar**

Mensagem: `feat: actions de edicao, arquivamento, nota e tarefa`.

---

### Task 8: Campo de dinheiro e formulário de edição do lead

**Arquivos:**
- Criar: `src/components/leads/campo-dinheiro.tsx`,
  `src/components/leads/lead-edit-form.tsx`
- Modificar: `src/app/(painel)/leads/[id]/page.tsx`
- Testar: `tests/unit/campo-dinheiro.test.tsx`

**Interfaces:**
- Consome: `mascararValorBR` (Task 1), `atualizarLeadAction`, `arquivarLeadAction`,
  `desarquivarLeadAction` (Task 7)
- Produz: `<CampoDinheiro value={string} onChange={(v: string) => void} />`,
  `<LeadEditForm lead={...} vendedores={...} etapas={...} />`

- [ ] **Passo 1: escrever o teste do campo**

`tests/unit/campo-dinheiro.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CampoDinheiro } from "../../src/components/leads/campo-dinheiro";

describe("CampoDinheiro", () => {
  it("monta o valor pela direita conforme digita", () => {
    const aoMudar = vi.fn();
    render(<CampoDinheiro value="" onChange={aoMudar} label="Valor estimado" />);

    const campo = screen.getByLabelText("Valor estimado");
    fireEvent.change(campo, { target: { value: "150050" } });

    expect(aoMudar).toHaveBeenCalledWith("1.500,50");
  });

  it("ignora o que nao e algarismo", () => {
    const aoMudar = vi.fn();
    render(<CampoDinheiro value="" onChange={aoMudar} label="Valor estimado" />);

    fireEvent.change(screen.getByLabelText("Valor estimado"), {
      target: { value: "abc150abc" },
    });

    expect(aoMudar).toHaveBeenCalledWith("1,50");
  });

  it("usa inputMode numerico para abrir o teclado certo no celular", () => {
    render(<CampoDinheiro value="" onChange={vi.fn()} label="Valor estimado" />);
    expect(screen.getByLabelText("Valor estimado")).toHaveAttribute("inputMode", "numeric");
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run tests/unit/campo-dinheiro.test.tsx`
Esperado: FALHA — módulo não encontrado.

- [ ] **Passo 3: implementar o campo**

`src/components/leads/campo-dinheiro.tsx`:

```tsx
"use client";

import { mascararValorBR } from "@/lib/dinheiro";

/**
 * Campo de dinheiro que não deixa digitar separador.
 *
 * A pessoa digita só algarismos e o valor se monta pela direita, como caixa
 * de banco: "15050" vira "1.500,50". Isso não é enfeite — "1.500" digitado
 * livremente é ambíguo entre 1500 e 1,5, e nenhuma regra resolve isso pelo
 * texto (ver `src/lib/dinheiro.ts`). Tirando o separador do teclado, a
 * ambiguidade deixa de existir, e a ordem de grandeza aparece formada na
 * tela — que é a conferência que protege contra confundir 150 mil com 1,5
 * milhão.
 *
 * `type="text"` e não `type="number"`: `number` recusaria os pontos e
 * vírgulas que a máscara produz. `inputMode="numeric"` abre o teclado
 * numérico no celular sem essa restrição.
 */
export function CampoDinheiro({
  value,
  onChange,
  label,
  id = "valorEstimado",
}: {
  value: string;
  onChange: (valor: string) => void;
  label: string;
  id?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">R$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={value}
          placeholder="0,00"
          onChange={(evento) => onChange(mascararValorBR(evento.target.value))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run tests/unit/campo-dinheiro.test.tsx`
Esperado: PASSA, 3 testes.

- [ ] **Passo 5: implementar o formulário**

`src/components/leads/lead-edit-form.tsx` — cliente, com `react-hook-form` + `zod` no
molde de `lead-form.tsx`. Campos: `CampoDinheiro` para valor, `<select>` de responsável
(lista `vendedores`), `<select>` de etapa (lista `etapas`). Ao enviar, chama
`atualizarLeadAction` e trata `ResultadoAcao`.

Botão "Arquivar" (ou "Desarquivar", conforme `lead.arquivadoEm`) fora do formulário, com
`window.confirm` antes de chamar a action — arquivar tira o lead da lista, e uma ação que
faz algo sumir merece confirmação.

- [ ] **Passo 6: ligar na página**

Em `src/app/(painel)/leads/[id]/page.tsx`, carregue `vendedores` (usuários ativos) e
`etapas` (`listarEtapas`), converta `lead.valorEstimado` com `.toString()` **antes** de
passar ao componente de cliente — `Decimal` não atravessa a fronteira — e renderize
`<LeadEditForm />`.

- [ ] **Passo 7: verificar no navegador**

Rodar `npm run build && npm run start` (não bloqueante), abrir um lead, digitar `150000000`
no valor e confirmar que aparece `1.500.000,00`. Salvar e recarregar: o valor persiste.

- [ ] **Passo 8: commitar**

Mensagem: `feat: tela de edicao do lead com campo de dinheiro mascarado`.

---

### Task 9: Edição em linha de notas e tarefas

**Arquivos:**
- Criar: `src/components/leads/lead-note-list.tsx`
- Modificar: `src/components/tasks/task-list.tsx`,
  `src/app/(painel)/leads/[id]/page.tsx`

**Interfaces:**
- Consome: `editarNotaAction`, `excluirNotaAction`, `editarTaskAction`,
  `excluirTaskAction` (Task 7)
- Produz: `<LeadNoteList notas={...} idDoUsuarioAtual={string} />`

- [ ] **Passo 1: ler o padrão**

Leia `src/components/users/user-table.tsx`. Ele já faz edição em linha com um estado
`editando` guardando o id da linha. Copie a estrutura, não invente outra.

- [ ] **Passo 2: implementar a lista de notas**

`lead-note-list.tsx`, cliente. Cada nota mostra texto, autor, data e — **só quando
`nota.autorId === idDoUsuarioAtual`** — os botões Editar e Excluir. Em edição, um
`<textarea>` com `aria-label={`Texto da nota de ${autor}`}`.

Quando `nota.editadoEm` não for nulo, mostrar "editada" ao lado da data.

Acrescente o comentário:

```tsx
// Os botões só aparecem para o autor, mas isso é conveniência de interface,
// NÃO proteção: `editarNota`/`excluirNota` conferem o dono no servidor. Server
// Action é endpoint HTTP público — esconder botão não protege endpoint.
```

- [ ] **Passo 3: acrescentar edição em `task-list.tsx`**

Mesma estrutura. Campos: título, descrição, vencimento (`<input type="date">`, convertido
com `parseDataCivil`). Botão Excluir com `window.confirm`.

- [ ] **Passo 4: verificar no navegador**

Editar uma nota e confirmar que "editada" aparece. Excluir uma tarefa e confirmar que some.

- [ ] **Passo 5: commitar**

Mensagem: `feat: edicao em linha de nota e tarefa`.

---

### Task 10: Alternador de arquivados na lista

**Arquivos:**
- Modificar: `src/app/(painel)/leads/page.tsx`

- [ ] **Passo 1: implementar**

No molde de `contatos/page.tsx` (`?q=` com `<form method="get">`, sem estado no cliente):
`?arquivados=1` passa `{ incluirArquivados: true }` a `listarLeads`. Quando ligado, a
tabela marca visualmente as linhas arquivadas.

Comentário obrigatório:

```tsx
// Sem este alternador, arquivar seria mão única: o lead some das quatro
// listagens e não existe caminho para encontrá-lo e chamar `desarquivarLead`.
// A autorrevisão da spec pegou justamente isso.
```

- [ ] **Passo 2: marcar arquivados no histórico do contato**

`src/app/(painel)/contatos/[id]/page.tsx` mostra os leads da pessoa. `buscarContatoComHistorico`
**não** filtra arquivados, e isso é a exceção deliberada da spec (§ 8) — não "corrija".

Falta só a marcação visual: nas linhas com `arquivadoEm` preenchido, exiba um rótulo
"Arquivado". Sem isso a pessoa vê um lead que não existe mais no funil e não entende por
quê. Acrescente:

```tsx
// Arquivado APARECE aqui de propósito — é a exceção da § 8 da spec. "O que
// aconteceu com esta pessoa" precisa ser completo; é o FUNIL que precisa ser
// limpo. Não acrescente `arquivadoEm: null` a esta consulta.
```

- [ ] **Passo 3: verificar no navegador**

Arquivar um lead, confirmar que sumiu da lista, marcar "mostrar arquivados", confirmar que
aparece marcado, abrir o contato dele e confirmar que aparece marcado ali também,
desarquivar, confirmar que voltou.

- [ ] **Passo 4: commitar**

Mensagem: `feat: alternador de arquivados e marcacao no historico do contato`.

---

### Task 11: E2E

**Arquivos:**
- Criar: `tests/e2e/lead-edicao.spec.ts`

**Interfaces:**
- Consome: `EMAIL_ADMIN_E2E`, `senhaE2e` de `tests/e2e/credenciais.ts`

- [ ] **Passo 1: escrever o teste**

Siga a estrutura de `tests/e2e/contatos.spec.ts`: `PrismaClient` próprio com `PrismaPg`
(não `@/lib/prisma`, que tem `server-only`), limpeza por prefixo em `beforeAll` e
`afterAll`, e `test.describe.configure({ mode: "serial" })`.

O teste, num único fluxo:

1. Login como `EMAIL_ADMIN_E2E`.
2. Criar um lead com nome prefixado (`e2e-edicao-`).
3. Abrir o lead, digitar `150000000` no valor, confirmar que a tela mostra `1.500.000,00`.
4. Salvar, recarregar, confirmar que o valor persistiu.
5. Arquivar, confirmar `window.confirm`.
6. Ir a `/leads` e confirmar que o lead **não** aparece.
7. Ir a `/leads/kanban` e confirmar que **não** aparece.
8. Ir a `/` e confirmar que **não** está na contagem da etapa.
9. Ir a `/contatos/[id]` do contato e confirmar que **aparece**, marcado como arquivado.
10. Voltar a `/leads?arquivados=1`, desarquivar, confirmar que voltou à lista.

O passo 9 é o que prova a exceção deliberada da spec: o funil fica limpo, o histórico da
pessoa continua completo.

- [ ] **Passo 2: rodar**

Rodar: `npm run test:e2e -- lead-edicao.spec.ts`
Esperado: PASSA.

- [ ] **Passo 3: sabotar**

Remova o filtro `arquivadoEm: null` de `listarLeadsPorEtapa` e confirme que o passo 7 ou 8
falha. Desfaça.

- [ ] **Passo 4: suíte inteira**

Rodar, nesta ordem: `npm run typecheck`, `npm run lint`, `npx vitest run`,
`npm run test:e2e`.
Esperado: tudo verde. O e2e completo precisa da porta 3000 livre.

- [ ] **Passo 5: commitar**

Mensagem: `test: e2e de editar, arquivar e desarquivar lead`.

---

## Verificação final

1. `npm run typecheck` — limpo.
2. `npm run lint` — 0 erros (1 aviso pré-existente em `lead-table.tsx` é esperado).
3. `npx vitest run` — todos passando.
4. `npm run test:e2e` — todos passando.
5. **Auditoria de segurança**: `AGENTS.md` exige a Fase 1 da skill `auditoria-seguranca`
   sobre a superfície que esta branch mexeu, **antes** de integrar. Entregue o relatório e
   pare.
6. Nenhum arquivo temporário na árvore (`git status`).
