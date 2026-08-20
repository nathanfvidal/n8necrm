# Receita de módulo

Como acrescentar funcionalidade que **alguns** clientes têm, sem tocar no núcleo.

Escrita a partir do que o módulo `whatsapp` fez de fato — não de intenção. Ele é o
único módulo construído até hoje, então tudo aqui tem um exemplo real para conferir.
Contexto do modelo: `docs/superpowers/specs/2026-08-07-nucleo-e-modulos-sob-demanda.md`.

## A regra que sustenta tudo

**`modules/` pode importar de `core/`. `core/` nunca importa de `modules/`.**

Não é convenção: `eslint.config.mjs` quebra o build com `no-restricted-imports` em
nível de erro para qualquer arquivo em `src/core/**` que importe de `@/modules` (ou de
`../../modules`, porque o padrão é deliberadamente amplo).

É essa regra que faz "desligar o módulo" ser uma operação real em vez de esconder
botão com CSS. Se você se pegar querendo furá-la, o que você quer não é um módulo — é
uma mudança no núcleo, e ela vale para todos os forks.

Um caso já aconteceu: as Server Actions do WhatsApp nasceram em `src/core/whatsapp/` e
tiveram de ser movidas para `src/modules/whatsapp/` no meio da Fatia 2, porque
importavam do módulo. O lint pegou. Rode `npm run lint` cedo, não só no fim.

## Os passos

### 1. Nomear no schema do fork

`config/client.schema.ts`, no enum de `modulos`:

```ts
modulos: z.array(z.enum(["catalog", "analytics", "automation", "campaigns", "finance", "whatsapp"])),
```

`ModuloNome` (em `src/core/config/schema.ts`, reexportado por
`src/core/config/modulos.ts`) é **derivado** desse enum, não uma segunda lista —
acrescentar aqui já propaga o tipo para todo o resto.

Ligar o módulo é **por empresa**, desde o Ciclo 1c: a coluna `modulos` de
`CompanyConfig`. `config/client.ts` continua existindo como PADRÃO para a
empresa que ainda não tem linha (ver `mesclarConfig` em
`src/core/config/schema.ts`):

```ts
modulos: ["whatsapp"],
```

Empresa com linha de `CompanyConfig` manda, inclusive com a lista vazia —
"não decidi" é empresa **sem linha**, não linha com `[]`.

### 2. Criar a pasta

`src/modules/<nome>/`. Tudo que só existe por causa do módulo mora aqui: consultas,
serviços, Server Actions, tipos, integrações externas.

O que **não** mora aqui: componentes de tela. Eles ficam em `src/components/`, que pode
importar de `modules` livremente — só `core` é que não pode.

### 3. Modelos no Prisma, se houver

No mesmo `prisma/schema.prisma` do núcleo (não há schema por módulo).

**Toda tabela nova precisa de RLS e REVOKE escritos à mão na migração.** O Prisma não
emite nenhum dos dois. Sem isso, a tabela nasce alcançável pela chave anônima do
Supabase:

```sql
ALTER TABLE "MinhaTabela" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MinhaTabela" FROM anon, authenticated;
```

Exemplo real:
`prisma/migrations/20260806155117_whatsapp_fatia_2_bot_config/migration.sql`. Confira
depois com `SELECT relrowsecurity FROM pg_class WHERE relname = 'MinhaTabela'` —
`prisma db execute` **não imprime resultado de SELECT**, então não serve de prova.

Migração exige `DIRECT_URL` no `.env` (pooler de sessão, porta 5432). Sem ela o
comando trava por minutos em vez de falhar.

### 4. Permissão, se a ação for restrita

Só se o módulo tiver operação que nem todo papel pode fazer. Em
`src/core/auth/permissions.ts`, acrescente ao union `Acao` e às listas por papel — o
`whatsapp` fez isso com `configurar_agente` (só ADMIN edita a persona do bot).

Note que é um arquivo do **núcleo** listando uma ação do módulo. É a direção
permitida: `core` não importa código de `modules`, mas pode nomear uma string.

Atender conversa, por outro lado, não virou permissão: o projeto já decidiu que todos
os papéis atendem todos os leads. Não crie permissão por simetria.

### 5. Rotas, com o portão no topo

`src/app/(painel)/<nome>/page.tsx`, e **`await exigirModulo(usuario.companyId,
"<nome>")` logo depois de resolver a sessão, em cada page** — não só na de
entrada:

```ts
import { exigirModulo } from "@/core/config/modulos";

export default async function MinhaPagina() {
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "whatsapp");
  // ...
}
```

Depois da sessão, e não antes: o portão pergunta de qual EMPRESA é a pergunta, e
o `companyId` vem de `UsuarioAtivo` (`src/core/auth/usuario-ativo.ts`) — nunca de
`prisma.company.findFirst()`. Efeito colateral desejado: visitante sem sessão é
mandado para `/login` em vez de receber 404, e deixa de conseguir observar quais
módulos a empresa tem pela diferença entre as duas respostas.

`exigirModulo` chama `notFound()`. Numa empresa com o módulo desligado, digitar a
URL dá 404 de verdade. Esquecer numa página aninhada é o furo clássico: o menu
não mostra, mas a rota responde.

Cuidado do Next 16: segmento estático resolve antes de dinâmico, então
`/conversas/agente` e `/conversas/[id]` convivem — mas as duas precisam do portão.

### 6. Link no menu

`src/components/painel-nav.tsx`, em `grupoExtra`:

```tsx
...(modulosAtivos.includes("whatsapp")
  ? [{ href: "/conversas", label: "Conversas", icone: "conversas" as const }]
  : []),
```

`PainelNav` é **síncrona e sem banco** de propósito: `modulosAtivos` chega por
prop obrigatória, resolvida em `src/app/(painel)/layout.tsx` com
`configDaEmpresa(usuario.companyId)`. Não transforme a barra em `async` para ler
o módulo aqui dentro — isso a tornaria impossível de renderizar em teste sem
mock de Postgres.

**Só acrescente o link quando a rota existir** — links para rota inexistente
davam 404 e prometiam funcionalidade que ninguém tinha construído (foi o caso de
`/catalogo` e `/analytics`, removidos em 2026-08-07).

### 7. Server Actions devolvem resultado, não lançam

Use `ResultadoAcao` de `src/lib/acao.ts`:

```ts
export async function minhaAction(id: string): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();   // DENTRO do try, sempre
    await fazerCoisa(id, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao fazer a coisa. Tente novamente.");
  }
  revalidatePath("/minha-rota");
  return { ok: true };
}
```

Três coisas que já custaram rodada de revisão neste projeto:

- **O Next redige erro não tratado em produção.** Uma action que deixa o erro subir
  entrega "entrada inválida", "sem permissão" e "banco fora do ar" como a mesma
  mensagem opaca.
- **`usuarioAtual()` vai dentro do `try`.** Fora dele, a sessão expirada rejeita sem
  produzir `ResultadoAcao`, e a tela não mostra nada — nem sucesso nem erro. Um
  atendente com a aba aberta há horas clica e não acontece nada.
- **Server Action é endpoint HTTP público.** Quem está agindo vem de `usuarioAtual()`,
  nunca de um campo de formulário.

### 8. Concorrência: UPDATE condicional, não consulta-e-grava

Se o módulo tem estado que dois processos podem tentar mudar ao mesmo tempo, decida no
banco:

```ts
const { count } = await prisma.recurso.updateMany({
  where: { id, campo: null },      // a condição faz parte do UPDATE
  data: { campo: new Date() },
});
if (count === 0) return;            // outro ganhou
```

`claimLease`, `pausarIa`, `checarRateLimit` e `marcarAguardandoHumano` usam todos esse
idioma. Ler antes de escrever abre janela entre as duas operações, e o sintoma aparece
em produção como aviso duplicado ou resposta duplicada.

### 9. Testes

Contra o banco real, como o resto do projeto. O que vale testar é comportamento, não
fiação:

- O caminho que o módulo existe para resolver.
- A concorrência, se houver — dois processos disputando, e só um ganha.
- O gate: com o módulo desligado, a rota some.

**Sabote cada teste novo e confirme que ele fica vermelho** antes de aceitá-lo. Quatro
testes que "passavam" sem exercitar nada foram pegos assim nas fatias do WhatsApp — um
deles passava justamente porque o popover estava fechado.

**Mas cuidado com o que a sabotagem libera.** Quando o teste prova que uma guarda
RECUSA algo, desligar a guarda faz a operação acontecer de verdade — e o banco é
compartilhado com dado real. Aconteceu ao testar a proteção das contas de sistema:
desligar `recusarContaDeSistema` fez o teste renomear o usuário do WhatsApp no Postgres
de produção. Antes de sabotar uma guarda, pergunte o que a operação faz quando passa, e
prefira sabotar contra dado que o próprio teste criou. Se não der, tenha o comando de
reparo pronto antes de rodar.

Armadilhas do ambiente, todas com custo de diagnóstico já pago:

- `import "server-only"` sempre lança sob Vitest. Teste que toca esses módulos precisa
  de `vi.mock("server-only", () => ({}))` e `import "dotenv/config"`.
- `beforeAll`/`afterAll` do Playwright rodam **por worker**, não por arquivo. Com
  `fullyParallel`, um grupo apaga o dado do outro. Use
  `test.describe.configure({ mode: "serial" })` quando houver limpeza compartilhada.
- E2E só por `npm run test:e2e` (encadeia a guarda de porta), nunca `npx playwright test`.

## Antes de considerar pronto

`npx vitest run`, `npm run test:e2e`, `npm run lint`, `npm run typecheck` — os quatro
verdes, na árvore que vai ser integrada.

E o que nenhum deles alcança: rodar o fluxo à mão, uma vez, como o cliente rodaria.
Todo achado grave deste projeto veio de provar, não de ler.
