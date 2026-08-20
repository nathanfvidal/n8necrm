import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma amarrado a UMA empresa.
 *
 * ## O que este arquivo é, e o que ele não é
 *
 * Ele é metade do isolamento por empresa. A outra metade é a regra de lint em
 * `eslint.config.mjs` que proíbe `src/core/**`, `src/modules/**` **e
 * `src/app/**`** de importar `@/lib/prisma` — porque o wrapper cobre o caminho
 * comum e **não cobre tudo** (a lista exata está mais abaixo). Sem o lint, o
 * que este arquivo não alcança vira um `import { prisma }` que ninguém revisa.
 *
 * As três árvores, não duas: enquanto `src/app/**` ficava de fora, uma página
 * do painel podia ler modelo de tenant sem escopo nenhum e o lint ficava
 * verde. Três páginas faziam exatamente isso quando a regra foi estendida
 * (2026-08-20); estão na exceção TEMPORÁRIA, com a fila de conversão anotada
 * lá. A mais exposta lê `AuditLog` sem `where` nenhum.
 *
 * Ele NÃO é RLS. `CLAUDE.md` já registra a armadilha: o Prisma conecta com o
 * papel dono da tabela, e política de linha não se aplica ao dono a menos que
 * `FORCE ROW LEVEL SECURITY` esteja ligada. A migração
 * `20260730212500_enable_rls_and_revoke_anon_grants` diz isso textualmente,
 * nas suas linhas 3-5:
 *
 *   "this app connects as the table owner via a direct DATABASE_URL/postgres
 *    role, which bypasses RLS unless FORCE ROW LEVEL SECURITY is set -- it is
 *    intentionally NOT set here"
 *
 * ## Por que não o exemplo oficial do Prisma (`set_config` + RLS)
 *
 * O exemplo de multi-tenancy da própria documentação do Prisma usa uma
 * extensão que roda `SELECT set_config('app.current_tenant_id', ...)` dentro
 * de uma transação e deixa o **Postgres** filtrar via política de linha. Isso
 * é estritamente mais forte que o que está aqui, porque o filtro passa a ser
 * do banco: nenhum caminho de código — nem `$queryRaw`, nem `findUnique` —
 * escaparia dele. Esta última frase descreve o desenho ALTERNATIVO, não este
 * arquivo, e não foi verificada aqui: verificá-la exige ligar `FORCE ROW LEVEL
 * SECURITY` e medir contra o Postgres. É a promessa que a documentação do
 * Prisma faz, repetida como promessa — não como medição.
 *
 * Este projeto não faz assim hoje porque adotá-lo exige ligar `FORCE ROW
 * LEVEL SECURITY` e escrever políticas por tabela, e as duas coisas
 * contradizem decisões em vigor: a migração acima desliga o FORCE de
 * propósito, e a blindagem de `anon`/`authenticated` (três migrações mais o
 * e2e `tests/e2e/banco-blindado.spec.ts`) parte do princípio de que o
 * caminho do navegador chega em ZERO tabela. Mudar isso é um ciclo próprio,
 * com migração, políticas e o e2e reescrito para AFIRMAR a exceção nomeada.
 * Fica registrado aqui como caminho de endurecimento futuro — não como
 * esquecimento.
 *
 * ## Os 12 modelos de tenant
 *
 * Medido em `prisma/schema.prisma` em 2026-08-20 (`awk` sobre os blocos
 * `model`, campo `companyId`): `Membership`, `Contact`, `PipelineStage`,
 * `Lead`, `LeadNote`, `Task`, `Notification`, `AuditLog`, `Conversation`,
 * `BotConfig`, `CompanyConfig`, `WhatsappMessage`. O 12º entrou no Ciclo 1c.
 *
 * Ficam de FORA, e isso é deliberado:
 * - `User` — o comentário na linha 50 do schema diz por quê: "NÃO recebe
 *   `companyId`. A mesma pessoa pode ter `Membership` em VÁRIAS" empresas. A
 *   ligação pessoa↔empresa é o `Membership`, que É escopado.
 * - `RateLimit` — tabela global de defesa, consultada antes de existir
 *   sessão (e portanto antes de existir empresa).
 * - `Company` — é o próprio tenant; filtrar `Company.companyId` não existe.
 *
 * Operação em modelo fora dessa lista passa INTACTA. Isso é o correto e é
 * verificado no teste: injetar `where.companyId` em `User` produziria um erro
 * de coluna inexistente, não uma proteção.
 *
 * ## O que o wrapper alcança, e o que ele recusa
 *
 * **Alcança** (injeta `where.companyId` ou `data.companyId`): `findMany`,
 * `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`,
 * `updateMany`, `updateManyAndReturn`, `deleteMany`, `create`, `createMany`,
 * `createManyAndReturn`.
 *
 * `updateMany` e `updateManyAndReturn` contam nos DOIS lados, e é preciso
 * dizer isso em voz alta porque a primeira versão deste arquivo só contava um.
 * Elas escolhem linha (`where`) E gravam (`data`). Enquanto só o `where` era
 * validado, `updateMany({ where: {...}, data: { companyId: "B" } })` escolhia
 * uma linha DENTRO da empresa A e a MOVIA para a B: filtro certo, gravação
 * fora do escopo, nenhum erro. Hoje o `data` delas passa pela mesma exigência
 * de coerência do `create` — `companyId` divergente RECUSA, lançando.
 *
 * **Recusa, lançando**: `findUnique`, `findUniqueOrThrow`, `update`,
 * `delete`, `upsert`. O motivo é do Prisma, não uma escolha de gosto: o
 * `where` dessas operações é tipado como `XWhereUniqueInput` e só aceita
 * campo único (ou combinação `@@unique`). Em 10 dos 12 modelos de tenant
 * `companyId` não é único, então o Prisma recusa o campo ali — não existe onde
 * pendurar o filtro. Deixar passar sem filtro devolveria a linha de OUTRA
 * empresa a quem pedisse pelo id; lançar transforma isso em erro de
 * desenvolvimento, na hora, com o nome da operação escopável equivalente na
 * mensagem.
 *
 * **`BotConfig` e `CompanyConfig` são as exceções, e a lista já esteve errada
 * duas vezes.** Ela dizia "nenhum dos 11" enquanto `BotConfig` tinha
 * `@@unique([companyId])`; corrigida para "só `BotConfig`", ficou errada de
 * novo quando o Ciclo 1c criou `CompanyConfig` — também uma linha por empresa,
 * também com `@@unique([companyId])`. Nos dois, `XWhereUniqueInput` ACEITA
 * `companyId` (`node_modules/.prisma/client/index.d.ts`), então ali
 * `findUnique` seria escopável de verdade. O escopo recusa mesmo assim, por
 * uniformidade: uma regra "lança em `findUnique`, menos em dois modelos" é
 * regra que ninguém lembra na hora de ler o código, e `findFirst` resolve o
 * caso com a mesma consulta. O que muda é a MENSAGEM: para esses dois ela
 * seria enganosa se repetisse "o Prisma recusa o campo ali". O teste de deriva
 * de uniques (`tests/unit/escopo-empresa.test.ts`) quebra se um TERCEIRO
 * modelo ganhar `@@unique([companyId])`, e então esta frase precisa ser
 * reescrita de novo.
 *
 * **Não alcança de jeito nenhum**: `$queryRaw`/`$executeRaw`. Eles não passam
 * por `$allModels`, e por isso o lint é a peça central — é ele que garante
 * que chegar no `prisma` cru para fazer SQL exige uma exceção visível.
 *
 * Esta é afirmação sobre o CONTRATO da extensão, não medição: `$allModels`
 * alcança os delegates de modelo, e `$queryRaw` é método do cliente. Não há
 * caso de teste porque exercitá-lo deixaria uma consulta descer até o motor —
 * e o teste desta tarefa é montado justamente para que nada desça (o banco
 * falso nunca chama `query()`). Fica como o `$transaction`: dito, com a
 * origem da certeza à vista.
 *
 * **Escrita ANINHADA: metade alcançada, e a metade que falta é recusa, não
 * injeção.** `contact.create({ data: { notes: { create: [...] } } })` é UMA
 * operação aos olhos da extensão: o `$allOperations` vê `Contact.create` e
 * nunca vê o `LeadNote.create` que acontece dentro. O escopo NÃO injeta
 * `companyId` no aninhado, de propósito — a forma do payload aninhado varia
 * demais (`create`, `createMany`, linha só ou lote, com `data:` ou sem) para a
 * injeção ser sólida ali.
 *
 * O que ele faz é VARRER o `data` inteiro, em qualquer profundidade, e recusar
 * empresa divergente onde quer que apareça — no campo `companyId` (direto ou
 * `{ set }`) e na relação `company`, esta última por lista BRANCA fechada
 * (`connect: { id: <escopo> }` e nada mais; o porquê está em
 * `exigirRelacaoDeEmpresaFechada`).
 *
 * Os dois buracos da escrita aninhada ficam fechados, por vias diferentes, e
 * vale saber qual é qual:
 *
 * - aninhado que OMITE `companyId` → o BANCO recusa, porque a Task 1 do Ciclo
 *   1a tornou a coluna `NOT NULL` nos 11 modelos originais, e o 12º
 *   (`CompanyConfig`, Ciclo 1c) já nasceu `NOT NULL`. O erro vem do banco e não explica a
 *   causa; quem ler precisa saber que é esta.
 * - aninhado que passa o `companyId` de OUTRA empresa → o banco ACEITA. O
 *   campo está preenchido, o `NOT NULL` está satisfeito, e a linha nasce na
 *   empresa errada. Só a varredura pega. A versão anterior deste comentário
 *   dizia que o `NOT NULL` cobria o caso aninhado; cobria metade dele.
 *
 * A varredura é iterativa (pilha explícita, não recursão, para não estourar em
 * payload fundo), guarda os objetos já visitados num `WeakSet` (referência
 * cíclica não vira laço) e tem teto de nós — acima do teto ela LANÇA, em vez
 * de desistir calada.
 *
 * Uma versão anterior deste bloco dizia que os dois buracos estavam fechados
 * enquanto `company: { create }` e `company: { connectOrCreate }` ainda
 * passavam — o primeiro FABRICAVA uma empresa nova e gravava a linha nela.
 * Afirmação de fechamento que não é verdade é pior que a lacuna, porque
 * desliga a desconfiança de quem lê depois. Daí a lista branca: o que este
 * bloco afirma agora, afirma porque não sobrou forma por descobrir.
 *
 * ## Falsos positivos conhecidos
 *
 * A varredura confere pelo NOME do campo, e existem dois lugares onde um campo
 * chamado `companyId` NÃO grava a empresa da linha. Nos dois o escopo recusa
 * escrita legítima. Isso é escolha: os dois falham ALTO, e a alternativa —
 * uma segunda lista, de caminhos a ignorar — compraria conveniência com
 * deriva silenciosa, que é exatamente o defeito que a lista branca acima
 * acabou de fechar. A mensagem do erro nomeia os dois casos e diz o que fazer.
 *
 * 1. **Conteúdo de coluna `Json`.** `Lead.utm`, `Notification.payload`,
 *    `AuditLog.antes` e `AuditLog.depois` (`prisma/schema.prisma`) guardam
 *    documento livre. Um `auditLog.create({ data: { antes: { userId: "u1",
 *    companyId: "outra" } } })` é recusado, embora `antes` seja conteúdo e o
 *    `companyId` da LINHA venha certo do escopo. Não acontece hoje — os
 *    instantâneos de auditoria em uso não carregam `companyId` — mas o Ciclo
 *    1a acabou de criar `Membership`, e auditar mudança de vínculo ou logar
 *    corpo de webhook põe o campo lá dentro. Saída: renomear a chave dentro
 *    do Json (`empresaAlvo`, `companyIdAlvo`).
 * 2. **`where` ANINHADO dentro de `data`.** `data: { notes: { updateMany: {
 *    where: { companyId: outra } } } }` é recusado, ainda que pelo argumento
 *    deste próprio arquivo (ver `exigirCoerencia`) divergência em `where` seja
 *    inofensiva: a composição em AND devolveria vazio. A varredura não sabe
 *    que atravessou um `where` — ela vê o nome do campo. Saída: fazer a
 *    operação aninhada como chamada separada, no cliente escopado.
 *
 * ## Leitura ANINHADA: não alcança, e este é o caminho mais fácil de errar
 *
 * `include`/`select` aninhado atravessa a fronteira de empresa sem parecer uma
 * segunda consulta. Aos olhos da extensão ele não é: `$allOperations` vê UMA
 * operação (`Lead.findMany`) e o `include` desce intacto até o motor. Medido
 * em 2026-08-20 sobre o banco falso do teste: uma chamada só, `include` sem
 * nenhum filtro acrescentado.
 *
 * A regra prática é esta: **relação que fica dentro de `Company` é segura;
 * relação que passa por `User` não é.** `User` não é modelo de tenant (não tem
 * `companyId`, e o motivo está logo acima) e tem NOVE relações inversas —
 * `leadsAtribuidos`, `tasks`, `notes`, `notifications`, `auditLogs`,
 * `conversasPausadas`, `botConfigsEditadas`, `memberships`, `configsEditadas`
 * (`prisma/schema.prisma`). Eram oito até o Ciclo 1c pendurar `CompanyConfig`
 * em `User` por `atualizadoPorId` — o número aqui não é decorativo, ele conta
 * as portas de saída do tenant e envelhece a cada relação nova.
 * Atravessá-lo sai do tenant. O caminho concreto:
 *
 *   lead.findMany({ include: { responsavel: { include: { leadsAtribuidos: true } } } })
 *
 * O `findMany` de fora é escopado na empresa A. `responsavel` é um `User`, que
 * passa intacto. `leadsAtribuidos` dele devolve os leads de todas as empresas
 * em que aquela pessoa tem vínculo — isto é DEDUZIDO do schema (`User` não tem
 * `companyId`; a relação inversa não carrega filtro) e do fato, este medido,
 * de que o `include` chega intacto ao motor; não foi medido contra o Postgres,
 * o que exigiria banco vivo com duas empresas. Nada nesta extensão evita isso, e não dá
 * para consertar aqui: é inerente à extensão `query`, que enxerga a operação
 * de topo e mais nada. Quem escrever `include` através de `User` filtra à mão
 * (`leadsAtribuidos: { where: { companyId } }`) ou faz a segunda consulta
 * separada, no cliente escopado.
 *
 * ## O tipo não sabe o que o runtime faz
 *
 * Medido em 2026-08-20 com `npm run typecheck` sobre o teste desta tarefa:
 * uma extensão `query` do Prisma altera os argumentos em tempo de execução e
 * **não** altera os TIPOS deles. `prismaDaEmpresa(x).contact.create({ data:
 * { nome, telefone } })` compila com erro — `ContactCreateInput` continua
 * exigindo `companyId`, mesmo que o escopo vá injetá-lo um instante depois.
 *
 * O efeito prático é benigno, e vale dizer qual é: hoje os chamadores já
 * passam `companyId` (é o que a Task 1 tornou obrigatório), então para eles o
 * escopo age como VERIFICADOR — confere que o valor bate e recusa se não
 * bater — em vez de preenchedor. A injeção continua importando para código
 * novo escrito sem `companyId`, e é o que o teste exercita.
 *
 * Não há como corrigir isso dentro de uma extensão `query`; corrigir exigiria
 * uma fachada tipada por modelo, que é superfície própria e não cabe nesta
 * tarefa. Fica registrado, não escondido.
 *
 * ## Sem estado global, de propósito
 *
 * O `companyId` entra como parâmetro. Nada de `AsyncLocalStorage`: ele
 * funciona até o primeiro caminho que roda fora do ciclo de requisição (job
 * de fila, seed, script), que é exatamente onde ninguém está olhando quando
 * o escopo some.
 */
export class EscopoDeEmpresaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EscopoDeEmpresaError";
  }
}

/**
 * Os modelos que têm `companyId`, em PascalCase — que é como o Prisma nomeia
 * o modelo dentro de `$allOperations` (`model: "Contact"`, não `"contact"`;
 * observado na sondagem de 2026-08-20).
 */
export const MODELOS_DE_TENANT: ReadonlySet<string> = new Set([
  "Membership",
  "Contact",
  "PipelineStage",
  "Lead",
  "LeadNote",
  "Task",
  "Notification",
  "AuditLog",
  "Conversation",
  "BotConfig",
  "CompanyConfig",
  "WhatsappMessage",
]);

/** Operações cujo `where` aceita filtro comum — dá para injetar `companyId`. */
const OPERACOES_COM_WHERE = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

/**
 * Operações do grupo acima que TAMBÉM gravam. Elas escolhem linha pelo `where`
 * e mudam coluna pelo `data`, e por isso precisam das duas defesas: sem a
 * segunda, `updateMany({ data: { companyId: outra } })` passava o filtro da
 * empresa A e movia a linha para a B.
 */
const OPERACOES_COM_WHERE_QUE_GRAVAM = new Set(["updateMany", "updateManyAndReturn"]);

/** Operações que gravam linha nova — a injeção é em `data`, não em `where`. */
const OPERACOES_COM_DATA = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * Operações por chave única, e a equivalente escopável que a mensagem sugere.
 * `upsert` não tem equivalente de uma chamada só: em transação, `findFirst`
 * escopado decide entre `create` e `updateMany`.
 */
const OPERACOES_POR_CHAVE_UNICA: Record<string, string> = {
  findUnique: "findFirst",
  findUniqueOrThrow: "findFirstOrThrow",
  update: "updateMany",
  delete: "deleteMany",
  upsert: "findFirst + create/updateMany dentro de uma transação",
};

/**
 * Coerência de UM valor de `companyId` que o chamador passou explicitamente.
 *
 * ## Por que a varredura profunda existe no `data` e não existe no `where`
 *
 * Esta função olha um valor só. Quem varre em profundidade é
 * `exigirEmpresaCoerenteEmData`, e ela só é aplicada ao `data`. A assimetria é
 * deliberada, não sobra de implementação:
 *
 * - No `data`, `companyId` divergente GRAVA na empresa errada. Foi assim que
 *   `updateMany` movia linha entre empresas, e é assim que uma escrita
 *   aninhada nasce fora do tenant. Divergência ali é dano.
 * - No `where`, a injeção do escopo compõe em AND com o que o chamador mandou.
 *   `{ OR: [{ companyId: "B" }], companyId: "A" }` vira uma consulta que exige
 *   as duas coisas ao mesmo tempo e devolve vazio. Divergência aninhada no
 *   `where` é inofensiva por construção — não vaza, só não encontra nada.
 *
 *   O que está PROVADO em teste é a composição dos argumentos: o `companyId`
 *   do escopo entra no topo do `where` ao lado do que o chamador mandou (caso
 *   "OR aninhado divergente"). Que topo em AND devolva conjunto vazio é
 *   semântica documentada do Prisma/SQL, não medida aqui — medir exigiria
 *   banco vivo. A distinção importa: se algum dia essa semântica mudar, o
 *   teste continua verde e esta frase é que fica errada.
 *
 * Então: o TOPO do `where` é validado (para que o erro apareça no caso comum,
 * que é o chamador tentando escapar do escopo de propósito), e o resto dele
 * não é varrido. Isso é escolha registrada, não lacuna esquecida.
 */
function exigirCoerencia(
  campo: string,
  valor: unknown,
  companyId: string,
  onde: string,
  dica = ""
) {
  if (valor === undefined) return;
  if (valor === companyId) return;
  throw new EscopoDeEmpresaError(
    `${onde} recebeu ${campo}=${JSON.stringify(valor)}, mas o escopo é ${JSON.stringify(companyId)}. ` +
      `O escopo NÃO sobrescreve em silêncio: divergência aqui é bug ou ataque, e os dois merecem parar. ` +
      `Use o cliente da empresa certa. No TOPO de \`data\`/\`where\` dá para remover o campo e deixar ` +
      `o escopo injetar; no ANINHADO não há injeção — ver "Escrita ANINHADA" no topo deste arquivo.` +
      dica
  );
}

/**
 * A dica que acompanha as recusas em caminho ANINHADO — as de `companyId`
 * divergente E as de FORMA da relação `company`.
 *
 * O "aninhado" é condição verificada, não figura de linguagem: quem recusa
 * consulta o campo `aninhado` da varredura antes de anexar isto. No topo do
 * `data` a dica não entra, porque ali `companyId` e `company` são a coluna e a
 * relação, nunca conteúdo de Json. Uma versão anterior deste comentário
 * afirmava que a dica acompanhava "toda recusa em caminho ANINHADO" enquanto
 * NENHUMA recusa de forma a carregava e o topo a recebia — os dois sentidos
 * errados de uma vez. Hoje há caso de teste para cada uma das quatro
 * combinações (companyId/forma × aninhado/topo).
 *
 * A varredura confere pelo NOME do campo, e há três lugares onde um campo
 * chamado `companyId` ou `company` não aponta a empresa da linha — os três
 * estão na seção "Falsos positivos conhecidos" no topo do arquivo. Quem
 * esbarrar num deles precisa entender em dez segundos que topou num limite
 * conhecido do escopo, e não num vazamento; sem esta dica, a mensagem acusa
 * "bug ou ataque" a quem só escreveu um log de auditoria.
 */
const DICA_DE_FALSO_POSITIVO =
  ` Se este caminho for CONTEÚDO de coluna \`Json\` (\`Lead.utm\`, ` +
  `\`Notification.payload\`, \`AuditLog.antes\`/\`depois\`) ou um \`where\` ANINHADO, ` +
  `isto é falso positivo conhecido: a varredura confere pelo NOME do campo e não ` +
  `distingue coluna de conteúdo — vale para \`companyId\` e também para uma chave ` +
  `\`company\` que seja só descrição de empresa dentro do Json. Nesses casos nada ` +
  `grava a empresa da linha. Saída: renomeie a chave dentro do Json (\`empresaAlvo\`, ` +
  `\`companyIdAlvo\`, \`empresaDoContato\`) ou faça a operação aninhada como chamada ` +
  `separada no cliente escopado. ` +
  `Ver "Falsos positivos conhecidos" em core/tenancy/escopo.ts.`;

/**
 * A relação `company` aninhada, com lista branca FECHADA.
 *
 * A forma anterior conferia `company.connect.id` e deixava passar o resto, o
 * que era conferir FORMATO CONHECIDO num arquivo que é fecha-fechado em todo o
 * resto (operação não classificada lança; modelo fora do Set tem teste de
 * deriva). Enquanto for lista de formas conhecidas, sempre falta uma — e as
 * que faltavam não eram exóticas, eram as outras duas que o próprio Prisma
 * gera em `CompanyCreateNestedOneWithoutXInput`:
 *
 * - `connectOrCreate: { where: { id: "B" }, create: {...} }` gravava a linha
 *   aninhada na empresa B;
 * - `create: { nome: "Nova" }` FABRICAVA uma empresa nova e gravava nela;
 * - `connect: [{ id }]` (array) passava batido, porque `.id` de um array é
 *   `undefined` e `exigirCoerencia` trata `undefined` como "não passou nada".
 *
 * Agora só existe UMA forma aceita: `connect: { id: <escopo> }`, objeto
 * simples, chave única de cada lado. Isso é lista branca de verdade e não uma
 * lista de proibições, e ela é fechada porque `Company` tem `id` como ÚNICO
 * campo único (`prisma/schema.prisma`: `id String @id`, sem `@unique` em
 * `nome`, sem `@@unique`). Não existe outro jeito legítimo de apontar uma
 * empresa — então nada de legítimo cai aqui por descuido.
 */
function exigirRelacaoDeEmpresaFechada(
  valor: unknown,
  companyId: string,
  onde: string,
  caminho: string,
  aninhado: boolean
) {
  // A dica entra AQUI, e não só na recusa por divergência de valor: recusa de
  // FORMA é o caso mais provável de cair num blob Json com chave `company`, que
  // é justamente o falso positivo que a dica nomeia. Condicionada ao
  // `aninhado` pelo mesmo motivo que no ramo do `companyId` — no topo do
  // `data`, `company` é a relação, nunca conteúdo.
  const recusar = (motivo: string) => {
    throw new EscopoDeEmpresaError(
      `${onde} passou \`${caminho}\` numa forma que o escopo NÃO aceita: ${motivo}. ` +
        `Sob escopo, a única forma aceita para a relação \`company\` aninhada é ` +
        `\`company: { connect: { id: ${JSON.stringify(companyId)} } }\` — ou, mais simples, ` +
        `\`companyId: ${JSON.stringify(companyId)}\`. ` +
        `\`create\` fabricaria uma empresa NOVA e gravaria a linha nela; ` +
        `\`connectOrCreate\` gravaria na empresa do \`where\` dele. As duas passam no \`tsc\` e ` +
        `as duas saem do escopo, por isso a lista aqui é branca e fechada em vez de proibir ` +
        `forma a forma.` + (aninhado ? DICA_DE_FALSO_POSITIVO : "")
    );
  };

  if (valor === undefined) return;
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    return recusar(`esperava um objeto \`{ connect: { id } }\`, veio ${JSON.stringify(valor)}`);
  }

  const chaves = Object.keys(valor);
  if (chaves.length !== 1 || chaves[0] !== "connect") {
    return recusar(`as chaves são [${chaves.join(", ")}], e a única aceita é \`connect\``);
  }

  const conectar = (valor as Record<string, unknown>).connect;
  if (conectar === null || typeof conectar !== "object" || Array.isArray(conectar)) {
    return recusar(`\`connect\` esperava \`{ id }\`, veio ${JSON.stringify(conectar)}`);
  }

  const chavesDoConnect = Object.keys(conectar);
  if (chavesDoConnect.length !== 1 || chavesDoConnect[0] !== "id") {
    return recusar(
      `\`connect\` tem as chaves [${chavesDoConnect.join(", ")}], e \`id\` é o único campo ` +
        `único de \`Company\` — qualquer outra coisa ali não aponta empresa nenhuma`
    );
  }

  const id = (conectar as Record<string, unknown>).id;
  if (typeof id !== "string") {
    return recusar(`\`connect.id\` esperava string, veio ${JSON.stringify(id)}`);
  }
  exigirCoerencia(
    `${caminho}.connect.id`,
    id,
    companyId,
    onde,
    aninhado ? DICA_DE_FALSO_POSITIVO : ""
  );
}

/**
 * Teto de nós da varredura profunda do `data`.
 *
 * Um `create` comum tem dezenas de nós, e num lote cada elemento é varrido
 * com o orçamento inteiro — então cem mil nós em UMA linha é payload que já
 * não deveria existir. Acima do teto o escopo LANÇA, em vez de parar de olhar:
 * desistir calado devolveria exatamente o buraco que a varredura fecha, e um
 * `data` desse tamanho é mais provável ser bug ou ataque que uso legítimo.
 */
const LIMITE_DE_NOS_NA_VARREDURA = 100_000;

/**
 * `data: { companyId: { set: "..." } }` é a forma de atribuição que o Prisma
 * aceita nas operações de update; `data: { companyId: "..." }` é a forma
 * direta. As duas gravam a mesma coluna, então as duas têm de ser conferidas —
 * olhar só a direta deixaria a porta da outra aberta.
 */
function valorGravadoEmCompanyId(valor: unknown): unknown {
  if (valor !== null && typeof valor === "object" && !Array.isArray(valor) && "set" in valor) {
    return (valor as { set: unknown }).set;
  }
  return valor;
}

/**
 * Varre o `data` inteiro e RECUSA `companyId` de outra empresa em qualquer
 * profundidade. Não injeta nada no aninhado — o motivo está no topo do
 * arquivo, seção "Escrita ANINHADA".
 *
 * Iterativa de propósito (pilha explícita): payload fundo não estoura pilha de
 * chamada. `WeakSet` de visitados: referência cíclica não vira laço infinito.
 * Teto de nós: payload absurdo lança em vez de travar o processo.
 */
function exigirEmpresaCoerenteEmData(dado: unknown, companyId: string, onde: string) {
  const pilha: { valor: unknown; caminho: string; aninhado: boolean }[] = [
    { valor: dado, caminho: "data", aninhado: false },
  ];
  const visitados = new WeakSet<object>();
  let nos = 0;

  while (pilha.length > 0) {
    const atual = pilha.pop()!;
    const { valor, caminho, aninhado } = atual;

    if (valor === null || typeof valor !== "object") continue;
    // `Date`, `Buffer`, `Decimal` e afins são valores, não estrutura: descer
    // neles só gasta orçamento e nunca encontra um `companyId`.
    if (valor instanceof Date || ArrayBuffer.isView(valor)) continue;
    if (visitados.has(valor)) continue;
    visitados.add(valor);

    if (++nos > LIMITE_DE_NOS_NA_VARREDURA) {
      throw new EscopoDeEmpresaError(
        `${onde} passou um \`data\` com mais de ${LIMITE_DE_NOS_NA_VARREDURA} nós, e o escopo ` +
          `${JSON.stringify(companyId)} não consegue conferir a empresa nele por inteiro. ` +
          `Quebre o lote em pedaços menores. ` +
          `Passar sem conferir seria vazamento silencioso entre empresas.`
      );
    }

    if (Array.isArray(valor)) {
      for (let i = 0; i < valor.length; i += 1) {
        pilha.push({ valor: valor[i], caminho: `${caminho}[${i}]`, aninhado });
      }
      continue;
    }

    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      const caminhoFilho = `${caminho}.${chave}`;

      if (chave === "companyId") {
        // A dica de falso positivo só acompanha caminho ANINHADO: no topo do
        // `data`, `companyId` é sempre a coluna, e nunca conteúdo de Json nem
        // `where` — dizer o contrário ali seria ruído em cima do caso comum.
        exigirCoerencia(
          caminhoFilho,
          valorGravadoEmCompanyId(filho),
          companyId,
          onde,
          aninhado ? DICA_DE_FALSO_POSITIVO : ""
        );
        continue;
      }

      if (chave === "company") {
        exigirRelacaoDeEmpresaFechada(filho, companyId, onde, caminhoFilho, aninhado);
        continue;
      }

      pilha.push({ valor: filho, caminho: caminhoFilho, aninhado: true });
    }
  }
}

function injetarEmData(dado: unknown, companyId: string, onde: string): unknown {
  if (dado === null || typeof dado !== "object") return dado;
  const registro = dado as Record<string, unknown>;

  // `data: { company: { connect: { id } } }` é a forma por relação. O Prisma
  // recusa `companyId` e `company` juntos no mesmo `data`, então injetar aqui
  // trocaria um erro de escopo por um erro obscuro do Prisma. Lançar com nome
  // próprio é mais útil que isso.
  if ("company" in registro) {
    throw new EscopoDeEmpresaError(
      `${onde} passou a relação \`company\` em \`data\`. Sob escopo, a empresa vem do cliente ` +
        `(${JSON.stringify(companyId)}) — remova \`company\` e deixe o escopo injetar ` +
        `\`companyId\`.`
    );
  }

  // A varredura começa no topo, então ela cobre `data.companyId` E qualquer
  // `companyId` aninhado. Não existe mais uma conferência do topo em separado:
  // duas passagens sobre a mesma coisa só criariam a chance de uma delas ficar
  // para trás numa edição futura.
  exigirEmpresaCoerenteEmData(registro, companyId, onde);
  return { ...registro, companyId };
}

/**
 * A decisão inteira do escopo, isolada da extensão do Prisma: recebe a
 * operação e devolve os argumentos a passar adiante — ou LANÇA.
 *
 * ## Por que isto é exportado
 *
 * Por causa do teste, e vale dizer o motivo em vez de deixar parecendo
 * superfície aberta à toa. O ramo fecha-fechado do `default` — operação de
 * modelo de tenant que este arquivo não classifica — é INALCANÇÁVEL pelo
 * cliente Prisma: medido em 2026-08-20 no Prisma 7.9.1 desta árvore,
 * `typeof prisma.contact.operacaoInventada` sai `undefined`. O delegate só
 * expõe as operações que o runtime conhece, e uma inventada nunca desce até
 * `$allOperations`. Sem esta porta, o único ramo que existe justamente para o
 * dia em que o Prisma acrescentar uma operação seria o único ramo sem teste.
 */
export function escoparArgumentos(
  model: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  companyId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!MODELOS_DE_TENANT.has(model)) return args;

  const onde = `${model}.${operation}`;
  const argumentos = args ?? {};

  if (OPERACOES_COM_WHERE.has(operation)) {
    exigirCoerencia("where.companyId", argumentos.where?.companyId, companyId, onde);

    // As que também gravam conferem o `data` com o mesmo rigor do `create`.
    // Conferem e NÃO injetam: a linha já está na empresa por força do `where`,
    // então escrever a coluna de novo seria gravação que ninguém pediu.
    if (OPERACOES_COM_WHERE_QUE_GRAVAM.has(operation)) {
      const dados = argumentos.data;
      if (Array.isArray(dados)) {
        for (const d of dados) exigirEmpresaCoerenteEmData(d, companyId, onde);
      } else {
        exigirEmpresaCoerenteEmData(dados, companyId, onde);
      }
    }

    return { ...argumentos, where: { ...(argumentos.where ?? {}), companyId } };
  }

  if (OPERACOES_COM_DATA.has(operation)) {
    const dados = argumentos.data;
    return {
      ...argumentos,
      data: Array.isArray(dados)
        ? dados.map((d: unknown) => injetarEmData(d, companyId, onde))
        : injetarEmData(dados, companyId, onde),
    };
  }

  const equivalente = OPERACOES_POR_CHAVE_UNICA[operation];
  if (equivalente) {
    throw new EscopoDeEmpresaError(
      `${onde} não é escopável por empresa no escopo ${JSON.stringify(companyId)}: o \`where\` ` +
        `dela só aceita campo único, e \`companyId\` não é único em ${model} — o Prisma recusa ` +
        `o campo ali. (Exceções conhecidas: \`BotConfig\` e \`CompanyConfig\` têm ` +
        `\`@@unique([companyId])\`, então lá o campo seria aceito; o escopo recusa mesmo assim, ` +
        `por uniformidade — ver o bloco "Recusa, lançando" em core/tenancy/escopo.ts.) ` +
        `Use \`${equivalente}\` no cliente escopado. ` +
        `Devolver a linha sem filtro entregaria dado de outra empresa a quem soubesse o id.`
    );
  }

  // Fecha fechado: operação de modelo que este arquivo não classificou
  // (o Prisma pode acrescentar uma) para em vez de passar sem filtro.
  throw new EscopoDeEmpresaError(
    `${onde} é uma operação que o escopo de empresa ${JSON.stringify(companyId)} ainda não ` +
      `classifica. Classifique-a em core/tenancy/escopo.ts antes de usá-la — passar sem filtro ` +
      `seria vazamento silencioso entre empresas.`
  );
}

/**
 * Devolve um cliente Prisma que só enxerga (e só grava em) `companyId`.
 *
 * O segundo parâmetro existe por dois motivos, nesta ordem de importância:
 * dentro de `$transaction` o cliente é o `tx`, não o global (mesmo padrão de
 * `companyIdDoUsuario` em `core/users/empresa.ts`); e ele é o que permite ao
 * teste unitário montar um banco falso por baixo sem abrir conexão. Em código
 * de produção normal, omita-o.
 *
 * ## O `tx` de `$transaction` CARREGA a extensão — o que foi medido, e o que não
 *
 * Verificado em 2026-08-20 no `@prisma/client` 7.9.1 desta árvore, por duas
 * vias. Na leitura do runtime: `_transactionWithCallback` monta o cliente
 * interativo por `this._createItxClient(...)`, e `_createItxClient` REAPLICA
 * as extensões sobre o cliente da transação. No exercício: essa mesma fábrica,
 * chamada sobre um cliente já escopado com o banco falso do teste por baixo,
 * registrou `{"model":"Contact","operation":"findMany","args":{"where":
 * {"companyId":"cmp_a"}}}` — o `companyId` entrou antes de a operação chegar
 * ao motor.
 *
 * A ressalva honesta: o que foi exercitado é a FÁBRICA do cliente interativo,
 * não um `$transaction()` de ponta a ponta contra o Postgres — esse continua
 * exigindo banco vivo, e nenhum teste desta tarefa toca banco. Então o caminho
 * curto (`prismaDaEmpresa(id).$transaction(cb)`) tem evidência, e o contorno
 * (`prismaDaEmpresa(id, tx)` dentro do callback) continua sendo o que não
 * depende de evidência nenhuma.
 *
 * A extensão devolvida é a MAIS EXTERNA da cadeia: medido em 2026-08-20 no
 * Prisma 7.9.1 desta árvore, em `cliente.$extends(A).$extends(B)` a extensão
 * A roda primeiro e só alcança B se chamar `query()`. Quem estender o
 * resultado desta função depois fica POR DENTRO do escopo — que é a ordem
 * desejada, e a que o teste usa.
 */
export function prismaDaEmpresa(companyId: string, cliente: PrismaClient = prisma) {
  if (!companyId) {
    throw new EscopoDeEmpresaError(
      "prismaDaEmpresa() recebeu companyId vazio. A origem é `UsuarioAtivo.companyId` " +
        "(core/auth/usuario-ativo.ts) — nunca `prisma.company.findFirst()`."
    );
  }

  return cliente.$extends({
    // Nome CONSTANTE, não `escopo-empresa:${companyId}`. O `companyId` no
    // nome ajudaria a ler um stack trace, mas geraria um nome distinto por
    // empresa e por requisição, e o Prisma não documenta o que faz com nomes
    // de extensão além de exibi-los — inventar cardinalidade infinita numa
    // string que não controlamos não vale o ganho de leitura. Quem precisa do
    // valor tem a mensagem do `EscopoDeEmpresaError`: TODA mensagem lançada
    // com escopo ativo carrega o `companyId`, e há caso de teste varrendo os
    // seis caminhos de lançamento para provar isso. A única exceção é o erro
    // de `companyId` vazio, lançado antes de existir escopo — e ele é exceção
    // nomeada no mesmo teste. Auditando esta frase foi que se descobriu que
    // quatro das mensagens NÃO o carregavam; elas foram corrigidas, e não a
    // frase.
    name: "escopo-empresa",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // A decisão inteira mora em `escoparArgumentos`, fora da extensão,
          // para que ela seja testável sem o delegate do Prisma no caminho.
          return query(escoparArgumentos(model, operation, args, companyId));
        },
      },
    },
  });
}
