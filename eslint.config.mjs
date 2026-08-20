import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fronteira arquitetural: src/core não pode importar de src/modules.
// Este é um projeto clonado por cliente — core é compartilhado por todos os
// forks, modules contém funcionalidades opcionais. Um import de core para
// modules quebra a possibilidade de desligar o módulo e de aplicar patches
// de core entre forks. Ver spec seção 3.3.
//
// Extraído para uma constante porque `no-restricted-imports` NÃO se acumula
// entre blocos do flat config: o último bloco que casa com o arquivo
// SUBSTITUI a configuração da regra inteira. As exceções de prisma mais
// abaixo precisam re-declarar esta fronteira, ou os arquivos listados lá
// perderiam a proteção de core↛modules sem ninguém perceber.
const FRONTEIRA_CORE_MODULES = {
  group: ["@/modules", "@/modules/*", "**/modules", "**/modules/*"],
  message: "src/core não pode importar de src/modules — ver spec seção 3.3",
};

// O prisma cru ignora o escopo por empresa. `prismaDaEmpresa(companyId)`
// (`src/core/tenancy/escopo.ts`) injeta `where.companyId`/`data.companyId` nas
// operações onde a injeção é sólida e LANÇA nas que não são escopáveis. Quem
// importa `@/lib/prisma` direto pula as duas coisas.
//
// O padrão é largo pelo mesmo motivo que o de modules: pegar tanto o alias
// (`@/lib/prisma`) quanto qualquer caminho relativo que chegue no mesmo
// arquivo (`../lib/prisma`, `../../lib/prisma`). Medido em 2026-08-20, todo
// import atual usa o alias — o padrão relativo está aqui para o dia em que
// alguém contorne, não porque exista hoje.
const PRISMA_CRU = {
  group: ["@/lib/prisma", "**/lib/prisma"],
  message:
    "Não importe o prisma cru aqui — ele ignora o escopo por empresa. " +
    "Use `prismaDaEmpresa(companyId)` de `@/core/tenancy/escopo`, com o " +
    "`companyId` vindo de `UsuarioAtivo` (`@/core/auth/usuario-ativo`). " +
    "Se este arquivo realmente não puder ser escopado, acrescente-o à " +
    "exceção NOMEADA em eslint.config.mjs, com o motivo.",
};

// A exceção TEMPORÁRIA. Estes arquivos importam o prisma cru hoje porque
// aplicar o escopo em todos os serviços é o próximo ciclo — o Ciclo 1a
// entrega o mecanismo, não a migração dos chamadores.
//
// Eram 25 (17 em core, 5 em modules, 3 em src/app), medidos em 2026-08-20 com
// `grep -rln "lib/prisma" src --include=*.ts --include=*.tsx`. Hoje são 19:
// a Task 4 do Ciclo 1a converteu `leads` inteiro — os 4 arquivos de
// `src/core/leads/` e as 2 páginas de `src/app/(painel)/leads/`. O tamanho
// desta lista é o contador de quanto falta: quando ela esvaziar, os blocos
// somem junto. Exceção nomeada conta; disciplina não conta nada.
//
// Os 3 de `src/app` entraram numa segunda passada, e vale registrar por quê: a
// regra nascera limitada a `core` + `modules`, enquanto `escopo.ts` dizia no
// próprio comentário que o lint "garante que ninguém alcance o `prisma` cru".
// Enquanto as páginas do painel ficavam de fora, aquela frase era falsa — e um
// contador que não conta tudo mente sobre quanto falta.
//
// ─────────────────────────────────────────────────────────────────────────
// OS DEFEITOS CONHECIDOS, e por que eles estão anotados aqui
// ─────────────────────────────────────────────────────────────────────────
//
// Até 2026-08-20 esta fila ordenava por uma coisa só: "importa o prisma cru".
// Isso a fazia parecer uma lista de dívida uniforme — trabalho mecânico de
// trocar um import — quando ela é, na verdade, uma lista de VAZAMENTOS VIVOS
// de graus muito diferentes. Quem pegasse `tasks/` seguindo a ordem alfabética
// não saberia que havia um vazamento esperando lá dentro; foi exatamente o que
// aconteceu, e o vazamento (`criarTask`/`editarTask` aceitando `leadId` de
// outra empresa) só apareceu porque uma revisão foi ler o arquivo por outro
// motivo. Um contador que só conta arquivos esconde o que interessa.
//
// A varredura de 2026-08-20 (`.superpowers/sdd/reparo-tasks-tenancy.md`, § 5)
// leu os 18 arquivos restantes um a um e catalogou **33 defeitos de tenancy
// vivos** — 32 neles (18 de severidade ALTA, 9 MÉDIA, 5 BAIXA) mais 1 no
// arquivo que aquela tarefa corrigiu (`tasks/service.ts`, o `contactId`).
//
// **Hoje são 31** — 17 ALTA, 9 MÉDIA, 5 BAIXA. Dois foram fechados no reparo
// registrado em `.superpowers/sdd/reparo-redefinir-senha.md`, os dois da
// família descrita logo abaixo: `redefinirSenha` (`users/service.ts`, a tomada
// de conta que encabeçava a ordem) e `exigirContatoDaEmpresa`
// (`tasks/service.ts`, o `contactId` que sobrara do commit anterior). As duas
// linhas continuam nesta lista — o que zerou foi a contagem de DEFEITOS, não o
// import do prisma cru —, e as anotações delas dizem isso.
//
// **A família é sempre a mesma:** valida que o registro EXISTE, nunca que ele
// é da MESMA EMPRESA. Já apareceu 6 vezes neste ciclo (3744e64, 63cecd2,
// 6dfb325, da2a402 e as duas deste reparo), e as anotações abaixo dizem onde
// ela ainda mora. Variantes irmãs: `findMany`/`count`/`groupBy`/`updateMany`
// sem `where: { companyId }`, e busca por campo `@unique` GLOBAL
// (`Contact.telefone`, `Conversation.waId`, `PipelineStage.ordem`).
//
// **A ordem de conversão que estes números sugerem** não é a alfabética. O
// item 1 de antes (`users/service.ts`) saiu por ter sido corrigido; o que
// sobra é:
//
//   1. `src/core/pipeline/` (13)     — nenhuma assinatura de `service.ts` nem
//      de `stages.ts` recebe `companyId`. É o módulo sem noção de empresa.
//   2. `src/modules/whatsapp/queries.ts` + `agente.ts` (6) — a inbox inteira e
//      todas as mutações de conversa aceitam `conversationId` cru do cliente.
//   3. `src/core/contacts/` (4)      — agenda global e `findUnique` por id de
//      rota.
//   4. `src/app/(painel)/page.tsx` (1) — o `auditLog` sem `where`.
//   5. o resto (BAIXA), onde o escopo já vem por FK ou por dono.
//
// **Os 31 restantes NÃO foram corrigidos**, de propósito: a decisão de quantos
// e em que ordem é do dono do projeto, e as tarefas de reparo até aqui tiveram
// escopo de um ou dois. Corrigir 33 num commit seria a mesma pressa que os
// criou.
//
// Cada linha abaixo carrega a contagem do arquivo e o pior caso dele. Quem
// converter um arquivo APAGA a anotação junto com a linha — anotação que
// sobrevive ao defeito vira mentira, e mentira em comentário é pior que
// silêncio.
const VIOLADORES_TEMPORARIOS_CORE = [
  // 1 defeito (BAIXA): `avaliarAtividadeSuspeita` conta `AuditLog` só por
  // `userId`, sem `companyId`. O destinatário do alerta JÁ foi corrigido
  // (3744e64) — o que sobra é a contagem, que só distorce se a mesma pessoa
  // tiver vínculo em duas empresas.
  "src/core/audit/alerta.ts",
  // 1 defeito (MÉDIA): `companyId` do registro vem do primeiro `Membership` do
  // AUTOR, não da empresa da entidade auditada. Divergem no dia em que alguém
  // agir sobre entidade de uma empresa tendo vínculo em duas.
  "src/core/audit/log.ts",
  // 0 defeitos. Está na fila só pelo import: `user.findUnique({ email })` é
  // login, `User` não tem `companyId` e `email` é `@unique` global por
  // decisão registrada no schema. Converter este arquivo é trocar o import,
  // nada mais.
  "src/core/auth/credenciais.ts",
  // 2 defeitos, os DOIS ALTA: `listarContatos` faz `findMany` sem
  // `where: { companyId }` (a agenda é global), e `buscarContatoComHistorico`
  // faz `findUnique` pelo id que vem da rota `/contatos/[id]`, sem conferir
  // empresa — e daí desce para `listarConversasDoContato`
  // (`whatsapp/queries.ts`), que confia no `contactId` recebido.
  "src/core/contacts/queries.ts",
  // 2 defeitos: `atualizarContato` (ALTA) valida `dados.id` da Server Action
  // só por existência — a família de sempre; e `erroDeTelefoneOcupado`
  // (MÉDIA) busca por `telefone`, que é `@unique` GLOBAL, e devolve na
  // mensagem de erro o NOME do dono — que pode ser de outra empresa.
  "src/core/contacts/service.ts",
  // `src/core/leads/*` SAIU desta lista na Task 4 do Ciclo 1a — os quatro
  // arquivos (`dedupe`, `notes`, `queries`, `service`) passaram a alcançar o
  // banco só por `prismaDaEmpresa`. O lint passar com eles fora daqui é a
  // prova de que o serviço não alcança mais o `prisma` cru; a prova de que o
  // escopo FUNCIONA é outra, e mora em `tests/unit/lead-isolamento.test.ts`.
  // `src/core/leads/*` SAIU desta lista na Task 4 do Ciclo 1a — os quatro
  // arquivos (`dedupe`, `notes`, `queries`, `service`) passaram a alcançar o
  // banco só por `prismaDaEmpresa`. O lint passar com eles fora daqui é a
  // prova de que o serviço não alcança mais o `prisma` cru; a prova de que o
  // escopo FUNCIONA é outra, e mora em `tests/unit/lead-isolamento.test.ts`.
  //
  // 1 defeito (BAIXA): `listarNotificacoesNaoLidas` filtra só por `userId`,
  // sem `companyId` — escopo por dono, que é mais forte, mas mistura empresas
  // para quem tiver dois vínculos. O ponto que ERA grave aqui
  // (`notificarNovoLead` gravando `companyId` do lead com `userId` de outra
  // empresa) fechou por consequência do 6dfb325, e a invariante está escrita
  // no próprio `create` — inclusive QUEM a garante e ONDE.
  "src/core/notifications/dispatch.ts",
  // **11 defeitos, o pior arquivo da fila** — 6 ALTA. Nenhuma função de
  // `pipeline/` recebe `companyId` em assinatura nenhuma, então não é
  // conversão, é redesenho de interface. Os que doem mais:
  // `definirEtapaDeFechamento` faz `updateMany({ where: { ehGanho: true } })`
  // sem empresa (desliga a etapa de ganho de TODAS as empresas de uma vez);
  // `excluirEtapa` valida o `destinoId` contra o funil global e move leads
  // para etapa de outra empresa; `editarEtapa`/`moverNaOrdem`/`excluirEtapa`
  // validam `input.etapaId` só por existência (a família de sempre); e o
  // `SELECT FOR UPDATE` de `travarEstruturaDoFunil` trava a tabela inteira,
  // serializando empresas que não têm nada a ver uma com a outra.
  "src/core/pipeline/service.ts",
  // 2 defeitos: `listarEtapas` (ALTA) faz `findMany` sem `companyId` — é ela
  // que alimenta o funil de `/`, `/etapas` e o kanban, e é por ela que a
  // última página da fila continua vazando mesmo depois do `auditLog`; e
  // `contarLeadsQueSeguramEtapa` (MÉDIA) faz `groupBy` em `Lead` sem empresa.
  "src/core/pipeline/stages.ts",
  // 2 defeitos, os dois BAIXA: `listarMinhasTasks` filtra por `responsavelId`
  // e `listarTasksPendentesDoLead` por `leadId` — escopo por dono e por FK,
  // que seguram hoje. `listarTasksPendentesDoLead` deixa de segurar no dia em
  // que o `leadId` a montante não for validado; com o reparo de 2026-08-20 em
  // `tasks/service.ts`, ele é.
  "src/core/tasks/queries.ts",
  // 0 defeitos desde 2026-08-20. Eram dois, os dois da mesma família e no
  // mesmo par de funções: `leadId` (fechado em `da2a402`,
  // `exigirLeadDaEmpresa`) e `contactId` (fechado no reparo seguinte,
  // `exigirContatoDaEmpresa`). Os dois chegam das Server Actions
  // `criarMinhaTaskAction`/`editarTaskAction` e eram validados só por
  // EXISTÊNCIA. `tests/unit/task-isolamento.test.ts` trava os dois, com as
  // duas metades cada (recusa o registro da empresa de fora, aceita o da
  // própria).
  //
  // Continua nesta fila porque a fila é do IMPORT, não da contagem: o arquivo
  // ainda alcança `@/lib/prisma` e escreve `Task`, que É modelo de tenant.
  // Converter para `prismaDaEmpresa` é do próximo ciclo, e é o que faz o
  // filtro deixar de depender de alguém lembrar de escrevê-lo à mão.
  "src/core/tasks/service.ts",
  // `users/empresa.ts` está aqui, e NÃO na exceção permanente, de propósito.
  // Ele resolve `companyIdDoUsuario(usuarioId)` lendo `Membership`, o que o
  // faz parecer parente de `auth/session.ts` — mas o próprio arquivo se
  // documenta como PONTE que desaparece quando os chamadores passarem
  // `UsuarioAtivo.companyId` explícito. Exceção permanente sobreviveria ao
  // arquivo e viraria mentira no dia em que ele fosse apagado.
  //
  // Sem defeito próprio, mas é o MULTIPLICADOR de dois deles: o
  // `findFirstOrThrow` sobre `Membership` pega um vínculo ARBITRÁRIO quando a
  // pessoa tem mais de um, e é dele que `audit/log.ts` e `audit/alerta.ts`
  // tiram a empresa. `criarUsuario` já sabe criar `Membership`, então duas
  // empresas com a mesma pessoa é estado expressável hoje — só nenhum caminho
  // de UI o produz ainda.
  "src/core/users/empresa.ts",
  // 0 defeitos. `listarUsuarios`/`buscarUsuario` já partem de `Membership` com
  // `companyId` obrigatório na assinatura — foi este arquivo que consertou o
  // `<select>` de responsável na Task 4. Converter é trocar o import.
  "src/core/users/queries.ts",
  // 0 defeitos desde 2026-08-20. O que havia aqui era o pior da fila inteira, e
  // fica registrado porque a FORMA se repete: `redefinirSenha` achava o alvo
  // com `user.findUnique({ where: { id: entrada.id } })` e nada mais — sem
  // `Membership`, sem `companyId` —, enquanto as três vizinhas do MESMO
  // arquivo (`atualizarUsuario`, `definirAtivo`, `garantirQueSobraAdmin`) já
  // recusavam quem não tem vínculo. Um ADMIN da empresa A redefinia a senha de
  // qualquer conta do banco e entrava com ela: tomada de conta, não leitura de
  // dado alheio. Fechado no padrão das vizinhas, com
  // `tests/unit/users-service.test.ts` travando as duas metades.
  //
  // Continua nesta fila pelo IMPORT, e aqui o motivo é mais fundo que "ainda
  // não converteram": `User` não tem `companyId` e `email` é `@unique` GLOBAL
  // por decisão registrada no schema, então o escopo deste módulo é o vínculo
  // conferido em cada função, como está. Converter para `prismaDaEmpresa` exige
  // decidir antes o que o cliente escopado faz com `User` — não é troca de
  // import.
  "src/core/users/service.ts",
];

const VIOLADORES_TEMPORARIOS_MODULES = [
  // 3 defeitos, todos ALTA: `pausarIa` (`updateMany where: { id }`),
  // `religarIa` (`update where: { id }`) e `responderComoHumano`
  // (`findUniqueOrThrow` por id) recebem `conversationId` cru da Server Action
  // e nunca conferem empresa. `responderComoHumano` é o pior: ele ENVIA uma
  // mensagem de WhatsApp pela instância Evolution a partir de uma conversa que
  // pode ser de outro cliente.
  "src/modules/whatsapp/agente.ts",
  // 1 defeito (MÉDIA): o `upsert` casa por `waId`, que é `@unique` GLOBAL em
  // `Conversation` — variante-irmã do `Contact.telefone`. Só se alcança com
  // duas instâncias Evolution, o que a ponte de `obterEvolutionCompanyId()`
  // (env, deliberada até o Ciclo 2) ainda não permite.
  "src/modules/whatsapp/ingest.ts",
  // 1 defeito (MÉDIA): `limparAguardandoHumano` faz `updateMany` por id sem
  // empresa. O fan-out do aviso, que era o ponto grave, fechou no 63cecd2.
  "src/modules/whatsapp/notificacoes.ts",
  // 3 defeitos, 2 ALTA: `listarConversas` faz `findMany` sem `companyId` — a
  // inbox é global —, e `buscarConversaComMensagens` faz `findUnique` pelo id
  // da rota e devolve a thread INTEIRA de qualquer empresa. O terceiro
  // (`listarConversasDoContato`, BAIXA) só vaza pela cadeia que vem de
  // `contacts/queries.ts:150`, que não valida o contato.
  "src/modules/whatsapp/queries.ts",
  // 0 defeitos. Toda consulta parte de um `conversationId` nascido dentro do
  // servidor (`ingest.ts` → fila), nunca de entrada de usuário, e o
  // `companyId` de escrita sai sempre da `Conversation` já carregada.
  // Converter é trocar o import — e é o candidato mais seguro da fila para
  // quem quiser abrir a conversão sem risco.
  "src/modules/whatsapp/turno.ts",
];

// A página do painel que ainda lê o banco direto. Eram três; duas saíram na
// Task 4 do Ciclo 1a, junto com o serviço que elas consomem:
//
// - `(painel)/leads/[id]/page.tsx` fazia `prisma.lead.findUnique(...)` —
//   modelo de tenant alcançado por id, o caminho mais curto para ler o cliente
//   de outro tenant. Virou `findFirst` no cliente escopado.
// - `(painel)/leads/page.tsx` fazia `prisma.user.findMany({ ativo: true })`.
//   A entrada anterior desta lista dizia que ela "não vaza dado de empresa,
//   porque `User` não é modelo de tenant". Estava certa sobre o modelo e
//   errada sobre a consequência: o `<select>` de responsável listava gente de
//   TODA empresa, e escolher uma delas gravava o lead no nome de alguém de
//   outro cliente. Hoje chama `listarUsuarios(companyId)`, que parte de
//   `Membership`.
//
// A que sobra é a mais exposta das três, e continua sendo o item 1 da fila:
//
// 1. `(painel)/page.tsx` — `prisma.auditLog.findMany({ take, orderBy })`, SEM
//    `where` NENHUM. `AuditLog` é modelo de tenant, e a home do painel mostra
//    hoje os últimos registros de QUALQUER empresa.
//
// Confirmado em 2026-08-20 com
// `grep -rln "lib/prisma" src/app --include=*.ts --include=*.tsx`: **é o único
// arquivo de `src/app/**` que ainda alcança o banco direto**, e portanto a
// última leitura cross-tenant escrita DENTRO de uma página.
//
// O que essa frase NÃO quer dizer, e vale escrever antes que alguém a leia
// como quer: esta página continua vazando por OUTRO caminho depois que o
// `auditLog` for corrigido. Ela chama `listarEtapas()`
// (`core/pipeline/stages.ts:14`), que faz `findMany` em `PipelineStage` sem
// `companyId` nenhum. "Última leitura cross-tenant da PÁGINA" e "última
// leitura cross-tenant que a página produz" são coisas diferentes, e é a
// segunda que interessa a quem usa o sistema.
//
// O `\\[id\\]` que estava na linha do detalhe de lead NÃO era enfeite, e o
// registro fica aqui porque a próxima rota dinâmica a entrar nesta lista vai
// precisar dele. Medido em 2026-08-20: escrito como `[id]`, o caminho vira um
// glob com CLASSE DE CARACTERES ("um caractere entre i e d"), não casa com a
// pasta literal `[id]`, e o arquivo continua sendo acusado pela regra apesar
// de estar listado aqui — foi exatamente o que aconteceu na primeira execução.
// Os parênteses de `(painel)` não têm esse problema: só viram grupo quando
// precedidos de `?`/`*`/`+`/`@`/`!`.
const VIOLADORES_TEMPORARIOS_APP = ["src/app/(painel)/page.tsx"];

// A exceção PERMANENTE. Nada aqui vai para o cliente escopado, nunca:
//
// - `core/auth/session.ts` resolve QUEM é a pessoa. O escopo é derivado do
//   vínculo dela; exigir escopo aqui é circular.
// - `core/rate-limit/limiter.ts` opera em `RateLimit`, tabela sem
//   `companyId` (confirmado em prisma/schema.prisma): é defesa global,
//   consultada antes de existir sessão e portanto antes de existir empresa.
// - `core/tenancy/escopo.ts` É o cliente escopado. É o único arquivo cujo
//   import do prisma cru é o ponto.
const EXCECAO_PERMANENTE = [
  "src/core/auth/session.ts",
  "src/core/rate-limit/limiter.ts",
  "src/core/tenancy/escopo.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `Bots/` é material de referência colocado ali de propósito: fluxos do
    // n8n que rodam em produção e worktrees de OUTROS projetos, com stack e
    // convenções próprias (`require()`, JSX solto, scripts `.cjs`). Sem esta
    // linha o eslint varre tudo aquilo e `npm run lint` sai com 30 erros que
    // nenhum deles é deste projeto — o portão nunca fica verde, e um portão
    // que nunca fica verde deixa de ser lido. Nada em `Bots/` é compilado,
    // importado ou publicado por este CRM.
    "Bots/**",
    // Mesma história, outra pasta: material de referência do desenvolvedor
    // largado na raiz do projeto. `Skills Claude/` são skills do Claude Code
    // exportadas do ambiente local (já instaladas em `~/.claude/skills`), e os
    // exemplos que vêm dentro delas rendem 17 erros de lint e 99 de
    // TypeScript — nenhum deste CRM. Estar no `.gitignore` não basta: nem o
    // eslint nem o `tsc` leem o `.gitignore`, então a exclusão precisa ser
    // dita nos dois lugares (aqui e em `tsconfig.json#exclude`).
    "Skills Claude/**",
  ]),
  // src/core: fronteira core↛modules + proibição do prisma cru.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [FRONTEIRA_CORE_MODULES, PRISMA_CRU] },
      ],
    },
  },
  // src/modules e src/app: só a proibição do prisma cru. A fronteira
  // core↛modules não se aplica a nenhum dos dois — modules PODE importar de
  // core (é o sentido permitido), e as páginas de `src/app` são justamente
  // quem compõe core com modules.
  //
  // Aqui a exceção entra por `ignores`, e NÃO por um bloco posterior com a
  // regra desligada. O motivo é a armadilha documentada no topo deste arquivo:
  // `no-restricted-imports` não se acumula, então um bloco final com
  // `"off"` não isenta esses arquivos só desta proibição — ele apaga QUALQUER
  // restrição de import que outro bloco venha a lhes aplicar no futuro, sem
  // nenhum aviso no dia em que isso acontecer. `ignores` diz a coisa exata que
  // se quer dizer: "esta proibição não vale para estes arquivos". O bloco de
  // exceção de core continua existindo logo abaixo porque lá há mesmo algo a
  // re-declarar (a fronteira core↛modules); aqui não há.
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    ignores: VIOLADORES_TEMPORARIOS_MODULES,
    rules: {
      "no-restricted-imports": ["error", { patterns: [PRISMA_CRU] }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: VIOLADORES_TEMPORARIOS_APP,
    rules: {
      "no-restricted-imports": ["error", { patterns: [PRISMA_CRU] }],
    },
  },
  // A exceção de core RE-DECLARA o que continua valendo para aqueles arquivos,
  // porque o flat config substitui a configuração da regra inteira em vez de
  // mesclá-la — sem esta re-declaração, os 20 arquivos listados perderiam a
  // proteção de core↛modules sem ninguém perceber.
  {
    files: [...VIOLADORES_TEMPORARIOS_CORE, ...EXCECAO_PERMANENTE],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [FRONTEIRA_CORE_MODULES] },
      ],
    },
  },
]);

export default eslintConfig;
