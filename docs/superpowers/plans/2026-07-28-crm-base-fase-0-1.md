# CRM Base — Fase 0 + Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a fundação técnica do CRM (Fase 0) e o núcleo funcional de leads/funil (Fase 1), entregando um CRM vendável sem catálogo/site público — esses entram na Fase 2.

**Architecture:** Next.js 16 App Router único, com rotas `(painel)` autenticadas e `(site)` públicas (site fica vazio até a Fase 2). Código organizado em `src/core/` (leads, pipeline, tasks, notifications, audit — sempre presente) e `src/modules/` (catalog, analytics — desligados até suas fases, mas a fronteira de dependência já é imposta por lint desde o Task 4). Banco Postgres via Prisma 7.

**Tech Stack:** Next.js 16 + TypeScript, Tailwind v4 + shadcn/ui, Prisma 7 + PostgreSQL, Auth.js v5, react-hook-form + Zod v4, TanStack Table, dnd-kit, Recharts, Resend, Vitest, Playwright. (Sentry fica como pendência pós-Fase 1 — ver seção final.)

Referência de design: [`docs/superpowers/specs/2026-07-28-crm-base-design.md`](../specs/2026-07-28-crm-base-design.md)

## Global Constraints

- Next.js 16 (App Router), TypeScript estrito, sem `any` não justificado
- Tailwind v4 + shadcn/ui — componentes shadcn vivem em `src/components/ui/`, livres para edição por fork
- Prisma 7 + PostgreSQL — nenhuma outra ORM/driver
- `src/core/**` NUNCA importa de `src/modules/**`. Violação quebra o lint (Task 4)
- **A identidade de quem age NUNCA vem do cliente.** Server Actions são endpoints HTTP públicos: nenhuma delas aceita `usuarioId`/`autorId` como parâmetro, e nenhum componente cliente recebe esse dado como prop. O autor é sempre derivado da sessão no servidor via `usuarioAtual()` (Task 13). A lógica testável fica em `service.ts` com autor explícito; as actions são finas e apenas derivam e delegam
- Todo comando de terminal roda em ambiente NÃO-interativo: nada de prompts. Use `--yes`/`-y`; se um comando exigir TTY, registre como pendência em vez de travar
- Rate limiting é implementado em PostgreSQL (tabela `RateLimit`), não Redis — ver spec seção 7
- `Lead.contactId` é opcional (spec seção 4.6) — leads de canal WHATSAPP podem nascer sem contato identificado
- Todo teste de regra de negócio usa Vitest; todo teste de fluxo ponta-a-ponta usa Playwright — nenhum CRUD trivial ganha teste dedicado (spec seção 8)
- **Teste de componente (React Testing Library + jsdom) é permitido apenas para lógica de ramificação dentro de componentes cliente** — por exemplo, decidir o que fazer conforme o retorno de uma Server Action. NÃO é licença para testar layout, snapshot de componentes shadcn ou renderização estática: isso continua fora de escopo. Infra já instalada na Task 5
- Commits pequenos, um por task concluída, seguindo o padrão `tipo: descrição` (feat, fix, test, chore, docs)

---

## File Structure

```
CRM-Geral/
  config/
    client.ts                      # dados do fork: nome, vertical, módulos, entidade, funil
  prisma/
    schema.prisma
    seed.ts
  src/
    core/
      auth/
        permissions.ts              # matriz de permissão por papel
        session.ts                  # usuarioAtual(): deriva o usuário da sessão
      leads/
        dedupe.ts                   # deduplicação de Contact por telefone
        service.ts                  # lógica de lead com autorId explícito (testável)
        actions.ts                  # Server Actions finas: derivam o autor e delegam
        queries.ts                  # leituras de Lead/Contact
        notes.ts                    # notas do lead
      pipeline/
        stages.ts                   # leitura/validação de PipelineStage
      tasks/
        service.ts                  # lógica de tarefa (testável)
        actions.ts                  # Server Actions finas
        queries.ts
      notifications/
        dispatch.ts                 # cria Notification + dispara e-mail
        email.tsx                   # templates React Email
      audit/
        log.ts                      # wrapper de auditoria
      rate-limit/
        limiter.ts                  # rate limit em Postgres
    modules/
      catalog/                      # vazio, criado como placeholder de fronteira
        .gitkeep
      analytics/                    # vazio, criado como placeholder de fronteira
        .gitkeep
    lib/
      prisma.ts
      auth.ts                       # config Auth.js v5
      storage.ts                    # interface + implementação Supabase
      modules.ts                    # moduloAtivo / exigirModulo (gating por config)
      env.ts                        # validação de variáveis de ambiente com Zod
    middleware.ts
    app/
      (painel)/
        layout.tsx
        login/
          page.tsx
        page.tsx                    # dashboard
        leads/
          page.tsx                  # listagem TanStack Table
          kanban/
            page.tsx                # kanban dnd-kit
          [id]/
            page.tsx                # detalhe: notas, tarefas vinculadas
        tasks/
          page.tsx
        export/
          leads/route.ts            # CSV
      (site)/
        page.tsx                    # placeholder "em construção" até Fase 2
      api/
        auth/[...nextauth]/route.ts
    components/
      ui/                           # shadcn — gerado pelo `shadcn init`
      leads/
        lead-form.tsx
        lead-table.tsx
        kanban-board.tsx
        kanban-card.tsx
      tasks/
        task-form.tsx
        task-list.tsx
      notifications/
        notification-bell.tsx
      dashboard/
        stage-summary.tsx
        conversion-chart.tsx
  eslint.config.mjs
  vitest.config.ts
  playwright.config.ts
  tests/
    unit/
      dedupe.test.ts
      permissions.test.ts
      stage-transition.test.ts
      rate-limit.test.ts
    e2e/
      lead-to-won.spec.ts
```

---

### Task 1: Scaffold do projeto Next.js

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/globals.css`
- Preservar (NÃO sobrescrever): `.gitignore`, `docs/`, `.env`, `.superpowers/`

**Interfaces:**
- Produces: projeto Next.js 16 rodável com `npm run dev`

**Atenção — Tailwind v4 não usa `tailwind.config.ts`.** A v4 é CSS-first: o tema é
declarado com `@theme` dentro de `src/app/globals.css`. Se o scaffold gerar um
`tailwind.config.ts`, não o use como fonte de configuração; qualquer customização
de tema vai no CSS.

- [ ] **Step 1: Confirmar o que já existe antes de scaffoldar**

O diretório NÃO está vazio — já contém `.git/`, `.gitignore`, `.env`, `docs/` e
`.superpowers/`. Registre o estado antes de mexer:

Run: `ls -a`
Anote no relatório os arquivos existentes. Nenhum deles pode ser perdido pelo
scaffold. Em particular, `.gitignore` já contém `node_modules/`, `.next/`, `.env`,
`.env.local`, `*.log` e `.superpowers/` — se o `create-next-app` sobrescrevê-lo,
restaure essas linhas.

- [ ] **Step 2: Criar o projeto (modo não-interativo)**

```bash
npx --yes create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --yes
```

O `--yes` final aceita os padrões sem abrir prompt — necessário porque este
ambiente não tem terminal interativo e qualquer pergunta travaria a execução até
o timeout. Se ainda assim o comando exigir confirmação por causa do diretório
não-vazio, use `--force`.

Se alguma flag for rejeitada pela versão atual do `create-next-app`, NÃO adivinhe:
rode `npx create-next-app@latest --help`, use as flags equivalentes que existirem e
registre no relatório o comando que de fato funcionou.

- [ ] **Step 3: Verificar que o build passa e que nada foi perdido**

Run: `npm run build`
Expected: build conclui sem erro.

Run: `ls -a && cat .gitignore`
Expected: `docs/`, `.env`, `.superpowers/` intactos; `.gitignore` contendo as seis
linhas listadas no Step 1 (restaure as que faltarem).

Use `npm run build` em vez de `npm run dev` para verificação: o dev server fica em
execução indefinidamente e não retorna o controle.

- [ ] **Step 4: Inicializar shadcn/ui**

```bash
npx --yes shadcn@latest init -d --yes
```
Isso cria `components.json` e `src/components/ui/`. O `-d` usa os padrões e o
`--yes` evita qualquer prompt.

- [ ] **Step 5: Adicionar os componentes shadcn usados nas próximas tasks**

```bash
npx --yes shadcn@latest add button input label form card table badge dropdown-menu dialog select textarea sonner avatar separator skeleton --yes
```

`sonner` é o componente de toast atual do shadcn — o antigo `toast` foi
descontinuado. Se algum nome da lista não existir mais, rode
`npx shadcn@latest add` sem argumentos para ver os disponíveis, escolha o
equivalente e registre a troca no relatório.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold do projeto Next.js 16 + Tailwind + shadcn"
```

---

### Task 2: Prisma + PostgreSQL + schema completo do núcleo

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `src/lib/env.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `prisma` client singleton em `src/lib/prisma.ts`, exportado como `export const prisma`
- Produces: tipos gerados `User`, `Contact`, `Lead`, `PipelineStage`, `LeadNote`, `Task`, `Notification`, `AuditLog`, `RateLimit`

- [ ] **Step 1: Instalar dependências**

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Escrever o schema completo do núcleo**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  GESTOR
  VENDEDOR
}

enum LeadChannel {
  FORMULARIO
  WHATSAPP
  MANUAL
}

model User {
  id            String         @id @default(cuid())
  nome          String
  email         String         @unique
  senhaHash     String
  papel         Role
  ativo         Boolean        @default(true)
  criadoEm      DateTime       @default(now())
  leadsAtribuidos Lead[]       @relation("LeadResponsavel")
  tasks         Task[]
  notes         LeadNote[]
  notifications Notification[]
  auditLogs     AuditLog[]
}

model Contact {
  id        String   @id @default(cuid())
  nome      String
  telefone  String   @unique
  email     String?
  criadoEm  DateTime @default(now())
  leads     Lead[]
}

model PipelineStage {
  id        String   @id @default(cuid())
  nome      String
  ordem     Int
  cor       String
  ehGanho   Boolean  @default(false)
  ehPerdido Boolean  @default(false)
  leads     Lead[]

  @@unique([ordem])
}

model Lead {
  id                 String        @id @default(cuid())
  contactId          String?
  contact            Contact?      @relation(fields: [contactId], references: [id])
  itemId             String?
  stageId            String
  stage              PipelineStage @relation(fields: [stageId], references: [id])
  responsavelId      String?
  responsavel        User?         @relation("LeadResponsavel", fields: [responsavelId], references: [id])
  canal              LeadChannel
  valorEstimado      Decimal?
  sessionId          String?
  utm                Json?
  criadoEm           DateTime      @default(now())
  ultimaInteracaoEm  DateTime      @default(now())
  notes              LeadNote[]
  tasks              Task[]

  @@index([stageId, responsavelId])
  @@index([criadoEm])
}

model LeadNote {
  id        String   @id @default(cuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  autorId   String
  autor     User     @relation(fields: [autorId], references: [id])
  texto     String
  criadoEm  DateTime @default(now())
}

model Task {
  id            String    @id @default(cuid())
  titulo        String
  descricao     String?
  vencimento    DateTime
  concluidaEm   DateTime?
  responsavelId String
  responsavel   User      @relation(fields: [responsavelId], references: [id])
  leadId        String?
  lead          Lead?     @relation(fields: [leadId], references: [id], onDelete: SetNull)
  criadoEm      DateTime  @default(now())
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  tipo      String
  payload   Json
  lidaEm    DateTime?
  criadoEm  DateTime @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  acao       String
  entidade   String
  entidadeId String
  antes      Json?
  depois     Json?
  ip         String?
  criadoEm   DateTime @default(now())
}

model RateLimit {
  chave        String   @id
  janelaInicio DateTime
  contagem     Int      @default(0)
}
```

- [ ] **Step 3: Validação de variáveis de ambiente**

`src/lib/env.ts`:
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
});
```

`.env.example`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/crm_dev"
AUTH_SECRET="gerar-com-openssl-rand-base64-32"
```

- [ ] **Step 4: Cliente Prisma singleton**

`src/lib/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 5: Criar `.env` local e rodar a primeira migração**

Copiar `.env.example` para `.env`, preencher `DATABASE_URL` com um Postgres real (local ou hospedado) e `AUTH_SECRET` com `openssl rand -base64 32`.

```bash
npx prisma migrate dev --name init
```
Expected: migração aplicada, `prisma/migrations/` criado.

- [ ] **Step 6: Commit**

```bash
git add prisma src/lib/prisma.ts src/lib/env.ts .env.example package.json package-lock.json
git commit -m "feat: schema Prisma do núcleo e cliente de banco"
```

---

### Task 3: `config/client.ts` — o arquivo do fork

**Files:**
- Create: `vitest.config.ts`
- Create: `config/client.ts`
- Create: `config/client.schema.ts`
- Test: `tests/unit/client-config.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces: `export const client: ClientConfig` — consumido por Task 6 (permissions), Task 9 (seed de PipelineStage) e futuramente pelo módulo catalog
- Produces: `npm run test` funcionando — todas as tasks seguintes com teste dependem disto

**Correção de ordenação:** esta é a primeira task com teste, então o Vitest é
instalado e configurado AQUI, não na Task 11. A Task 11 cuida apenas do Playwright.

- [ ] **Step 0: Instalar e configurar o Vitest**

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
```

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

O plugin `vite-tsconfig-paths` faz o alias `@/` do tsconfig funcionar nos testes —
as tasks seguintes importam por `@/core/...` e quebram sem ele.

Adicionar ao `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 1: Escrever o schema de validação da config**

`config/client.schema.ts`:
```typescript
import { z } from "zod";

export const campoSchema = z.object({
  nome: z.string(),
  tipo: z.enum(["texto", "numero", "opcao", "booleano"]),
  obrigatorio: z.boolean().default(false),
  filtravel: z.boolean().default(false),
  opcoes: z.array(z.string()).optional(),
});

export const clientConfigSchema = z.object({
  nome: z.string(),
  vertical: z.string(),
  marca: z.object({
    logo: z.string(),
    corPrimaria: z.string(),
    fonte: z.string(),
  }),
  modulos: z.array(z.enum(["catalog", "analytics", "automation", "campaigns", "finance"])),
  entidade: z.object({
    singular: z.string(),
    plural: z.string(),
    campos: z.array(campoSchema),
  }),
  funil: z.array(z.string()).min(1),
  whatsapp: z.object({
    numero: z.string(),
    mensagem: z.string(),
  }),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
```

- [ ] **Step 2: Escrever o teste de validação**

`tests/unit/client-config.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { clientConfigSchema } from "../../config/client.schema";
import { client } from "../../config/client";

describe("config/client.ts", () => {
  it("é válido segundo o schema", () => {
    expect(() => clientConfigSchema.parse(client)).not.toThrow();
  });

  it("tem ao menos uma etapa de funil", () => {
    expect(client.funil.length).toBeGreaterThan(0);
  });

  it("só referencia módulos conhecidos", () => {
    const modulosValidos = ["catalog", "analytics", "automation", "campaigns", "finance"];
    for (const m of client.modulos) {
      expect(modulosValidos).toContain(m);
    }
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/client-config.test.ts`
Expected: FAIL — `config/client.ts` ainda não existe.

- [ ] **Step 4: Escrever `config/client.ts` com os dados do exemplo (revenda de veículos)**

`config/client.ts`:
```typescript
import { ClientConfig } from "./client.schema";

export const client: ClientConfig = {
  nome: "AutoCenter Exemplo",
  vertical: "automotivo",
  marca: {
    logo: "/logo.svg",
    corPrimaria: "#0F62FE",
    fonte: "Inter",
  },
  modulos: ["catalog", "analytics"],
  entidade: {
    singular: "Veículo",
    plural: "Veículos",
    campos: [
      { nome: "marca", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "modelo", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "ano", tipo: "numero", obrigatorio: true, filtravel: true },
      { nome: "km", tipo: "numero", obrigatorio: false, filtravel: true },
      { nome: "cambio", tipo: "opcao", obrigatorio: false, filtravel: true, opcoes: ["Manual", "Automático"] },
      { nome: "cor", tipo: "texto", obrigatorio: false, filtravel: false },
    ],
  },
  funil: ["Novo", "Contato feito", "Visita agendada", "Proposta", "Fechado"],
  whatsapp: {
    numero: "5511999999999",
    mensagem: "Olá, tenho interesse no {item}",
  },
};
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/client-config.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add config vitest.config.ts tests/unit/client-config.test.ts package.json package-lock.json
git commit -m "feat: config/client.ts com schema de validacao e setup do Vitest"
```

---

### Task 4: Fronteira core/modules imposta por ESLint

**Files:**
- Modify: `eslint.config.mjs`
- Create: `src/modules/catalog/.gitkeep`
- Create: `src/modules/analytics/.gitkeep`

**Interfaces:**
- Produces: regra de lint que falha o build se `src/core/**` importar de `src/modules/**`

- [ ] **Step 1: Instalar o plugin de import restriction**

```bash
npm install -D eslint-plugin-import
```

- [ ] **Step 2: Criar as pastas de módulo como placeholder**

```bash
mkdir -p src/modules/catalog src/modules/analytics
touch src/modules/catalog/.gitkeep src/modules/analytics/.gitkeep
```

- [ ] **Step 3: Adicionar a regra ao `eslint.config.mjs`**

Adicionar ao array de configuração exportado (mantendo o que o `create-next-app` já gerou):
```javascript
{
  files: ["src/core/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/modules/*", "@/modules/*"],
            message: "src/core não pode importar de src/modules — ver spec seção 3.3",
          },
        ],
      },
    ],
  },
},
```

- [ ] **Step 4: Provar que a regra funciona**

Criar temporariamente um arquivo `src/core/leads/_teste-violacao.ts` com `import x from "@/modules/catalog/x"` e rodar:
Run: `npx eslint src/core/leads/_teste-violacao.ts`
Expected: erro reportado pela regra `no-restricted-imports`.
Apagar o arquivo de teste depois de confirmar.

- [ ] **Step 5: Rodar lint completo do projeto**

Run: `npm run lint`
Expected: sem erros (o projeto ainda não tem código real em `core/` ou `modules/`).

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs src/modules
git commit -m "chore: impõe fronteira core/modules via ESLint"
```

---

### Task 5: Auth.js v5 — login por credenciais e sessão

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(painel)/login/page.tsx`
- Create: `src/core/auth/permissions.ts`
- Test: `tests/unit/permissions.test.ts`

**Interfaces:**
- Produces: `export const { auth, signIn, signOut, handlers } from "@/lib/auth"`
- Produces: `hasPermission(papel: Role, acao: Acao): boolean` em `src/core/auth/permissions.ts`
- Consumes: `prisma` (Task 2), enum `Role` gerado pelo Prisma (Task 2)

- [ ] **Step 1: Instalar dependências**

```bash
npm install next-auth@beta bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Escrever o teste da matriz de permissões**

`tests/unit/permissions.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { hasPermission } from "../../src/core/auth/permissions";

describe("hasPermission", () => {
  it("ADMIN pode gerenciar usuários", () => {
    expect(hasPermission("ADMIN", "gerenciar_usuarios")).toBe(true);
  });

  it("VENDEDOR não pode gerenciar usuários", () => {
    expect(hasPermission("VENDEDOR", "gerenciar_usuarios")).toBe(false);
  });

  it("VENDEDOR pode criar lead", () => {
    expect(hasPermission("VENDEDOR", "criar_lead")).toBe(true);
  });

  it("GESTOR pode ver dashboard de todos os vendedores", () => {
    expect(hasPermission("GESTOR", "ver_dashboard_geral")).toBe(true);
  });

  it("VENDEDOR não pode ver dashboard de todos os vendedores", () => {
    expect(hasPermission("VENDEDOR", "ver_dashboard_geral")).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/permissions.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar a matriz de permissões**

`src/core/auth/permissions.ts`:
```typescript
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
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/permissions.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 6: Configurar Auth.js v5**

`src/lib/auth.ts`:
```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const senha = credentials?.senha as string | undefined;
        if (!email || !senha) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.ativo) return null;

        const senhaValida = await bcrypt.compare(senha, user.senhaHash);
        if (!senhaValida) return null;

        return { id: user.id, name: user.nome, email: user.email, role: user.papel };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
});
```

- [ ] **Step 7: Rota de API do Auth.js**

`src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 8: Página de login**

`src/app/(painel)/login/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setErro(null);
    const resultado = await signIn("credentials", {
      email: formData.get("email"),
      senha: formData.get("senha"),
      redirect: false,
    });

    if (resultado?.error) {
      setErro("E-mail ou senha inválidos.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form action={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <Input id="senha" name="senha" type="password" required />
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <Button type="submit" className="w-full">Entrar</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Adicionar `AUTH_SECRET` ao `.env` se ainda não estiver**

Confirmar que `.env` tem `AUTH_SECRET` (criado na Task 2).

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth src/app/\(painel\)/login src/core/auth tests/unit/permissions.test.ts package.json package-lock.json
git commit -m "feat: autenticação via Auth.js v5 e matriz de permissões"
```

---

### Task 6: Middleware de proteção de rota

**Files:**
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `auth` de `src/lib/auth.ts` (Task 5)

- [ ] **Step 1: Escrever o middleware**

`src/middleware.ts`:
```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isSitePublico = req.nextUrl.pathname.startsWith("/site");

  if (isSitePublico) return NextResponse.next();

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Testar manualmente**

Run: `npm run dev`
Acessar `http://localhost:3000/` sem estar logado.
Expected: redireciona para `/login`.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: middleware de proteção de rotas do painel"
```

---

### Task 7: `lib/storage.ts` — interface trocável de armazenamento

**Files:**
- Create: `src/lib/storage.ts`
- Test: `tests/unit/storage.test.ts`

**Interfaces:**
- Produces: `interface Storage { upload(path: string, file: Buffer, contentType: string): Promise<string>; delete(path: string): Promise<void>; }`
- Produces: `export const storage: Storage`

- [ ] **Step 1: Instalar o SDK do Supabase**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Escrever o teste com um fake in-memory**

`tests/unit/storage.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import type { Storage } from "../../src/lib/storage";

class FakeStorage implements Storage {
  private arquivos = new Map<string, Buffer>();

  async upload(path: string, file: Buffer): Promise<string> {
    this.arquivos.set(path, file);
    return `https://fake-storage.local/${path}`;
  }

  async delete(path: string): Promise<void> {
    this.arquivos.delete(path);
  }

  has(path: string): boolean {
    return this.arquivos.has(path);
  }
}

describe("Storage (contrato)", () => {
  it("upload retorna uma URL contendo o path", async () => {
    const fake = new FakeStorage();
    const url = await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    expect(url).toContain("itens/foto.webp");
  });

  it("delete remove o arquivo previamente enviado", async () => {
    const fake = new FakeStorage();
    await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    await fake.delete("itens/foto.webp");
    expect(fake.has("itens/foto.webp")).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: FAIL — `src/lib/storage.ts` não exporta o tipo `Storage` ainda.

- [ ] **Step 4: Implementar a interface e a implementação Supabase**

`src/lib/storage.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";

export interface Storage {
  upload(path: string, file: Buffer, contentType: string): Promise<string>;
  delete(path: string): Promise<void>;
}

const BUCKET = "crm-arquivos";

class SupabaseStorage implements Storage {
  private client = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  );

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    const { error } = await this.client.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Falha no upload: ${error.message}`);

    const { data } = this.client.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async delete(path: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(`Falha ao remover: ${error.message}`);
  }
}

export const storage: Storage = new SupabaseStorage();
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: PASS (2 testes — usam o fake, não a implementação real, então não exigem credenciais Supabase)

- [ ] **Step 6: Adicionar variáveis ao `.env.example`**

Adicionar a `.env.example`:
```
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage.ts tests/unit/storage.test.ts .env.example package.json package-lock.json
git commit -m "feat: interface de storage trocável com implementação Supabase"
```

---

### Task 8: Audit log e rate limit em Postgres

**Files:**
- Create: `src/core/audit/log.ts`
- Create: `src/core/rate-limit/limiter.ts`
- Test: `tests/unit/rate-limit.test.ts`

**Interfaces:**
- Produces: `registrarAuditoria(params: { userId: string; acao: string; entidade: string; entidadeId: string; antes?: unknown; depois?: unknown; ip?: string }): Promise<void>`
- Produces: `checarRateLimit(chave: string, limite: number, janelaMs: number): Promise<boolean>` — retorna `true` se a ação é permitida
- Consumes: `prisma` (Task 2)

- [ ] **Step 1: Implementar o audit log**

`src/core/audit/log.ts`:
```typescript
import { prisma } from "@/lib/prisma";

export async function registrarAuditoria(params: {
  userId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  ip?: string;
}): Promise<void> {
  await prisma.auditLog.create({
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
```

- [ ] **Step 2: Escrever o teste do rate limiter**

`tests/unit/rate-limit.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { checarRateLimit } from "../../src/core/rate-limit/limiter";

describe("checarRateLimit", () => {
  beforeEach(async () => {
    await prisma.rateLimit.deleteMany({ where: { chave: { startsWith: "teste:" } } });
  });

  it("permite as primeiras N chamadas dentro do limite", async () => {
    const chave = "teste:formulario:sessao-1";
    for (let i = 0; i < 3; i++) {
      const permitido = await checarRateLimit(chave, 3, 60_000);
      expect(permitido).toBe(true);
    }
  });

  it("bloqueia a chamada que excede o limite na mesma janela", async () => {
    const chave = "teste:formulario:sessao-2";
    await checarRateLimit(chave, 2, 60_000);
    await checarRateLimit(chave, 2, 60_000);
    const terceira = await checarRateLimit(chave, 2, 60_000);
    expect(terceira).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/rate-limit.test.ts`
Expected: FAIL — `checarRateLimit` não existe.

- [ ] **Step 4: Implementar o rate limiter**

`src/core/rate-limit/limiter.ts`:
```typescript
import { prisma } from "@/lib/prisma";

export async function checarRateLimit(
  chave: string,
  limite: number,
  janelaMs: number
): Promise<boolean> {
  const agora = new Date();

  const registro = await prisma.rateLimit.findUnique({ where: { chave } });

  if (!registro || agora.getTime() - registro.janelaInicio.getTime() > janelaMs) {
    await prisma.rateLimit.upsert({
      where: { chave },
      create: { chave, janelaInicio: agora, contagem: 1 },
      update: { janelaInicio: agora, contagem: 1 },
    });
    return true;
  }

  if (registro.contagem >= limite) {
    return false;
  }

  await prisma.rateLimit.update({
    where: { chave },
    data: { contagem: { increment: 1 } },
  });
  return true;
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Precisa de `DATABASE_URL` válido apontando para um Postgres real (o mesmo usado na Task 2).
Run: `npx vitest run tests/unit/rate-limit.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add src/core/audit src/core/rate-limit tests/unit/rate-limit.test.ts
git commit -m "feat: audit log e rate limiter em Postgres"
```

---

### Task 9: Seed determinístico + PipelineStage a partir do config

**Files:**
- Create: `prisma/seed.ts`
- Create: `src/core/pipeline/stages.ts`
- Modify: `package.json` (script `prisma.seed`)

**Interfaces:**
- Produces: `listarEtapas(): Promise<PipelineStage[]>` em `src/core/pipeline/stages.ts`
- Consumes: `client` de `config/client.ts` (Task 3), `prisma` (Task 2)

- [ ] **Step 1: Implementar a leitura de etapas**

`src/core/pipeline/stages.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import type { PipelineStage } from "@prisma/client";

export async function listarEtapas(): Promise<PipelineStage[]> {
  return prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
}
```

- [ ] **Step 2: Escrever o seed**

`prisma/seed.ts`:
```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { client } from "../config/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.pipelineStage.deleteMany();
  for (const [index, nome] of client.funil.entries()) {
    await prisma.pipelineStage.create({
      data: {
        nome,
        ordem: index,
        cor: ["#94A3B8", "#60A5FA", "#FBBF24", "#F97316", "#22C55E"][index % 5],
        ehGanho: index === client.funil.length - 1,
        ehPerdido: false,
      },
    });
  }

  const senhaHash = await bcrypt.hash("senha123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@exemplo.com" },
    update: {},
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash, papel: "ADMIN" },
  });

  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@exemplo.com" },
    update: {},
    create: { nome: "Vendedor Exemplo", email: "vendedor@exemplo.com", senhaHash, papel: "VENDEDOR" },
  });

  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });

  const nomes = ["Carlos Silva", "Fernanda Lima", "João Pereira", "Marina Costa"];
  for (let i = 0; i < nomes.length; i++) {
    const contact = await prisma.contact.upsert({
      where: { telefone: `1199999000${i}` },
      update: {},
      create: { nome: nomes[i], telefone: `1199999000${i}` },
    });

    await prisma.lead.create({
      data: {
        contactId: contact.id,
        stageId: primeiraEtapa.id,
        responsavelId: i % 2 === 0 ? admin.id : vendedor.id,
        canal: "MANUAL",
      },
    });
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Registrar o script de seed no `package.json`**

Adicionar em `package.json`:
```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

```bash
npm install -D tsx
```

- [ ] **Step 4: Rodar o seed**

Run: `npx prisma db seed`
Expected: "Seed concluído." impresso, sem erro.

- [ ] **Step 5: Verificar no Prisma Studio**

Run: `npx prisma studio`
Confirmar visualmente: 5 `PipelineStage` (na ordem do `config/client.ts`), 2 `User`, 4 `Contact`, 4 `Lead`.
Fechar o Studio.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts src/core/pipeline package.json package-lock.json
git commit -m "feat: seed determinístico e leitura de etapas do funil"
```

---

### Task 10: Layout do painel — navegação, cabeçalho, estados

**Files:**
- Create: `src/app/(painel)/layout.tsx`
- Create: `src/components/painel-nav.tsx`
- Create: `src/components/loading-state.tsx`
- Create: `src/components/empty-state.tsx`

**Interfaces:**
- Consumes: `auth` (Task 5)
- Produces: `<LoadingState />`, `<EmptyState title=... description=... />` — reutilizados por toda a Fase 1

- [ ] **Step 1: Estados reutilizáveis**

`src/components/loading-state.tsx`:
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
```

`src/components/empty-state.tsx`:
```tsx
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
```

- [ ] **Step 2: Navegação do painel**

`src/components/painel-nav.tsx`:
```tsx
import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/leads/kanban", label: "Funil" },
  { href: "/tasks", label: "Tarefas" },
];

export function PainelNav() {
  return (
    <nav className="flex gap-4 border-b p-4">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-sm font-medium hover:underline">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Layout do grupo `(painel)`**

`src/app/(painel)/layout.tsx`:
```tsx
import { PainelNav } from "@/components/painel-nav";
import { auth } from "@/lib/auth";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen">
      {session && <PainelNav />}
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm run dev`
Fazer login com `admin@exemplo.com` / `senha123` (criado pelo seed).
Expected: navegação visível, links funcionando (páginas ainda não existem — 404 é esperado nas próximas até completarmos as tasks seguintes).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(painel\)/layout.tsx src/components/painel-nav.tsx src/components/loading-state.tsx src/components/empty-state.tsx
git commit -m "feat: layout e navegação do painel"
```

---

### Task 10A: Gating de módulos — menu e rota

**Files:**
- Create: `src/lib/modules.ts`
- Modify: `src/components/painel-nav.tsx`
- Test: `tests/unit/modules.test.ts`

**Interfaces:**
- Produces: `moduloAtivo(nome: ModuloNome): boolean`
- Produces: `exigirModulo(nome: ModuloNome): void` — chama `notFound()` do Next quando o módulo está desligado
- Consumes: `client` de `config/client.ts` (Task 3)

Isso implementa a spec seção 3.4: "Módulo ausente de `modulos` some do menu e sua rota devolve 404 — não é CSS escondendo botão." Nenhuma rota de módulo existe ainda na Fase 1 (catalog e analytics são Fase 2 e 3), mas o mecanismo precisa existir antes delas para que sejam construídas já protegidas.

- [ ] **Step 1: Escrever o teste**

`tests/unit/modules.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { moduloAtivo } from "../../src/lib/modules";
import { client } from "../../config/client";

describe("moduloAtivo", () => {
  it("retorna true para módulo listado em config/client.ts", () => {
    const primeiro = client.modulos[0];
    expect(moduloAtivo(primeiro)).toBe(true);
  });

  it("retorna false para módulo não listado", () => {
    const todos = ["catalog", "analytics", "automation", "campaigns", "finance"] as const;
    const desligado = todos.find((m) => !client.modulos.includes(m));
    if (!desligado) throw new Error("Teste exige ao menos um módulo desligado no config");
    expect(moduloAtivo(desligado)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/modules.test.ts`
Expected: FAIL — `src/lib/modules.ts` não existe.

- [ ] **Step 3: Implementar**

`src/lib/modules.ts`:
```typescript
import { notFound } from "next/navigation";
import { client } from "../../config/client";

export type ModuloNome = "catalog" | "analytics" | "automation" | "campaigns" | "finance";

export function moduloAtivo(nome: ModuloNome): boolean {
  return client.modulos.includes(nome);
}

export function exigirModulo(nome: ModuloNome): void {
  if (!moduloAtivo(nome)) notFound();
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/modules.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Aplicar o gating ao menu**

Substituir `src/components/painel-nav.tsx` (criado na Task 10) por:
```tsx
import Link from "next/link";
import { moduloAtivo } from "@/lib/modules";

const linksFixos = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/leads/kanban", label: "Funil" },
  { href: "/tasks", label: "Tarefas" },
];

const linksDeModulo = [
  { href: "/catalogo", label: "Catálogo", modulo: "catalog" as const },
  { href: "/analytics", label: "Analytics", modulo: "analytics" as const },
];

export function PainelNav() {
  const links = [
    ...linksFixos,
    ...linksDeModulo.filter((link) => moduloAtivo(link.modulo)),
  ];

  return (
    <nav className="flex items-center gap-4 border-b p-4">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-sm font-medium hover:underline">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

Com o `config/client.ts` da Task 3 (`modulos: ["catalog", "analytics"]`), os dois links de módulo aparecem. As rotas `/catalogo` e `/analytics` só serão criadas nas Fases 2 e 3 — até lá os links dão 404, o que é o comportamento correto e esperado.

- [ ] **Step 6: Verificar o gating manualmente**

Editar temporariamente `config/client.ts` removendo `"analytics"` do array `modulos`.
Run: `npm run dev`
Expected: o link "Analytics" desaparece do menu.
Restaurar o `config/client.ts` ao estado original depois de confirmar.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modules.ts src/components/painel-nav.tsx tests/unit/modules.test.ts
git commit -m "feat: gating de módulos no menu e helper de 404 por rota"
```

---

### Task 11: Configuração do Playwright

**Files:**
- Create: `playwright.config.ts`
- Modify: `package.json` (script `test:e2e`)

**Interfaces:**
- Produces: `npm run test:e2e`
- Consumes: Vitest já instalado e configurado na Task 3

**O Vitest NÃO entra aqui** — ele foi instalado e configurado na Task 3, que é a
primeira task com teste. Esta task cuida apenas do Playwright. Se `vitest.config.ts`
não existir quando você chegar aqui, algo deu errado na Task 3: pare e reporte.

**Sentry fica fora desta task, deliberadamente.** O `@sentry/wizard` é interativo
(pede login e escolha de projeto no terminal) e travaria a execução automatizada
(falha verificada: `ERR_TTY_INIT_FAILED`). Além disso, o projeto ainda não tem conta
Sentry. Monitoramento de erro entra como pendência documentada na seção final deste
plano — configurar manualmente não bloqueia nenhuma das outras tasks.

- [ ] **Step 1: Instalar dependências**

```bash
npm install -D @playwright/test
npx --yes playwright install chromium
```

`playwright install` sem `--with-deps`: a flag de dependências de sistema é para
Linux e exige privilégio de administrador; aqui o ambiente é Windows.

- [ ] **Step 3: Configurar Playwright**

`playwright.config.ts`:
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] **Step 4: Script no `package.json`**

Adicionar ao bloco `scripts` já existente (que hoje tem `test` e `test:watch`,
criados na Task 3 — não os remova nem os duplique):
```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Rodar toda a suíte unitária existente**

Run: `npm run test`
Expected: PASS — todos os testes das Tasks 3, 5, 7, 8, 10.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts package.json package-lock.json
git commit -m "chore: configura Playwright para testes e2e"
```

---

### Task 12: Deduplicação de Contact por telefone

**Files:**
- Create: `src/core/leads/dedupe.ts`
- Test: `tests/unit/dedupe.test.ts`

**Interfaces:**
- Produces: `encontrarOuCriarContact(dados: { nome: string; telefone: string; email?: string }): Promise<Contact>`
- Consumes: `prisma` (Task 2)

- [ ] **Step 1: Escrever o teste**

`tests/unit/dedupe.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { encontrarOuCriarContact } from "../../src/core/leads/dedupe";

describe("encontrarOuCriarContact", () => {
  beforeEach(async () => {
    await prisma.contact.deleteMany({ where: { telefone: { startsWith: "119999" } } });
  });

  it("cria um novo contato quando o telefone não existe", async () => {
    const contact = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11999912345" });
    expect(contact.nome).toBe("Ana Souza");
    expect(contact.telefone).toBe("11999912345");
  });

  it("retorna o contato existente quando o telefone já está cadastrado", async () => {
    const primeiro = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11999912346" });
    const segundo = await encontrarOuCriarContact({ nome: "Ana S.", telefone: "11999912346" });
    expect(segundo.id).toBe(primeiro.id);
  });

  it("não sobrescreve o nome do contato existente", async () => {
    const primeiro = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11999912347" });
    await encontrarOuCriarContact({ nome: "Nome Diferente", telefone: "11999912347" });
    const atual = await prisma.contact.findUniqueOrThrow({ where: { id: primeiro.id } });
    expect(atual.nome).toBe("Ana Souza");
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/dedupe.test.ts`
Expected: FAIL — `encontrarOuCriarContact` não existe.

- [ ] **Step 3: Implementar**

`src/core/leads/dedupe.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import type { Contact } from "@prisma/client";

export async function encontrarOuCriarContact(dados: {
  nome: string;
  telefone: string;
  email?: string;
}): Promise<Contact> {
  const existente = await prisma.contact.findUnique({ where: { telefone: dados.telefone } });
  if (existente) return existente;

  return prisma.contact.create({
    data: { nome: dados.nome, telefone: dados.telefone, email: dados.email },
  });
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/dedupe.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/core/leads/dedupe.ts tests/unit/dedupe.test.ts
git commit -m "feat: deduplicação de contato por telefone"
```

---

### Task 13: Server Actions de Lead — criação manual e movimentação de etapa

**Files:**
- Create: `src/core/auth/session.ts`
- Create: `src/core/leads/service.ts`
- Create: `src/core/leads/actions.ts`
- Create: `src/core/leads/queries.ts`
- Test: `tests/unit/stage-transition.test.ts`

**Interfaces:**
- Produces: `usuarioAtual(): Promise<User>` em `session.ts` — deriva o usuário da sessão Auth.js; lança `Error("Não autenticado")` se não houver sessão
- Produces (service, autor explícito — camada testável): `criarLead(input: { nome: string; telefone: string; email?: string; responsavelId: string; autorId: string }): Promise<Lead>`
- Produces (service): `moverEtapa(input: { leadId: string; novaStageId: string; autorId: string }): Promise<Lead>`
- Produces (action, `"use server"`, sem autor no input): `criarLeadManual(input: { nome: string; telefone: string; email?: string; responsavelId: string }): Promise<Lead>`
- Produces (action): `moverLeadDeEtapa(input: { leadId: string; novaStageId: string }): Promise<Lead>`
- Produces: `listarLeadsPorEtapa(): Promise<Record<string, LeadComRelacoes[]>>` em `queries.ts`, onde `LeadComRelacoes = Lead & { contact: Contact | null; responsavel: User | null }`
- Consumes: `encontrarOuCriarContact` (Task 12), `registrarAuditoria` (Task 8), `listarEtapas` (Task 9), `auth` (Task 5), `hasPermission` (Task 5)

**Decisão de segurança (governa todas as tasks seguintes):** Server Actions são
endpoints HTTP públicos. A identidade de quem age NUNCA vem do cliente — é sempre
derivada da sessão no servidor via `usuarioAtual()`. Nenhum componente cliente
recebe ou envia `usuarioId`/`autorId`. O `responsavelId` continua vindo do
formulário (é escolha legítima do gestor), mas a action valida a permissão de quem
chamou antes de atribuir a outro usuário.

A lógica fica em `service.ts` com `autorId` explícito — é o que os testes Vitest
exercitam, sem precisar de sessão HTTP. As actions em `actions.ts` são finas:
derivam o autor e delegam.

- [ ] **Step 1: Escrever o teste de transição de etapa**

`tests/unit/stage-transition.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { criarLead, moverEtapa } from "../../src/core/leads/service";

describe("movimentação de lead entre etapas", () => {
  let autorId: string;
  let etapaOrigemId: string;
  let etapaDestinoId: string;

  beforeAll(async () => {
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    autorId = usuario.id;
    const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
    etapaOrigemId = etapas[0].id;
    etapaDestinoId = etapas[1].id;
  });

  it("cria o lead na primeira etapa do funil", async () => {
    const lead = await criarLead({
      nome: "Teste Transição",
      telefone: "11988887001",
      responsavelId: autorId,
      autorId,
    });
    expect(lead.stageId).toBe(etapaOrigemId);
  });

  it("move o lead para a nova etapa e atualiza ultimaInteracaoEm", async () => {
    const lead = await criarLead({
      nome: "Teste Transição 2",
      telefone: "11988887002",
      responsavelId: autorId,
      autorId,
    });

    const antes = lead.ultimaInteracaoEm;
    const movido = await moverEtapa({ leadId: lead.id, novaStageId: etapaDestinoId, autorId });

    expect(movido.stageId).toBe(etapaDestinoId);
    expect(movido.ultimaInteracaoEm.getTime()).toBeGreaterThanOrEqual(antes.getTime());
  });

  it("registra um AuditLog ao mover o lead", async () => {
    const lead = await criarLead({
      nome: "Teste Transição 3",
      telefone: "11988887003",
      responsavelId: autorId,
      autorId,
    });
    await moverEtapa({ leadId: lead.id, novaStageId: etapaDestinoId, autorId });

    const registros = await prisma.auditLog.findMany({
      where: { entidade: "Lead", entidadeId: lead.id, acao: "mover_etapa" },
    });
    expect(registros.length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/stage-transition.test.ts`
Expected: FAIL — `src/core/leads/service.ts` não existe.

- [ ] **Step 3: Implementar a leitura da sessão**

`src/core/auth/session.ts`:
```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

export async function usuarioAtual(): Promise<User> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Não autenticado");
  }
  return prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
}
```

- [ ] **Step 4: Implementar o service (lógica pura, autor explícito)**

`src/core/leads/service.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import { encontrarOuCriarContact } from "./dedupe";
import { registrarAuditoria } from "@/core/audit/log";
import type { Lead } from "@prisma/client";

export async function criarLead(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
  autorId: string;
}): Promise<Lead> {
  const contact = await encontrarOuCriarContact({
    nome: input.nome,
    telefone: input.telefone,
    email: input.email,
  });

  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });

  const lead = await prisma.lead.create({
    data: {
      contactId: contact.id,
      stageId: primeiraEtapa.id,
      responsavelId: input.responsavelId,
      canal: "MANUAL",
    },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "criar_lead",
    entidade: "Lead",
    entidadeId: lead.id,
    depois: lead,
  });

  return lead;
}

export async function moverEtapa(input: {
  leadId: string;
  novaStageId: string;
  autorId: string;
}): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { stageId: input.novaStageId, ultimaInteracaoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "mover_etapa",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { stageId: antes.stageId },
    depois: { stageId: depois.stageId },
  });

  return depois;
}
```

- [ ] **Step 5: Implementar as Server Actions (finas, derivam o autor)**

`src/core/leads/actions.ts`:
```typescript
"use server";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { criarLead, moverEtapa } from "./service";
import type { Lead } from "@prisma/client";

export async function criarLeadManual(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
}): Promise<Lead> {
  const autor = await usuarioAtual();

  if (!hasPermission(autor.papel, "criar_lead")) {
    throw new Error("Sem permissão para criar lead");
  }

  // Só ADMIN e GESTOR atribuem lead a outra pessoa; VENDEDOR fica com o próprio.
  const responsavelId =
    input.responsavelId !== autor.id && !hasPermission(autor.papel, "ver_dashboard_geral")
      ? autor.id
      : input.responsavelId;

  return criarLead({
    nome: input.nome,
    telefone: input.telefone,
    email: input.email,
    responsavelId,
    autorId: autor.id,
  });
}

export async function moverLeadDeEtapa(input: {
  leadId: string;
  novaStageId: string;
}): Promise<Lead> {
  const autor = await usuarioAtual();

  if (!hasPermission(autor.papel, "mover_lead")) {
    throw new Error("Sem permissão para mover lead");
  }

  return moverEtapa({
    leadId: input.leadId,
    novaStageId: input.novaStageId,
    autorId: autor.id,
  });
}
```

- [ ] **Step 6: Implementar as leituras**

`src/core/leads/queries.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import type { Lead, Contact, User } from "@prisma/client";

export type LeadComRelacoes = Lead & {
  contact: Contact | null;
  responsavel: User | null;
};

export async function listarLeadsPorEtapa(): Promise<Record<string, LeadComRelacoes[]>> {
  const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  const leads = await prisma.lead.findMany({
    include: { contact: true, responsavel: true },
    orderBy: { criadoEm: "desc" },
  });

  const agrupado: Record<string, LeadComRelacoes[]> = {};
  for (const etapa of etapas) {
    agrupado[etapa.id] = leads.filter((lead) => lead.stageId === etapa.id);
  }
  return agrupado;
}
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/stage-transition.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 8: Commit**

```bash
git add src/core/auth/session.ts src/core/leads/service.ts src/core/leads/actions.ts src/core/leads/queries.ts tests/unit/stage-transition.test.ts
git commit -m "feat: service e server actions de lead com autor derivado da sessao"
```

---

### Task 14: Formulário de criação manual de lead

**Files:**
- Create: `src/components/leads/lead-form.tsx`
- Modify: `src/app/(painel)/leads/page.tsx` (criado nesta task)

**Interfaces:**
- Consumes: `criarLeadManual` (Task 13), componentes shadcn `form`, `input`, `button` (Task 1)

- [ ] **Step 1: Schema de validação do formulário**

Dentro de `src/components/leads/lead-form.tsx`:
```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarLeadManual } from "@/core/leads/actions";

const schema = z.object({
  nome: z.string().min(2, "Informe o nome"),
  telefone: z.string().min(10, "Telefone inválido"),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  responsavelId: z.string().min(1, "Escolha o responsável"),
});

type FormData = z.infer<typeof schema>;

export function LeadForm({
  responsavelPadraoId,
  vendedores,
}: {
  responsavelPadraoId: string;
  vendedores: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { responsavelId: responsavelPadraoId },
  });

  async function onSubmit(data: FormData) {
    // Nenhum identificador de autor é enviado: a action deriva quem age da sessão.
    await criarLeadManual({
      nome: data.nome,
      telefone: data.telefone,
      email: data.email || undefined,
      responsavelId: data.responsavelId,
    });
    reset({ responsavelId: responsavelPadraoId });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" {...register("nome")} />
        {errors.nome && <p className="text-xs text-red-600">{errors.nome.message}</p>}
      </div>
      <div>
        <Label htmlFor="telefone">Telefone</Label>
        <Input id="telefone" {...register("telefone")} />
        {errors.telefone && <p className="text-xs text-red-600">{errors.telefone.message}</p>}
      </div>
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" {...register("email")} />
      </div>
      <div>
        <Label htmlFor="responsavelId">Responsável</Label>
        <select
          id="responsavelId"
          {...register("responsavelId")}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {vendedores.map((vendedor) => (
            <option key={vendedor.id} value={vendedor.id}>
              {vendedor.nome}
            </option>
          ))}
        </select>
        {errors.responsavelId && <p className="text-xs text-red-600">{errors.responsavelId.message}</p>}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Adicionar lead"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Instalar resolver do react-hook-form**

```bash
npm install react-hook-form @hookform/resolvers
```

- [ ] **Step 3: Página de listagem (versão mínima para o formulário aparecer — a tabela completa vem na Task 16)**

`src/app/(painel)/leads/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadForm } from "@/components/leads/lead-form";
import { redirect } from "next/navigation";

export default async function LeadsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const vendedores = await prisma.user.findMany({
    where: { ativo: true },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      <LeadForm responsavelPadraoId={usuario.id} vendedores={vendedores} />
    </div>
  );
}
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm run dev`
Login, ir para `/leads`, preencher e submeter o formulário.
Expected: sem erro no console; lead criado (confirmar no Prisma Studio).

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/lead-form.tsx src/app/\(painel\)/leads/page.tsx package.json package-lock.json
git commit -m "feat: formulário de criação manual de lead"
```

---

### Task 15: Kanban do funil com dnd-kit

**Files:**
- Create: `src/app/(painel)/leads/kanban/page.tsx`
- Create: `src/components/leads/kanban-board.tsx`
- Create: `src/components/leads/kanban-card.tsx`

**Interfaces:**
- Consumes: `listarLeadsPorEtapa` (Task 13), `moverLeadDeEtapa` (Task 13), `listarEtapas` (Task 9)

- [ ] **Step 1: Instalar dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Card do kanban**

`src/components/leads/kanban-card.tsx`:
```tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";

export function KanbanCard({ id, nome, telefone }: { id: string; nome: string; telefone: string }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <Card ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab mb-2">
      <CardContent className="p-3">
        <p className="text-sm font-medium">{nome}</p>
        <p className="text-xs text-muted-foreground">{telefone}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Quadro do kanban**

`src/components/leads/kanban-board.tsx`:
```tsx
"use client";

import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { KanbanCard } from "./kanban-card";
import { moverLeadDeEtapa } from "@/core/leads/actions";
import { EmptyState } from "@/components/empty-state";

type LeadResumo = { id: string; contact: { nome: string; telefone: string } | null };
type Etapa = { id: string; nome: string; cor: string };

function Coluna({ etapa, leads }: { etapa: Etapa; leads: LeadResumo[] }) {
  const { setNodeRef } = useDroppable({ id: etapa.id });

  return (
    <div ref={setNodeRef} className="w-72 shrink-0 rounded-lg border p-3" style={{ borderTopColor: etapa.cor, borderTopWidth: 3 }}>
      <h3 className="mb-2 text-sm font-semibold">{etapa.nome} ({leads.length})</h3>
      {leads.length === 0 && <EmptyState title="Sem leads" description="Nenhum lead nesta etapa." />}
      {leads.map((lead) => (
        <KanbanCard
          key={lead.id}
          id={lead.id}
          nome={lead.contact?.nome ?? "Sem contato"}
          telefone={lead.contact?.telefone ?? "-"}
        />
      ))}
    </div>
  );
}

export function KanbanBoard({
  etapas,
  leadsPorEtapa,
}: {
  etapas: Etapa[];
  leadsPorEtapa: Record<string, LeadResumo[]>;
}) {
  const router = useRouter();

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const leadId = active.id as string;
    const novaStageId = over.id as string;
    // Nenhum identificador de autor é enviado: a action deriva quem age da sessão.
    await moverLeadDeEtapa({ leadId, novaStageId });
    router.refresh();
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto p-6">
        {etapas.map((etapa) => (
          <Coluna key={etapa.id} etapa={etapa} leads={leadsPorEtapa[etapa.id] ?? []} />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 4: Página do kanban**

`src/app/(painel)/leads/kanban/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { listarEtapas } from "@/core/pipeline/stages";
import { listarLeadsPorEtapa } from "@/core/leads/queries";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { redirect } from "next/navigation";

export default async function KanbanPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const etapas = await listarEtapas();
  const leadsPorEtapa = await listarLeadsPorEtapa();

  return <KanbanBoard etapas={etapas} leadsPorEtapa={leadsPorEtapa} />;
}
```

- [ ] **Step 5: Verificar manualmente**

Run: `npm run dev`
Ir para `/leads/kanban`, arrastar um card entre colunas.
Expected: card muda de coluna e permanece lá após o refresh da página.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(painel\)/leads/kanban src/components/leads/kanban-board.tsx src/components/leads/kanban-card.tsx package.json package-lock.json
git commit -m "feat: kanban do funil de leads com dnd-kit"
```

---

### Task 16: Listagem de leads com TanStack Table e filtros

**Files:**
- Create: `src/components/leads/lead-table.tsx`
- Modify: `src/app/(painel)/leads/page.tsx`

**Interfaces:**
- Consumes: `listarLeadsPorEtapa` (Task 13) — reaproveitado, achatado em lista única

- [ ] **Step 1: Instalar TanStack Table**

```bash
npm install @tanstack/react-table
```

- [ ] **Step 2: Componente de tabela**

`src/components/leads/lead-table.tsx`:
```tsx
"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

type LeadLinha = {
  id: string;
  contatoNome: string;
  etapaNome: string;
  responsavelNome: string;
  canal: string;
  criadoEm: string;
  criadoEmISO: string;
};

const columnHelper = createColumnHelper<LeadLinha>();

const columns = [
  columnHelper.accessor("contatoNome", {
    header: "Contato",
    cell: (info) => (
      <Link href={`/leads/${info.row.original.id}`} className="font-medium hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("etapaNome", { header: "Etapa" }),
  columnHelper.accessor("responsavelNome", { header: "Responsável" }),
  columnHelper.accessor("canal", { header: "Canal" }),
  columnHelper.accessor("criadoEm", { header: "Criado em" }),
];

export function LeadTable({
  dados,
  etapas,
  responsaveis,
}: {
  dados: LeadLinha[];
  etapas: string[];
  responsaveis: string[];
}) {
  const [filtroGlobal, setFiltroGlobal] = useState("");
  const [etapa, setEtapa] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const dadosFiltrados = dados.filter((linha) => {
    if (etapa && linha.etapaNome !== etapa) return false;
    if (responsavel && linha.responsavelNome !== responsavel) return false;
    if (de && linha.criadoEmISO < de) return false;
    if (ate && linha.criadoEmISO > ate) return false;
    return true;
  });

  const table = useReactTable({
    data: dadosFiltrados,
    columns,
    state: { globalFilter: filtroGlobal },
    onGlobalFilterChange: setFiltroGlobal,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar..."
          value={filtroGlobal}
          onChange={(e) => setFiltroGlobal(e.target.value)}
          className="max-w-xs"
        />
        <select value={etapa} onChange={(e) => setEtapa(e.target.value)} className={selectClass}>
          <option value="">Todas as etapas</option>
          {etapas.map((nome) => (
            <option key={nome} value={nome}>{nome}</option>
          ))}
        </select>
        <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className={selectClass}>
          <option value="">Todos os responsáveis</option>
          {responsaveis.map((nome) => (
            <option key={nome} value={nome}>{nome}</option>
          ))}
        </select>
        <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
        <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Atualizar a página de leads para incluir a tabela**

Modificar `src/app/(painel)/leads/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadTable } from "@/components/leads/lead-table";
import { EmptyState } from "@/components/empty-state";
import { redirect } from "next/navigation";

export default async function LeadsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });

  const leads = await prisma.lead.findMany({
    include: { contact: true, stage: true, responsavel: true },
    orderBy: { criadoEm: "desc" },
  });

  const vendedores = await prisma.user.findMany({
    where: { ativo: true },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  const linhas = leads.map((lead) => ({
    id: lead.id,
    contatoNome: lead.contact?.nome ?? "Sem contato",
    etapaNome: lead.stage.nome,
    responsavelNome: lead.responsavel?.nome ?? "Não atribuído",
    canal: lead.canal,
    criadoEm: lead.criadoEm.toLocaleDateString("pt-BR"),
    criadoEmISO: lead.criadoEm.toISOString().slice(0, 10),
  }));

  const etapasUnicas = [...new Set(linhas.map((l) => l.etapaNome))];
  const responsaveisUnicos = [...new Set(linhas.map((l) => l.responsavelNome))];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      <LeadForm responsavelPadraoId={usuario.id} vendedores={vendedores} />
      {linhas.length === 0 ? (
        <EmptyState title="Nenhum lead ainda" description="Use o formulário acima para adicionar o primeiro." />
      ) : (
        <LeadTable dados={linhas} etapas={etapasUnicas} responsaveis={responsaveisUnicos} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm run dev`
Ir para `/leads`. Confirmar que a tabela lista os leads do seed e que o campo de busca filtra por qualquer coluna.

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/lead-table.tsx src/app/\(painel\)/leads/page.tsx package.json package-lock.json
git commit -m "feat: listagem de leads com TanStack Table e filtro"
```

---

### Task 17: Notas do lead (LeadNote) e detalhe do lead

**Files:**
- Create: `src/app/(painel)/leads/[id]/page.tsx`
- Create: `src/core/leads/notes.ts`
- Test: `tests/unit/lead-notes.test.ts`

**Interfaces:**
- Produces: `adicionarNota(input: { leadId: string; autorId: string; texto: string }): Promise<LeadNote>`
- Produces: `listarNotas(leadId: string): Promise<LeadNote[]>`

- [ ] **Step 1: Escrever o teste**

`tests/unit/lead-notes.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { adicionarNota, listarNotas } from "../../src/core/leads/notes";
import { criarLead } from "../../src/core/leads/service";

describe("notas de lead", () => {
  let usuarioId: string;
  let leadId: string;

  beforeAll(async () => {
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    usuarioId = usuario.id;
    const lead = await criarLead({
      nome: "Teste Notas",
      telefone: "11988887100",
      responsavelId: usuarioId,
      autorId: usuarioId,
    });
    leadId = lead.id;
  });

  it("adiciona uma nota ao lead", async () => {
    const nota = await adicionarNota({ leadId, autorId: usuarioId, texto: "Cliente ligou de volta" });
    expect(nota.texto).toBe("Cliente ligou de volta");
  });

  it("lista as notas em ordem cronológica reversa", async () => {
    await adicionarNota({ leadId, autorId: usuarioId, texto: "Primeira" });
    await adicionarNota({ leadId, autorId: usuarioId, texto: "Segunda" });
    const notas = await listarNotas(leadId);
    expect(notas[0].texto).toBe("Segunda");
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/lead-notes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`src/core/leads/notes.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import type { LeadNote } from "@prisma/client";

export async function adicionarNota(input: {
  leadId: string;
  autorId: string;
  texto: string;
}): Promise<LeadNote> {
  return prisma.leadNote.create({
    data: { leadId: input.leadId, autorId: input.autorId, texto: input.texto },
  });
}

export async function listarNotas(leadId: string): Promise<LeadNote[]> {
  return prisma.leadNote.findMany({
    where: { leadId },
    orderBy: { criadoEm: "desc" },
  });
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/lead-notes.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Página de detalhe do lead**

`src/app/(painel)/leads/[id]/page.tsx`:
```tsx
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { usuarioAtual } from "@/core/auth/session";
import { listarNotas, adicionarNota } from "@/core/leads/notes";
import { redirect } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export default async function LeadDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id },
    include: { contact: true, stage: true, responsavel: true },
  });
  const notas = await listarNotas(id);

  async function salvarNota(formData: FormData) {
    "use server";
    const texto = formData.get("texto") as string;
    if (!texto?.trim()) return;
    // Autor derivado da sessão dentro da action, não capturado do escopo do componente.
    const autor = await usuarioAtual();
    await adicionarNota({ leadId: id, autorId: autor.id, texto });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{lead.contact?.nome ?? "Sem contato"}</h1>
        <p className="text-sm text-muted-foreground">
          {lead.stage.nome} · {lead.responsavel?.nome ?? "Não atribuído"}
        </p>
      </div>

      <form action={salvarNota} className="space-y-2">
        <Textarea name="texto" placeholder="Adicionar nota..." required />
        <Button type="submit">Salvar nota</Button>
      </form>

      <div className="space-y-2">
        {notas.length === 0 ? (
          <EmptyState title="Sem notas" description="Nenhuma nota registrada para este lead." />
        ) : (
          notas.map((nota) => (
            <div key={nota.id} className="rounded border p-3 text-sm">
              <p>{nota.texto}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {nota.criadoEm.toLocaleString("pt-BR")}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verificar manualmente**

Run: `npm run dev`
Ir para `/leads` e clicar no nome de um contato na tabela — a coluna "Contato" já é um link para `/leads/[id]` (implementado na Task 16).
Expected: página de detalhe carrega, adicionar nota funciona e a nota aparece na lista abaixo do formulário.

- [ ] **Step 7: Commit**

```bash
git add src/core/leads/notes.ts src/app/\(painel\)/leads/\[id\] tests/unit/lead-notes.test.ts
git commit -m "feat: notas de lead e página de detalhe"
```

---

### Task 18: Tarefas (Task) — criação, vencimento, conclusão

**Files:**
- Create: `src/core/tasks/service.ts`
- Create: `src/core/tasks/actions.ts`
- Create: `src/core/tasks/queries.ts`
- Create: `src/app/(painel)/tasks/page.tsx`
- Create: `src/components/tasks/task-form.tsx`
- Create: `src/components/tasks/task-list.tsx`
- Test: `tests/unit/tasks.test.ts`

**Interfaces:**
- Produces (service, testável): `criarTask(input: { titulo: string; descricao?: string; vencimento: Date; responsavelId: string; leadId?: string }): Promise<Task>`
- Produces (service): `concluirTask(input: { taskId: string; autorId: string }): Promise<Task>` — lança `Error("Tarefa não encontrada")` se a tarefa não pertence ao autor
- Produces (service): `listarTasksPendentes(responsavelId?: string): Promise<Task[]>`
- Produces (action, `"use server"`): `criarMinhaTask(input: { titulo: string; descricao?: string; vencimento: Date; leadId?: string }): Promise<Task>` — responsável é sempre quem chamou
- Produces (action): `concluirMinhaTask(taskId: string): Promise<Task>`
- Consumes: `usuarioAtual` (Task 13)

Mesma decisão de segurança da Task 13: a action deriva o usuário da sessão. Na
Fase 1 a tarefa é sempre do próprio usuário — atribuir tarefa a outra pessoa é
funcionalidade de fase posterior, não um campo escondido do formulário. E concluir
tarefa exige ser dono dela: sem essa checagem, qualquer usuário autenticado
encerraria a tarefa de qualquer colega chamando a action com um id arbitrário.

- [ ] **Step 1: Escrever o teste**

`tests/unit/tasks.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { criarTask, concluirTask, listarTasksPendentes } from "../../src/core/tasks/service";

describe("tarefas", () => {
  let usuarioId: string;

  beforeAll(async () => {
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    usuarioId = usuario.id;
  });

  it("cria uma tarefa sem lead vinculado", async () => {
    const task = await criarTask({
      titulo: "Ligar para fornecedor",
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    expect(task.titulo).toBe("Ligar para fornecedor");
    expect(task.leadId).toBeNull();
  });

  it("marca uma tarefa como concluída", async () => {
    const task = await criarTask({
      titulo: "Enviar proposta",
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    const concluida = await concluirTask({ taskId: task.id, autorId: usuarioId });
    expect(concluida.concluidaEm).not.toBeNull();
  });

  it("lista apenas tarefas pendentes de um responsável", async () => {
    const pendente = await criarTask({
      titulo: "Tarefa pendente",
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    const concluida = await criarTask({
      titulo: "Tarefa que será concluída",
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    await concluirTask({ taskId: concluida.id, autorId: usuarioId });

    const pendentes = await listarTasksPendentes(usuarioId);
    const ids = pendentes.map((t) => t.id);
    expect(ids).toContain(pendente.id);
    expect(ids).not.toContain(concluida.id);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/tasks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `service.ts`**

`src/core/tasks/service.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import type { Task } from "@prisma/client";

export async function criarTask(input: {
  titulo: string;
  descricao?: string;
  vencimento: Date;
  responsavelId: string;
  leadId?: string;
}): Promise<Task> {
  return prisma.task.create({
    data: {
      titulo: input.titulo,
      descricao: input.descricao,
      vencimento: input.vencimento,
      responsavelId: input.responsavelId,
      leadId: input.leadId,
    },
  });
}

export async function concluirTask(input: { taskId: string; autorId: string }): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  return prisma.task.update({
    where: { id: input.taskId },
    data: { concluidaEm: new Date() },
  });
}

export async function listarTasksPendentes(responsavelId?: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      concluidaEm: null,
      ...(responsavelId ? { responsavelId } : {}),
    },
    orderBy: { vencimento: "asc" },
  });
}
```

- [ ] **Step 3b: Implementar `actions.ts` (finas, derivam o usuário)**

`src/core/tasks/actions.ts`:
```typescript
"use server";

import { usuarioAtual } from "@/core/auth/session";
import { criarTask, concluirTask } from "./service";
import type { Task } from "@prisma/client";

export async function criarMinhaTask(input: {
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string;
}): Promise<Task> {
  const autor = await usuarioAtual();
  return criarTask({ ...input, responsavelId: autor.id });
}

export async function concluirMinhaTask(taskId: string): Promise<Task> {
  const autor = await usuarioAtual();
  return concluirTask({ taskId, autorId: autor.id });
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/unit/tasks.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: `queries.ts` (leitura com lead vinculado, para a UI)**

`src/core/tasks/queries.ts`:
```typescript
import { prisma } from "@/lib/prisma";

export async function listarTasksComLead(responsavelId: string) {
  return prisma.task.findMany({
    where: { responsavelId, concluidaEm: null },
    include: { lead: { include: { contact: true } } },
    orderBy: { vencimento: "asc" },
  });
}
```

- [ ] **Step 6: Formulário e lista de tarefas**

`src/components/tasks/task-form.tsx`:
```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarMinhaTask } from "@/core/tasks/actions";

const schema = z.object({
  titulo: z.string().min(2, "Informe o título"),
  vencimento: z.string().min(1, "Informe a data"),
});

type FormData = z.infer<typeof schema>;

export function TaskForm() {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    // Responsavel e derivado da sessao dentro da action.
    await criarMinhaTask({ titulo: data.titulo, vencimento: new Date(data.vencimento) });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex gap-2">
      <div>
        <Label htmlFor="titulo">Título</Label>
        <Input id="titulo" {...register("titulo")} />
        {errors.titulo && <p className="text-xs text-red-600">{errors.titulo.message}</p>}
      </div>
      <div>
        <Label htmlFor="vencimento">Vencimento</Label>
        <Input id="vencimento" type="date" {...register("vencimento")} />
        {errors.vencimento && <p className="text-xs text-red-600">{errors.vencimento.message}</p>}
      </div>
      <Button type="submit" disabled={isSubmitting} className="self-end">
        {isSubmitting ? "Salvando..." : "Adicionar tarefa"}
      </Button>
    </form>
  );
}
```

`src/components/tasks/task-list.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { concluirMinhaTask } from "@/core/tasks/actions";
import { EmptyState } from "@/components/empty-state";

type TaskLinha = { id: string; titulo: string; vencimento: Date; leadContatoNome?: string };

export function TaskList({ tasks }: { tasks: TaskLinha[] }) {
  const router = useRouter();

  async function handleConcluir(id: string) {
    await concluirMinhaTask(id);
    router.refresh();
  }

  if (tasks.length === 0) {
    return <EmptyState title="Nenhuma tarefa pendente" description="Você está em dia." />;
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center justify-between rounded border p-3">
          <div>
            <p className="text-sm font-medium">{task.titulo}</p>
            <p className="text-xs text-muted-foreground">
              Vence em {task.vencimento.toLocaleDateString("pt-BR")}
              {task.leadContatoNome ? ` · ${task.leadContatoNome}` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => handleConcluir(task.id)}>
            Concluir
          </Button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Página de tarefas**

`src/app/(painel)/tasks/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarTasksComLead } from "@/core/tasks/queries";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { redirect } from "next/navigation";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const tasks = await listarTasksComLead(usuario.id);

  const linhas = tasks.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    vencimento: t.vencimento,
    leadContatoNome: t.lead?.contact?.nome,
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Tarefas</h1>
      <TaskForm />
      <TaskList tasks={linhas} />
    </div>
  );
}
```

- [ ] **Step 8: Verificar manualmente**

Run: `npm run dev`
Ir para `/tasks`, criar uma tarefa, concluir.
Expected: tarefa some da lista após concluída.

- [ ] **Step 9: Commit**

```bash
git add src/core/tasks src/app/\(painel\)/tasks src/components/tasks tests/unit/tasks.test.ts
git commit -m "feat: tarefas com criação, conclusão e listagem"
```

---

### Task 19: Notificações — central in-app e disparo de e-mail

**Files:**
- Create: `src/core/notifications/dispatch.ts`
- Create: `src/core/notifications/email.tsx`
- Create: `src/components/notifications/notification-bell.tsx`
- Modify: `src/core/leads/actions.ts` (dispara notificação ao criar lead)
- Test: `tests/unit/notifications.test.ts`

**Interfaces:**
- Produces: `notificarNovoLead(leadId: string): Promise<void>`
- Produces: `listarNotificacoesNaoLidas(userId: string): Promise<Notification[]>`
- Produces: `marcarComoLida(notificationId: string): Promise<void>`

- [ ] **Step 1: Instalar Resend e React Email**

```bash
npm install resend @react-email/components
```

- [ ] **Step 2: Escrever o teste**

`tests/unit/notifications.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { notificarNovoLead, listarNotificacoesNaoLidas, marcarComoLida } from "../../src/core/notifications/dispatch";
import { criarLead } from "../../src/core/leads/service";

describe("notificações", () => {
  let usuarioId: string;
  let leadId: string;

  beforeAll(async () => {
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    usuarioId = usuario.id;
    const lead = await criarLead({
      nome: "Teste Notificação",
      telefone: "11988887200",
      responsavelId: usuarioId,
      autorId: usuarioId,
    });
    leadId = lead.id;
  });

  it("cria uma notificação in-app ao notificar novo lead", async () => {
    await notificarNovoLead(leadId);
    const naoLidas = await listarNotificacoesNaoLidas(usuarioId);
    expect(naoLidas.some((n) => n.payload && (n.payload as { leadId?: string }).leadId === leadId)).toBe(true);
  });

  it("marca notificação como lida e ela some da lista de não lidas", async () => {
    await notificarNovoLead(leadId);
    const naoLidas = await listarNotificacoesNaoLidas(usuarioId);
    const notificacao = naoLidas[0];
    await marcarComoLida(notificacao.id);
    const atualizadas = await listarNotificacoesNaoLidas(usuarioId);
    expect(atualizadas.find((n) => n.id === notificacao.id)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/notifications.test.ts`
Expected: FAIL

- [ ] **Step 4: Template de e-mail**

`src/core/notifications/email.tsx`:
```tsx
import { Html, Body, Container, Text, Heading } from "@react-email/components";

export function NovoLeadEmail({ contatoNome, etapaNome }: { contatoNome: string; etapaNome: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Novo lead recebido</Heading>
          <Text>
            {contatoNome} entrou no funil na etapa &quot;{etapaNome}&quot;.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Implementar dispatch**

`src/core/notifications/dispatch.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import { NovoLeadEmail } from "./email";
import type { Notification } from "@prisma/client";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function notificarNovoLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { contact: true, stage: true, responsavel: true },
  });

  if (!lead.responsavel) return;

  await prisma.notification.create({
    data: {
      userId: lead.responsavel.id,
      tipo: "NOVO_LEAD",
      payload: { leadId: lead.id, contatoNome: lead.contact?.nome ?? "Sem contato" },
    },
  });

  if (resend) {
    try {
      await resend.emails.send({
        from: "CRM <notificacoes@exemplo.com>",
        to: lead.responsavel.email,
        subject: "Novo lead recebido",
        react: NovoLeadEmail({
          contatoNome: lead.contact?.nome ?? "Sem contato",
          etapaNome: lead.stage.nome,
        }),
      });
    } catch (erro) {
      console.error("Falha ao enviar e-mail de notificação:", erro);
    }
  }
}

export async function listarNotificacoesNaoLidas(userId: string): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId, lidaEm: null },
    orderBy: { criadoEm: "desc" },
  });
}

export async function marcarComoLida(notificationId: string): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { lidaEm: new Date() },
  });
}
```

Nota: o envio de e-mail é feito depois de a notificação in-app já estar salva, e uma falha no Resend é capturada e logada — não interrompe o fluxo, conforme spec seção 6 ("falha de módulo secundário nunca derruba o principal").

- [ ] **Step 6: Rodar e confirmar sucesso**

`RESEND_API_KEY` fica de fora do `.env` de teste — sem ela, `resend` é `null` e o teste cobre apenas a notificação in-app, que é o que os asserts checam.
Run: `npx vitest run tests/unit/notifications.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 7: Conectar ao fluxo de criação de lead**

Modificar `src/core/leads/service.ts`: adicionar o import no topo do arquivo
(import estático normal — não há ciclo, porque `dispatch.ts` não importa
`service.ts`):
```typescript
import { notificarNovoLead } from "@/core/notifications/dispatch";
```

E, dentro de `criarLead`, chamar a notificação depois de gravar a auditoria e
antes do `return lead;`:
```typescript
  await notificarNovoLead(lead.id);
```

A notificação vem por último de propósito: o lead e a auditoria já estão
persistidos quando ela roda. Conforme a spec seção 6, falha de notificação não
pode derrubar a criação do lead — o `try/catch` interno de `notificarNovoLead`
(Step 5) já garante isso para o e-mail.

- [ ] **Step 8: Sino de notificações**

`src/components/notifications/notification-bell.tsx`:
```tsx
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { listarNotificacoesNaoLidas } from "@/core/notifications/dispatch";

export async function NotificationBell() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const naoLidas = await listarNotificacoesNaoLidas(usuario.id);

  return (
    <div className="relative">
      <span className="text-sm">🔔</span>
      {naoLidas.length > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">
          {naoLidas.length}
        </span>
      )}
    </div>
  );
}
```

Adicionar `<NotificationBell />` dentro de `PainelNav` (`src/components/painel-nav.tsx`), como item final da navegação.

- [ ] **Step 9: Adicionar `RESEND_API_KEY` ao `.env.example`**

```
RESEND_API_KEY=""
```

- [ ] **Step 10: Verificar manualmente e rodar toda a suíte**

Run: `npm run dev` — criar um lead em `/leads`, confirmar que o sininho mostra contagem.
Run: `npm run test` — Expected: todos os testes unitários PASS.

- [ ] **Step 11: Commit**

```bash
git add src/core/notifications src/components/notifications src/components/painel-nav.tsx src/core/leads/service.ts tests/unit/notifications.test.ts .env.example package.json package-lock.json
git commit -m "feat: notificações in-app e por e-mail ao criar lead"
```

---

### Task 20: Dashboard — funil, conversão, tarefas, atividade recente

**Files:**
- Create: `src/app/(painel)/page.tsx`
- Create: `src/components/dashboard/stage-summary.tsx`
- Create: `src/components/dashboard/conversion-chart.tsx`

**Interfaces:**
- Consumes: `listarLeadsPorEtapa` (Task 13), `listarTasksPendentes` (Task 18), `prisma.auditLog` (Task 8)

- [ ] **Step 1: Instalar Recharts**

```bash
npm install recharts
```

- [ ] **Step 2: Resumo por etapa**

`src/components/dashboard/stage-summary.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StageSummary({ etapas }: { etapas: { nome: string; total: number; cor: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {etapas.map((etapa) => (
        <Card key={etapa.nome}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: etapa.cor }}>
              {etapa.nome}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{etapa.total}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Gráfico de conversão**

`src/components/dashboard/conversion-chart.tsx`:
```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

export function ConversionChart({ dados }: { dados: { nome: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={dados}>
        <XAxis dataKey="nome" fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} />
        <Tooltip />
        <Bar dataKey="total" fill="#0F62FE" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Página do dashboard**

`src/app/(painel)/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarEtapas } from "@/core/pipeline/stages";
import { listarLeadsPorEtapa } from "@/core/leads/queries";
import { listarTasksPendentes } from "@/core/tasks/service";
import { StageSummary } from "@/components/dashboard/stage-summary";
import { ConversionChart } from "@/components/dashboard/conversion-chart";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const etapas = await listarEtapas();
  const leadsPorEtapa = await listarLeadsPorEtapa();
  const tasksPendentes = await listarTasksPendentes(usuario.id);

  const resumo = etapas.map((etapa) => ({
    nome: etapa.nome,
    total: (leadsPorEtapa[etapa.id] ?? []).length,
    cor: etapa.cor,
  }));

  const totalLeads = resumo.reduce((soma, e) => soma + e.total, 0);
  const etapaGanho = etapas.find((e) => e.ehGanho);
  const totalGanhos = etapaGanho ? (leadsPorEtapa[etapaGanho.id] ?? []).length : 0;
  const taxaConversao = totalLeads > 0 ? ((totalGanhos / totalLeads) * 100).toFixed(1) : "0.0";

  const atividadeRecente = await prisma.auditLog.findMany({
    take: 10,
    orderBy: { criadoEm: "desc" },
    include: { user: true },
  });

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <StageSummary etapas={resumo} />

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Leads por etapa</h2>
          <ConversionChart dados={resumo} />
        </div>
        <div className="space-y-4">
          <div className="rounded border p-4">
            <p className="text-sm text-muted-foreground">Taxa de conversão</p>
            <p className="text-2xl font-bold">{taxaConversao}%</p>
          </div>
          <div className="rounded border p-4">
            <p className="text-sm text-muted-foreground">Tarefas pendentes (suas)</p>
            <p className="text-2xl font-bold">{tasksPendentes.length}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Atividade recente</h2>
        <ul className="space-y-1 text-sm">
          {atividadeRecente.map((log) => (
            <li key={log.id} className="text-muted-foreground">
              {log.user.nome} — {log.acao} — {log.entidade} — {log.criadoEm.toLocaleString("pt-BR")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verificar manualmente**

Run: `npm run dev`
Ir para `/`. Confirmar cartões por etapa, gráfico, taxa de conversão e lista de atividade recente.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(painel\)/page.tsx src/components/dashboard package.json package-lock.json
git commit -m "feat: dashboard com funil, conversão e atividade recente"
```

---

### Task 21: Exportação de leads em CSV

**Files:**
- Create: `src/app/(painel)/export/leads/route.ts`

**Interfaces:**
- Consumes: `hasPermission` (Task 5), `prisma`

- [ ] **Step 1: Implementar a rota**

`src/app/(painel)/export/leads/route.ts`:
```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/core/auth/permissions";
import type { Role } from "@prisma/client";
import { NextResponse } from "next/server";

function escaparCsv(valor: string): string {
  if (valor.includes(",") || valor.includes('"') || valor.includes("\n")) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  if (!hasPermission(usuario.papel as Role, "exportar_leads")) {
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  }

  const leads = await prisma.lead.findMany({
    include: { contact: true, stage: true, responsavel: true },
    orderBy: { criadoEm: "desc" },
  });

  const cabecalho = ["Contato", "Telefone", "Etapa", "Responsável", "Canal", "Criado em"];
  const linhas = leads.map((lead) =>
    [
      lead.contact?.nome ?? "",
      lead.contact?.telefone ?? "",
      lead.stage.nome,
      lead.responsavel?.nome ?? "",
      lead.canal,
      lead.criadoEm.toISOString(),
    ]
      .map(escaparCsv)
      .join(",")
  );

  const csv = [cabecalho.join(","), ...linhas].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=leads.csv",
    },
  });
}
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm run dev`
Logado como `admin@exemplo.com`, acessar `http://localhost:3000/export/leads`.
Expected: download de `leads.csv` com os dados do seed.

Logado como `vendedor@exemplo.com` (sem permissão `exportar_leads`), acessar a mesma rota.
Expected: resposta 403.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(painel\)/export
git commit -m "feat: exportação de leads em CSV com verificação de permissão"
```

---

### Task 22: Teste E2E — do lead manual ao funil ganho

**Files:**
- Create: `tests/e2e/lead-to-won.spec.ts`

**Interfaces:**
- Consumes: toda a Fase 1 através da UI real (login, `/leads`, `/leads/kanban`)

- [ ] **Step 1: Escrever o teste E2E**

`tests/e2e/lead-to-won.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("cria um lead manualmente e move até a etapa final do funil", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@exemplo.com");
  await page.getByLabel("Senha").fill("senha123");
  await page.getByRole("button", { name: "Entrar" }).click();

  await page.waitForURL("/");

  await page.goto("/leads");
  await page.getByLabel("Nome").fill("Cliente E2E");
  await page.getByLabel("Telefone").fill("11977778888");
  await page.getByRole("button", { name: "Adicionar lead" }).click();

  await expect(page.getByText("Cliente E2E")).toBeVisible();

  await page.goto("/leads/kanban");
  const card = page.getByText("Cliente E2E");
  await expect(card).toBeVisible();

  const colunaFinal = page.locator("div").filter({ hasText: "Fechado" }).last();
  await card.dragTo(colunaFinal);

  await page.reload();
  await expect(colunaFinal.getByText("Cliente E2E")).toBeVisible();
});
```

- [ ] **Step 2: Rodar o teste**

Garantir que o banco de teste tem o seed aplicado (`npx prisma db seed`) e que `.env` aponta para um banco onde `admin@exemplo.com` / `senha123` existe.
Run: `npm run test:e2e -- tests/e2e/lead-to-won.spec.ts`

Use o script `test:e2e`, nunca `npx playwright test` direto: o script roda antes um
guard que aborta se a porta 3000 ja estiver ocupada. Sem ele, o Playwright reusa o
servidor existente, pula o build e roda a suite contra codigo obsoleto em silencio.
Expected: PASS

Se o drag-and-drop do dnd-kit não for capturado pelo `dragTo` padrão do Playwright (comum com bibliotecas de drag customizadas), substituir por sequência manual de mouse:
```typescript
const cardBox = await card.boundingBox();
const colunaBox = await colunaFinal.boundingBox();
if (cardBox && colunaBox) {
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(colunaBox.x + colunaBox.width / 2, colunaBox.y + colunaBox.height / 2, { steps: 10 });
  await page.mouse.up();
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/lead-to-won.spec.ts
git commit -m "test: fluxo e2e de criação e conversão de lead"
```

---

### Task 23: Verificação final da Fase 0 + Fase 1

**Files:** nenhum arquivo novo — apenas verificação.

- [ ] **Step 1: Rodar toda a suíte unitária**

Run: `npm run test`
Expected: todos os testes das Tasks 3, 5, 7, 8, 10A, 12, 13, 17, 18, 19 PASS.

- [ ] **Step 2: Rodar o teste E2E**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Rodar o lint completo**

Run: `npm run lint`
Expected: sem erros, incluindo a regra de fronteira core/modules (Task 4).

- [ ] **Step 4: Rodar o build de produção**

Run: `npm run build`
Expected: build conclui sem erro de tipo ou de rota.

- [ ] **Step 5: Checklist manual contra a spec**

Percorrer a spec (`docs/superpowers/specs/2026-07-28-crm-base-design.md`) seção 9 — "Escopo detalhado da Fase 0" e "Escopo detalhado da Fase 1" — e confirmar item a item que cada entrega listada tem uma task correspondente neste plano.

- [ ] **Step 6: Commit final se houver ajustes pendentes**

```bash
git add -A
git commit -m "chore: fecha Fase 0 + Fase 1 do CRM base"
```

---

## Pendências que ficam fora deste plano

- **Fase 2 em diante** (catálogo, site público, analytics, Cloudflare, campanhas pagas, financeiro) — cada uma recebe seu próprio ciclo spec → plano.
- **Sentry**: removido da Task 11 — o wizard é interativo e falha com `ERR_TTY_INIT_FAILED` em execução automatizada (verificado), e ainda não há conta Sentry. O projeto sobe sem monitoramento de erro. Para fechar essa lacuna, rode o wizard num terminal interativo antes de colocar um cliente real em produção.
- **Deploy na Vercel**: este plano cobre apenas o código; conectar o repositório à Vercel e configurar variáveis de ambiente de produção é uma ação manual fora do escopo de tasks de código.
