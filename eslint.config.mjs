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
// `grep -rln "lib/prisma" src --include=*.ts --include=*.tsx`. Hoje são 13:
// a Task 4 do Ciclo 1a converteu `leads` inteiro — os 4 arquivos de
// `src/core/leads/` e as 2 páginas de `src/app/(painel)/leads/` — e o Ciclo 1d
// converteu `src/core/pipeline/` (`service.ts` e `stages.ts`),
// `src/modules/whatsapp/{agente,queries}.ts` e `src/core/contacts/`
// (`queries.ts` e `service.ts`). O tamanho desta lista é o contador de quanto
// falta: quando ela esvaziar, os blocos somem junto. Exceção nomeada conta;
// disciplina não conta nada.
//
// **Esta lista é lida por um teste.** `tests/unit/catraca-prisma-cru.test.ts`
// compara as quatro listas deste arquivo com a árvore de `src/` e reprova
// quem entrar sem ser declarado, quem for declarado sem importar mais nada, e
// quem escrever um caminho com metacaractere de glob nu (a armadilha do `[id]`,
// registrada mais abaixo). Diminuir a lista não reprova ninguém — a catraca
// gira num sentido só —, mas quem diminuir deve baixar junto a
// `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` de lá, que hoje é 13.
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
// **Hoje são 14** — 7 ALTA, 3 MÉDIA, 4 BAIXA. Os 4 mais recentes saíram com
// `src/core/contacts/` (3 ALTA, 1 MÉDIA), no bloco registrado em
// `.superpowers/sdd/ciclo-1d-contacts.md`. Dois foram fechados no reparo
// registrado em `.superpowers/sdd/reparo-redefinir-senha.md`, os dois da
// família descrita logo abaixo: `redefinirSenha` (`users/service.ts`, a tomada
// de conta que encabeçava a ordem) e `exigirContatoDaEmpresa`
// (`tasks/service.ts`, o `contactId` que sobrara do commit anterior). As duas
// linhas continuam nesta lista — o que zerou foi a contagem de DEFEITOS, não o
// import do prisma cru —, e as anotações delas dizem isso.
//
// Os outros 13 saíram no Ciclo 1d, com `src/core/pipeline/` inteiro
// (`.superpowers/sdd/ciclo-1d-pipeline.md`). Ressalva sobre o SPLIT dessa
// subtração, para não passar por medição o que é itemização: a varredura de
// 2026-08-20 registrou o TOTAL por arquivo (11 e 2) e quantos eram ALTA (6 e
// 1), nunca a separação MÉDIA/BAIXA item a item. A conversão itemizou os 13 e
// chegou a 7 ALTA, 5 MÉDIA, 1 BAIXA — a lista está no relatório do ciclo. Os
// números acima descem dessa itemização, e é dela que herdam a incerteza.
//
// **A família é sempre a mesma:** valida que o registro EXISTE, nunca que ele
// é da MESMA EMPRESA. Já apareceu 6 vezes neste ciclo (3744e64, 63cecd2,
// 6dfb325, da2a402 e as duas deste reparo), e as anotações abaixo dizem onde
// ela ainda mora. Variantes irmãs: `findMany`/`count`/`groupBy`/`updateMany`
// sem `where: { companyId }`, e busca por campo `@unique` GLOBAL
// (`Contact.telefone`, `Conversation.waId`, `PipelineStage.ordem`).
//
// **A ordem de conversão que estes números sugerem** não é a alfabética. O
// que sobra é:
//
//   1. `src/app/(painel)/page.tsx` (1) — o `auditLog` sem `where`. É o único
//      item ALTA restante que é uma LEITURA sem filtro nenhum, e o único
//      arquivo de `src/app/**` ainda na fila.
//   2. o resto (MÉDIA e BAIXA), onde o escopo já vem por FK, por dono, ou só
//      se alcança com duas instâncias Evolution.
//
// Os três itens que encabeçavam esta ordem saíram no Ciclo 1d:
// `src/core/pipeline/` (13), `src/modules/whatsapp/{queries,agente}.ts` (6) e
// `src/core/contacts/` (4). O último fechou a cadeia que os outros dois
// deixaram pela metade: `listarConversasDoContato` já recusava um `contactId`
// de fora, mas os DADOS do contato (nome, telefone, CPF/CNPJ, endereço,
// observações e os leads) continuavam saindo por `buscarContatoComHistorico`
// até este bloco rodar. Hoje `/contatos/<id de outra empresa>` cai em
// `notFound()`.
//
// **Os 14 restantes NÃO foram corrigidos**, de propósito: a decisão de quantos
// e em que ordem é do dono do projeto, e as tarefas até aqui tiveram escopo de
// um reparo ou de um módulo. Corrigir 33 num commit seria a mesma pressa que
// os criou.
//
// Cada linha abaixo carrega a contagem do arquivo e o pior caso dele. Quem
// converter um arquivo APAGA a anotação junto com a linha — anotação que
// sobrevive ao defeito vira mentira, e mentira em comentário é pior que
// silêncio.
const VIOLADORES_TEMPORARIOS_CORE = [
  // `src/core/audit/*` SAIU desta lista no Ciclo 1d, e a conversão foi mais
  // funda que um import: `ParamsDeAuditoria` ganhou `companyId` OBRIGATÓRIO, e
  // com ele os 17 pontos de chamada de `registrarAuditoria` em 8 arquivos.
  // Antes a empresa da linha era deduzida do AUTOR por `companyIdDoUsuario`
  // (`findFirstOrThrow` sobre `Membership`, ou seja, um vínculo ARBITRÁRIO de
  // quem tem dois), e `avaliarAtividadeSuspeita` contava a rajada só por
  // `userId` — as ações das duas empresas somavam num contador único. Os dois
  // defeitos (1 MÉDIA, 1 BAIXA) morreram na mesma mudança, e nenhum dos 17
  // pontos precisou de consulta nova: a empresa da entidade já estava em mãos
  // em todos eles (`companyId` do serviço, `task.companyId`, `antes.companyId`
  // ou `usuarioAtual().companyId`).
  //
  // A leitura da home saiu junto, para `src/core/audit/queries.ts`
  // (`listarAtividadeRecente`) — ver a nota de `VIOLADORES_TEMPORARIOS_APP`.
  //
  // O lint passar com eles fora daqui é a prova de que não alcançam mais o
  // `prisma` cru; a prova de que o escopo FUNCIONA é outra, e mora em
  // `tests/unit/audit-isolamento.test.ts`, que tem as duas metades para cada
  // função e uma SONDA de cada consulta antiga afirmando o vazamento.
  // `src/core/contacts/*` SAIU desta lista no Ciclo 1d — `queries.ts` e
  // `service.ts` (os dois únicos que alcançavam o banco) passaram a alcançá-lo
  // só por `prismaDaEmpresa`, e os 4 defeitos deles (3 ALTA, 1 MÉDIA) foram
  // abatidos. As quatro funções públicas ganharam `companyId` como PRIMEIRO
  // parâmetro, e com elas mudaram as 2 Server Actions (que passaram a tirar a
  // empresa de `usuarioAtual().companyId`) e as 3 páginas que as consomem —
  // `/contatos` perdeu o `Promise.all` que começava a busca antes da sessão,
  // porque agora a empresa vem dela. O lint passar com eles fora daqui é a
  // prova de que não alcançam mais o `prisma` cru; a prova de que o escopo
  // FUNCIONA é outra, e mora em `tests/unit/contact-isolamento.test.ts`, que
  // tem as duas metades para cada função.
  //
  // Os dois que a leitura aninhada obrigou a filtrar À MÃO ficam registrados
  // aqui porque o escopo não os alcança: os `leads` do contato, nas duas
  // consultas. `Lead.contactId` não carrega empresa, então "lead da B
  // pendurado em contato da A" é estado expressável — o teste cria a linha e
  // afirma que ela não aparece.
  //
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
  // `src/core/pipeline/*` SAIU desta lista no Ciclo 1d — os dois arquivos que
  // alcançavam o banco (`service.ts` e `stages.ts`) passaram a alcançá-lo só
  // por `prismaDaEmpresa`. Era a maior concentração da fila, 13 defeitos, e a
  // única que não era conversão e sim REDESENHO: nenhuma das 7 funções
  // públicas recebia `companyId`, então as 5 assinaturas de `service.ts` e as
  // 2 de `stages.ts` mudaram, e com elas as 5 Server Actions (que passaram a
  // tirar a empresa de `usuarioAtual().companyId`) e as 4 páginas que as
  // consomem. O lint passar com eles fora daqui é a prova de que o módulo não
  // alcança mais o `prisma` cru; a prova de que o escopo FUNCIONA é outra, e
  // mora em `tests/unit/pipeline-isolamento.test.ts`.
  //
  // O único ponto do módulo que o escopo NÃO alcança é o `$queryRaw` de
  // `travarEstruturaDoFunil` — lá o `WHERE "companyId"` é escrito à mão, e
  // quem cobra é a Parte 2b de `tests/unit/catraca-prisma-cru.test.ts`, que
  // passou a valer para aquele arquivo no instante em que ele saiu daqui.

  // `src/core/tasks/*` SAIU desta lista no Ciclo 1d. As 2 BAIXA de `queries.ts`
  // eram as duas formas de "escopo que não é escopo de empresa":
  // `listarMinhasTasks` filtrava por `responsavelId` (escopo por DONO — coincide
  // com a empresa só enquanto ninguém tem dois vínculos) e
  // `listarTasksPendentesDoLead` por `leadId` (escopo por FK — e `Task.leadId`
  // não carrega empresa, então "tarefa da A pendurada no Lead da B" é estado
  // expressável). As duas sondas de `tests/unit/task-isolamento.test.ts`
  // fabricam os dois estados e AFIRMAM que a consulta antiga os alcançava.
  //
  // `service.ts` já estava em 0 defeitos desde 2026-08-20 (`da2a402` e
  // `f2f05cf` fecharam `leadId` e `contactId`), e o que a conversão acrescentou
  // foi tirar o filtro das mãos de quem edita: as sete funções públicas passaram
  // a receber `companyId` — em Server Action, sempre de `usuarioAtual()` —, e as
  // quatro escritas por id passaram por `tarefaMinhaNestaEmpresa`, onde a regra
  // de DONO e o escopo de EMPRESA são duas travas independentes num ponto só. A
  // segunda escondia a falta da primeira no caso comum; o caso que as separa
  // (tarefa da B cujo dono tem vínculo também na A) está no teste.
  //
  // `criarTask` deixou de deduzir a empresa por
  // `companyIdDoUsuario(responsavelId)` — uma consulta a mais para chegar num
  // vínculo arbitrário, tendo `usuarioAtual().companyId` disponível no chamador.
  // `src/core/users/{queries,service}.ts` SAÍRAM desta lista no Ciclo 1d, e a
  // resposta que faltava era a que a anotação antiga pedia: "o que o cliente
  // escopado faz com `User`?". Faz nada, e isso é o correto — `User` está fora
  // dos 11 modelos de tenant, então `escoparArgumentos` devolve os argumentos
  // INTACTOS (inclusive `findUnique`, que ele recusaria num modelo de tenant).
  // Quem o escopo alcança neste módulo é `Membership`, que É de tenant e é
  // justamente o que define "pertence a esta empresa". As mudanças observáveis
  // foram duas, as duas por recusa do escopo: `membership.findUnique` virou
  // `findFirst` em `buscarUsuario`, e `membership.update` virou `updateMany`
  // dentro da transação de `atualizarUsuario` — nas duas, o `companyId` deixou
  // de ser escrito à mão.
  //
  // O que NÃO mudou, e é a parte que o escopo não alcança: o filtro por
  // `companyId` dentro do `select` de `memberships`, nas três funções que
  // carregam o vínculo junto do alvo. Leitura ANINHADA não é escopada (ver a
  // seção no topo de `core/tenancy/escopo.ts`) — sem aquele filtro à mão, as
  // três veriam o vínculo da pessoa em qualquer empresa e a tratariam como
  // gerenciável. O bloco no topo de `service.ts` registra isso.
];

const VIOLADORES_TEMPORARIOS_MODULES = [
  // `src/modules/whatsapp/agente.ts` e `queries.ts` SAÍRAM desta lista no
  // Ciclo 1d — os 6 defeitos deles (5 ALTA, 1 BAIXA) foram abatidos, e as
  // nove funções públicas dos dois arquivos alcançam o banco só por
  // `prismaDaEmpresa`. O lint passar com eles fora daqui é a prova de que não
  // alcançam mais o `prisma` cru; a prova de que o escopo FUNCIONA é outra, e
  // mora em `tests/unit/whatsapp-isolamento.test.ts`, que tem as duas metades
  // para cada função.
  //
  // O pior deles não era leitura: `responderComoHumano` ENVIAVA uma mensagem
  // de WhatsApp pela instância Evolution da outra empresa, para o cliente
  // dela, com o número dela. O teste daquele caso afirma que o gateway NÃO
  // foi chamado — "a função lançou" não provaria nada, porque lançar depois
  // do envio passaria igual e continuaria vazando.
  //
  // As nove assinaturas ganharam `companyId` como PRIMEIRO parâmetro, e com
  // elas mudaram as 5 Server Actions (`actions.ts`, `agente-actions.ts`,
  // que tiram a empresa de `usuarioAtual().companyId`) e as 4 páginas que as
  // consomem. `/conversas` passou a chamar `usuarioAtualOuLogin()`, que ela
  // não chamava.
  // 1 defeito (MÉDIA): o `upsert` casa por `waId`, que é `@unique` GLOBAL em
  // `Conversation` — variante-irmã do `Contact.telefone`. Só se alcança com
  // duas instâncias Evolution, o que a ponte de `obterEvolutionCompanyId()`
  // (env, deliberada até o Ciclo 2) ainda não permite.
  "src/modules/whatsapp/ingest.ts",
  // 1 defeito (MÉDIA): `limparAguardandoHumano` faz `updateMany` por id sem
  // empresa. O fan-out do aviso, que era o ponto grave, fechou no 63cecd2.
  "src/modules/whatsapp/notificacoes.ts",
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
// A terceira — `(painel)/page.tsx`, o item 1 da fila e a última leitura
// cross-tenant escrita DENTRO de uma página — saiu no Ciclo 1d. Ela fazia
// `prisma.auditLog.findMany({ take: 10, orderBy })` SEM `where` NENHUM sobre um
// modelo de tenant: a home mostrava as dez últimas ações de QUALQUER empresa do
// banco. Virou `listarAtividadeRecente(usuario.companyId)`
// (`src/core/audit/queries.ts`) — função de `core/`, e não um `where`
// acrescentado ali mesmo, porque página não é onde se prova isolamento. O caso
// que trava a regressão é o do TETO: doze linhas mais novas da outra empresa
// deixariam esta empresa sem atividade nenhuma na tela, e o teste afirma que
// não deixam (`tests/unit/audit-isolamento.test.ts`).
//
// **Esta lista está VAZIA**, e é a primeira das quatro a zerar. Nenhum arquivo
// de `src/app/**` alcança mais o banco direto.
//
// Esta linha vinha com uma ressalva — "a página continua vazando por OUTRO
// caminho depois que o `auditLog` for corrigido, porque `listarEtapas()` faz
// `findMany` em `PipelineStage` sem `companyId`". Ela deixou de valer no Ciclo
// 1d: `listarEtapas` passou a EXIGIR `companyId`, e a página passa
// `usuario.companyId`. A distinção que a ressalva registrava continua valendo
// como método — "última leitura cross-tenant da PÁGINA" e "última leitura
// cross-tenant que a página PRODUZ" são coisas diferentes, e é a segunda que
// interessa a quem usa o sistema —, e é por isso que fica escrita aqui: hoje as
// duas coincidem, e o que sobra é o `auditLog`.
//
// O `\\[id\\]` que estava na linha do detalhe de lead NÃO era enfeite, e o
// registro fica aqui porque a próxima rota dinâmica a entrar nesta lista vai
// precisar dele. Medido em 2026-08-20: escrito como `[id]`, o caminho vira um
// glob com CLASSE DE CARACTERES ("um caractere entre i e d"), não casa com a
// pasta literal `[id]`, e o arquivo continua sendo acusado pela regra apesar
// de estar listado aqui — foi exatamente o que aconteceu na primeira execução.
// Os parênteses de `(painel)` não têm esse problema: só viram grupo quando
// precedidos de `?`/`*`/`+`/`@`/`!`.
const VIOLADORES_TEMPORARIOS_APP = [];

// A exceção PERMANENTE. Nada aqui vai para o cliente escopado, nunca:
//
// - `core/auth/session.ts` resolve QUEM é a pessoa. O escopo é derivado do
//   vínculo dela; exigir escopo aqui é circular.
// - `core/rate-limit/limiter.ts` opera em `RateLimit`, tabela sem
//   `companyId` (confirmado em prisma/schema.prisma): é defesa global,
//   consultada antes de existir sessão e portanto antes de existir empresa.
// - `core/tenancy/escopo.ts` É o cliente escopado. É o único arquivo cujo
//   import do prisma cru é o ponto.
// - `core/auth/credenciais.ts` autentica: ele roda ANTES de existir sessão e,
//   portanto, antes de existir empresa. `prismaDaEmpresa(companyId)` exige um
//   `companyId` que só passa a existir DEPOIS que esta função devolve quem a
//   pessoa é — pedir escopo aqui é a mesma circularidade de `session.ts`. A
//   consulta é `user.findUnique({ where: { email } })`: `User` não é modelo de
//   tenant (não tem `companyId`, `prisma/schema.prisma` linha 50 diz por quê) e
//   `email` é `@unique` GLOBAL por decisão registrada no mesmo schema — ou seja,
//   nem o escopo teria onde morder: `escoparArgumentos` devolve os argumentos
//   INTACTOS para modelo fora dos 11 (`core/tenancy/escopo.ts`). O arquivo
//   entrou na lista TEMPORÁRIA em 2026-08-20 com a anotação "converter é trocar
//   o import, nada mais"; ela estava errada — não há por o que trocar.
// - `core/users/empresa.ts` RESOLVE `companyIdDoUsuario(usuarioId)` lendo
//   `Membership`. Escopá-lo exigiria o `companyId` que ele está calculando:
//   é a mesma circularidade de `session.ts`, e é verificável em uma linha —
//   `prismaDaEmpresa(companyId)` recebe como parâmetro exatamente o valor que
//   esta função devolve.
//
//   Ele esteve na lista TEMPORÁRIA com um argumento que parecia forte: o
//   arquivo se documenta como PONTE que some quando todos os chamadores
//   passarem `UsuarioAtivo.companyId`, e uma exceção permanente sobreviveria ao
//   arquivo e viraria mentira. **Não sobrevive**, e o que impede é mecânico, não
//   disciplina: `tests/unit/catraca-prisma-cru.test.ts` reprova toda exceção
//   declarada — permanente inclusive — para arquivo que não exista em disco ou
//   que não importe mais o prisma cru. Apagar `empresa.ts` sem apagar esta linha
//   deixa a suíte vermelha.
//
//   Ele continua sendo o MULTIPLICADOR que a anotação antiga descrevia, e o
//   Ciclo 1d cortou os dois piores usos: `audit/log.ts` e `audit/alerta.ts`
//   deixaram de tirar a empresa daqui. Sobram 6 chamadas, em `leads/service.ts`
//   (2), `leads/notes.ts` (3) e `tasks/service.ts` (1) — todas com o mesmo
//   limite conhecido, o `findFirstOrThrow` que pega um vínculo ARBITRÁRIO de
//   quem tem dois. Isso é dívida do Ciclo 2 (a origem passa a ser
//   `UsuarioAtivo.companyId`), não coisa que converter este arquivo resolva.
const EXCECAO_PERMANENTE = [
  "src/core/auth/credenciais.ts",
  "src/core/auth/session.ts",
  "src/core/users/empresa.ts",
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
  // mesclá-la — sem esta re-declaração, os arquivos listados perderiam a
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
