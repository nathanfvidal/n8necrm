// Este script grava no mesmo Postgres do Supabase usado pelos testes que
// tocam banco (tests/unit/rate-limit.test.ts, tests/unit/audit-log.test.ts) e
// pelo app em dev — carrega DATABASE_URL do .env aqui, e não em
// vitest.config.ts, pelo mesmo motivo documentado lá: não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// src/lib/prisma.ts → src/lib/env.ts lê process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import crypto from "node:crypto";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";
import { client } from "../config/client";
import { botConfig } from "../config/bot";
import { ID_SISTEMA_WHATSAPP } from "../src/core/users/sistema";

// Id estável e legível (não um cuid gerado) — Fatia 1 do WhatsApp
// (AuditLog.userId é FK obrigatória para User) precisa referenciar este
// usuário por id fixo de dentro de src/modules/whatsapp/, sem depender de
// buscar por e-mail a cada gravação de auditoria.
//
// A constante mora em `src/core/users/sistema.ts`, não aqui, desde que a tela
// de gestão de usuários passou a existir: ela precisa saber quais linhas de
// `User` são contas de sistema para nunca oferecê-las a um ADMIN humano. A
// direção do import é esta e não a inversa porque este arquivo é um SCRIPT
// com efeito colateral de topo (`dotenv/config`, e a chamada de `seed()` lá
// embaixo) — importá-lo a partir da aplicação arrastaria tudo isso para o
// bundle. `sistema.ts` não importa nada, então vem para cá sem custo.
//
// Reexportado com o nome antigo porque `tests/unit/seed.test.ts` o consome
// daqui.
export const WHATSAPP_SYSTEM_USER_ID = ID_SISTEMA_WHATSAPP;

// Prisma 7 exige um driver adapter (ver node_modules/.prisma/client/index.d.ts:
// "A driver adapter is **required**"). `new PrismaClient()` sem adapter não
// funciona mais — por isso reusamos o client singleton de src/lib/prisma.ts
// (adapter-pg já configurado) em vez de instanciar um novo aqui.

// Minúsculas: é a única escrita de `cor` do sistema que não passa pela
// normalização de `etapaSchema` (`core/pipeline/schema.ts`, que faz
// `toLowerCase()` antes do regex `/^#[0-9a-f]{6}$/`) — este seed grava direto
// no Prisma, sem passar pelo schema. Sem isto, uma etapa semeada e outra
// criada pela tela com a "mesma" cor divergiriam por caixa (`#94A3B8` vs
// `#94a3b8`), quebrando qualquer comparação por igualdade de string.
const CORES = ["#94a3b8", "#60a5fa", "#fbbf24", "#f97316", "#22c55e"];

/**
 * Seed determinístico do funil, dos usuários de exemplo e de alguns leads.
 *
 * Precisa ser seguro para rodar mais de uma vez contra o Postgres
 * compartilhado (dev, verificação manual, CI) — sem duplicar linhas e sem
 * quebrar por causa de foreign key. Por isso:
 *
 * - PipelineStage: `client.funil` só semeia a tabela vazia (primeira
 *   instalação) — depois disso quem manda é o banco, porque `/etapas`
 *   (ADMIN) cria, renomeia, recolore, reordena e remove etapa, e este seed
 *   nunca mais toca numa etapa que já existe. `Lead.stageId` é `ON DELETE
 *   RESTRICT` (ver prisma/migrations/20260730211315_init/migration.sql), o
 *   que já bastava para o seed nunca apagar etapa — mas o motivo de não
 *   reconciliar não é técnico, é de propriedade: a tela é dona do funil, o
 *   seed é só a semente. O seed confere explicitamente que exatamente 1
 *   etapa ficou com `ehGanho: true` (fix round 1/5: encolher o funil sem
 *   isso deixava a etapa removida órfã com `ehGanho: true` para sempre,
 *   fazendo `ehGanho` apontar para duas etapas ao mesmo tempo).
 * - CompanyConfig: uma linha por empresa, criada só quando não existe
 *   (`Company` não tem chave natural, então também não há `upsert` aqui). Nasce
 *   com `modulos` e com as colunas de marca NULAS — ver o comentário no corpo.
 * - User: upsert por `email` (único no schema). `senhaHash` só é regravado
 *   numa reexecução quando `SEED_PASSWORD` está explicitamente definida (ver
 *   comentário junto a `senhaPlanoExplicita` abaixo) — fix round 1/5: antes
 *   `update: {}` nunca regravava o hash, então `SEED_PASSWORD` definida
 *   depois do primeiro seed não tinha efeito nenhum e a senha antiga
 *   continuava válida.
 * - Contact: upsert por `[companyId, telefone]` (a chave composta do Ciclo 1e).
 * - Lead: não tem chave natural única no schema. Para não duplicar a cada
 *   execução, só cria um Lead para o contato se ainda não existir nenhum
 *   apontando para ele.
 */
export async function seed(): Promise<void> {
  // Empresa única do Ciclo 1a (a UI continua servindo uma empresa só — ver
  // decisão 4 do spec de tenancy). `Company` não tem chave natural (nome não
  // é `@unique` no schema — duas empresas podem legitimamente ter o mesmo
  // nome), então não dá para fazer `upsert`. A idempotência aqui é "existe
  // alguma? usa essa. não existe nenhuma? cria UMA" — mesmo padrão do funil
  // logo abaixo (`quantasEtapasExistem === 0`): sem isso, rodar o seed duas
  // vezes criaria uma segunda empresa a cada execução.
  const empresaExistente = await prisma.company.findFirst();
  const empresa = empresaExistente ?? (await prisma.company.create({ data: { nome: client.nome } }));

  // A configuração por empresa nasce com os MÓDULOS e SÓ com eles.
  //
  // Mesma regra de instalação de `semearBotConfig` e do funil logo abaixo:
  // existe? deixa como está. Não existe? cria UMA. O seed é SEMENTE, não
  // reconciliador — o `upsert` por `ordem` que morava aqui para as etapas virou
  // destrutivo no dia em que `/etapas` existiu, renomeando etapa criada pela
  // tela. `tests/unit/seed.test.ts` ("é idempotente na config") grava uma cor
  // entre duas execuções e exige que ela sobreviva à segunda.
  //
  // As colunas de MARCA ficam NULAS de propósito, e nulo significa "não decidi,
  // usa o padrão de config/client.ts" (`mesclarConfig`, em
  // src/core/config/schema.ts, sobrepõe campo a campo e ignora nulo). A decisão
  // 8 do spec do programa mantém a identidade do produto EM ABERTO; gravar a
  // cor atual do arquivo aqui congelaria essa não-decisão no banco, e a partir
  // daí editar o arquivo deixaria de ter efeito para esta empresa, em silêncio.
  //
  // `modulos` é diferente porque não TEM estado nulo: lista escalar no Prisma
  // nunca é nula (citação do client gerado em `LinhaDeConfig`,
  // src/core/config/schema.ts), e por isso a regra dela é "se a linha existe,
  // ela manda". Semear com `client.modulos` mantém o comportamento idêntico ao
  // de antes deste ciclo e é o que põe o caminho de banco em uso de verdade na
  // aplicação — em vez de deixar uma tabela criada e nunca lida.
  //
  // `findUnique` por `companyId`, e não `findFirst`: `@@unique([companyId])` no
  // schema faz do campo uma chave única aos olhos do Prisma — é a mesma leitura
  // que `semearBotConfig` faz sobre a mesma constraint, lá embaixo.
  const configExistente = await prisma.companyConfig.findUnique({
    where: { companyId: empresa.id },
    select: { id: true },
  });
  if (!configExistente) {
    await prisma.companyConfig.create({
      data: { companyId: empresa.id, modulos: [...client.modulos] },
    });
  }

  // O funil só nasce do config na PRIMEIRA vez. Depois disso quem manda é o
  // banco, porque `/etapas` (ADMIN) cria, renomeia, recolore, reordena e
  // remove etapa.
  //
  // O `upsert` por `ordem` que morava aqui reconciliava a tabela com
  // `client.funil` a cada execução — e passou a ser destrutivo no dia em que a
  // tela existiu: renomearia "Negociação" para "Fechado" e recoloriria por
  // índice. `client.funil` virou SEMENTE de instalação, e é isso que permite
  // um fork nascer com o funil dele.
  // SEM `where: { companyId }`, e isso é dívida DECLARADA, não esquecimento:
  // ⚠️ D2-a do spec do Ciclo 1e (§4.2.1, item 7). Este seed cria/encontra UMA
  // empresa (`empresaExistente ?? create` acima), então "existe etapa no
  // banco?" e "existe etapa desta empresa?" são hoje a mesma pergunta. No dia
  // em que o seed semear uma segunda empresa, ele pulará o funil dela — e é
  // esse dia o gatilho para escopar aqui.
  const quantasEtapasExistem = await prisma.pipelineStage.count();
  if (quantasEtapasExistem === 0) {
    for (const [index, nome] of client.funil.entries()) {
      await prisma.pipelineStage.create({
        data: {
          companyId: empresa.id,
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

  // "senha123" é um literal público (está no repo). Nada nesta função
  // detecta com segurança se DATABASE_URL aponta pro Postgres real de um
  // cliente em produção — não há trigger automático de seed em nenhum
  // script (postinstall só roda `prisma generate`), e checar NODE_ENV não
  // serve: o próprio plano deste seed é dobrar como demo pra prospects, e
  // uma demo rodando via `next start` também tem NODE_ENV=production, então
  // bloquear por isso quebraria o caso de uso que o seed precisa suportar.
  // A mitigação cabível aqui é dar um jeito barato de trocar a senha sem
  // tocar em código: SEED_PASSWORD, com o literal documentado como
  // fallback (mantém dev/demo/testes funcionando sem configuração extra).
  //
  // `senhaPlanoExplicita` (fix round 1/5): distinguimos "SEED_PASSWORD não
  // foi definida" de "foi definida com algum valor". Só regravamos
  // `senhaHash` numa reexecução quando a variável foi explicitamente
  // passada — o objetivo é rotacionar a senha de verdade quando alguém pede
  // isso deliberadamente, sem reescrever o hash (com salt novo, toda vez)
  // numa reexecução comum onde ninguém pediu troca nenhuma.
  //
  // `|| undefined`, não `??` (incidente registrado em
  // docs/auditorias/2026-08-19-ciclo-0-fundacao.md): uma `SEED_PASSWORD=""`
  // deixada num `.env` preenchido pela metade chega como string vazia
  // DEFINIDA, e `??` só cai no fallback para `null`/`undefined` — o admin
  // nasceria com `bcrypt("")` e uma reexecução de rotina regravaria a senha
  // já rotacionada por esse hash. String vazia vinda do ambiente precisa
  // contar como "não definida", nunca como "senha vazia deliberada".
  const senhaPlanoExplicita = process.env.SEED_PASSWORD || undefined;
  const senhaPlano = senhaPlanoExplicita ?? "senha123";
  const senhaHash = await bcrypt.hash(senhaPlano, 10);
  const atualizarSenhaNaReexecucao = senhaPlanoExplicita !== undefined;

  // O papel vai SÓ para `vincularAEmpresa`, que grava no `Membership`. A
  // coluna espelho `User.papel` foi escrita aqui em dual-write entre
  // 2026-08-19 e 2026-08-21, como ponte para leitores que o DROP do Ciclo 1a
  // revelou tarde demais; o Ciclo 1f migrou todos e o seed é o último escritor
  // a sair, junto com `core/users/service.ts`. O vínculo é a única fonte, e é
  // de lá que aquele módulo e `usuarioAtual()` leem.
  const admin = await prisma.user.upsert({
    where: { email: "admin@exemplo.com" },
    update: atualizarSenhaNaReexecucao ? { senhaHash } : {},
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash },
  });
  await vincularAEmpresa(admin.id, empresa.id, "ADMIN");

  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@exemplo.com" },
    update: atualizarSenhaNaReexecucao ? { senhaHash } : {},
    create: { nome: "Vendedor Exemplo", email: "vendedor@exemplo.com", senhaHash },
  });
  await vincularAEmpresa(vendedor.id, empresa.id, "VENDEDOR");

  await semearUsuarioSistemaWhatsapp(empresa.id);
  await semearBotConfig(empresa.id);

  // `where: { companyId }`, e não a etapa de menor `ordem` do banco inteiro:
  // desde o Ciclo 1e a `ordem` é única POR EMPRESA, então "a menor do banco"
  // deixou de coincidir com "a menor desta empresa". Sem o filtro, os leads de
  // demonstração nasceriam na etapa de outra empresa no dia em que existir uma.
  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({
    where: { companyId: empresa.id },
    orderBy: { ordem: "asc" },
  });

  const nomes = ["Carlos Silva", "Fernanda Lima", "João Pereira", "Marina Costa"];
  for (let i = 0; i < nomes.length; i++) {
    const contact = await prisma.contact.upsert({
      // `companyId_telefone`, e não `telefone`: desde o Ciclo 1e a chave única
      // é composta (`@@unique([companyId, telefone])`), e o `telefone` sozinho
      // deixou de existir em `ContactWhereUniqueInput`. Prisma cru aqui é
      // legítimo — `prisma/seed*.ts` está fora do alcance da catraca por
      // decisão escrita (`tests/unit/catraca-prisma-cru.test.ts:71`).
      where: { companyId_telefone: { companyId: empresa.id, telefone: `1199999000${i}` } },
      update: {},
      create: { companyId: empresa.id, nome: nomes[i], telefone: `1199999000${i}` },
    });

    const leadExistente = await prisma.lead.findFirst({ where: { contactId: contact.id } });
    if (!leadExistente) {
      await prisma.lead.create({
        data: {
          companyId: empresa.id,
          contactId: contact.id,
          stageId: primeiraEtapa.id,
          responsavelId: i % 2 === 0 ? admin.id : vendedor.id,
          canal: "MANUAL",
        },
      });
    }
  }

  console.log("Seed concluído.");
}

/**
 * Cria (ou confirma) o `Membership` de um usuário com a empresa semeada, com
 * o `papel` que o chamador passa. O vínculo é a ÚNICA fonte do papel, então
 * quem chama esta função decide o literal, em vez de reler a linha de `User`.
 *
 * A coluna `User.papel` foi derrubada no Ciclo 1a e RESTAURADA no mesmo ciclo,
 * quando o DROP revelou leitores tarde demais; este docstring afirmava que ela
 * já não existia e ficou errado nesse intervalo. Desde o Ciclo 1f nada mais a
 * escreve — nem este arquivo, nem `core/users/service.ts` — e ela sai do
 * schema ainda neste ciclo.
 *
 * `upsert` por `userId_companyId` (a chave de `@@unique([userId, companyId])`)
 * em vez de "existe? não cria de novo": mesma forma que o resto deste arquivo
 * usa para idempotência, e cobre o caso de alguém rodar o seed depois de MUDAR
 * `papel` no código de um usuário de exemplo — o vínculo acompanha.
 */
async function vincularAEmpresa(userId: string, companyId: string, papel: "ADMIN" | "GESTOR" | "VENDEDOR"): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_companyId: { userId, companyId } },
    update: { papel },
    create: { userId, companyId, papel },
  });
}

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
async function confirmarInvarianteEhGanho(): Promise<void> {
  const etapasGanhas = await prisma.pipelineStage.count({ where: { ehGanho: true } });
  if (etapasGanhas !== 1) {
    throw new Error(
      `Invariante violada: esperava exatamente 1 PipelineStage com ehGanho=true, encontrei ${etapasGanhas}. ` +
        `Task 20 calcula a taxa de conversão a partir dessa flag — não é seguro continuar o seed assim.`
    );
  }
}

/**
 * Semeia o "usuário sistema" que o atendente de WhatsApp (Fatia 1) usa como
 * `userId` de `AuditLog` para ações que ele mesmo executa — a FK de
 * `AuditLog.userId` é obrigatória (não aceita NULL), e não faz sentido
 * atribuir uma resposta gerada por IA a um vendedor humano específico.
 *
 * `ativo: false` é a defesa real: `usuarioAtual()` (core/auth/session.ts)
 * rejeita qualquer usuário com `ativo: false` a cada chamada, e o
 * `Credentials.authorize()` do Auth.js (src/lib/auth.ts) também checa
 * `ativo` no momento do login — então este usuário nunca consegue autenticar
 * nem manter uma sessão, mesmo que alguém descubra o e-mail e tente a senha
 * (que nem sequer é conhecida por ninguém: ver `senhaHash` abaixo). E-mail
 * num TLD que não resolve (`.invalid`, reservado pela RFC 2606
 * especificamente para isso) evita que "esqueci minha senha" ou qualquer
 * fluxo futuro de e-mail transacional tente entregar algo a um endereço que
 * poderia, por acidente, existir de verdade.
 *
 * A senha gravada é um hash de bytes aleatórios descartados na hora — nunca
 * armazenados, nunca logados, nunca reutilizáveis por ninguém (nem por quem
 * rodou o seed): só o hash bcrypt sobrevive, e um hash bcrypt não permite
 * recuperar a senha original. Isso é deliberadamente diferente do padrão
 * `SEED_PASSWORD`/"senha123" usado para `admin`/`vendedor` acima — aqueles
 * dois são contas de demonstração, feitas para login real; esta não é.
 *
 * Upsert por `id` fixo (`WHATSAPP_SYSTEM_USER_ID`), não por `email` como o
 * resto deste arquivo: o e-mail não muda entre execuções, mas não há
 * necessidade de reler/comparar nada nele — o id fixo já garante
 * idempotência, e mantém o `senhaHash` (que muda a cada execução, já que os
 * bytes são novos toda vez) fora do caminho de update, evitando invalidar
 * silenciosamente algo que dependesse dele permanecer estável entre
 * execuções (nada depende hoje, mas não há motivo para reescrever à toa).
 */
async function semearUsuarioSistemaWhatsapp(companyId: string): Promise<void> {
  const existente = await prisma.user.findUnique({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
  if (existente) {
    // Já existia (banco semeado antes desta tarefa, por exemplo): ainda
    // assim precisa ter Membership, senão vira o único User sem vínculo —
    // exatamente o estado que `usuarioAtual()` trata como sessão inválida.
    // Este usuário nunca autentica (ver `ativo: false` abaixo), mas ficar sem
    // Membership o deixaria fora da invariante que a migração da Task 2
    // conferiu antes de derrubar `User.papel`. "ADMIN" é literal, não lido de
    // `existente.papel` — mesmo a coluna tendo sido restaurada (dual-write,
    // ver comentário acima), este sistema sempre foi ADMIN (docstring da
    // constante em `sistema.ts`), e não há motivo para reler o que já se sabe.
    await vincularAEmpresa(existente.id, companyId, "ADMIN");
    return;
  }

  const senhaAleatoriaDescartada = crypto.randomBytes(32).toString("hex");
  const senhaHash = await bcrypt.hash(senhaAleatoriaDescartada, 10);

  const sistema = await prisma.user.create({
    data: {
      id: WHATSAPP_SYSTEM_USER_ID,
      nome: "Atendente WhatsApp (sistema)",
      email: "whatsapp-bot@sistema.invalid",
      senhaHash,
      ativo: false,
    },
  });
  await vincularAEmpresa(sistema.id, companyId, "ADMIN");
}

/**
 * Semeia a linha de `BotConfig` DESTA empresa a partir de `config/bot.ts`.
 *
 * Cria se não existe (para esta `companyId`); NUNCA atualiza. O seed roda em
 * todo deploy — um upsert aqui desfaria, silenciosamente, toda edição feita
 * pelo CRM desde o deploy anterior. Mesmo raciocínio de
 * `semearUsuarioSistemaWhatsapp` logo acima, e deliberadamente DIFERENTE do
 * upsert usado para `PipelineStage`: aquelas são estrutura definida pelo
 * fork, esta é conteúdo editável pelo usuário.
 *
 * Busca por `companyId` (a chave de `@@unique([companyId])`), não mais por
 * `id` — `BotConfig.id` deixou de ter valor constante nesta tarefa (Ciclo 1a:
 * config por empresa quebra o truque de linha única por PK fixa). `BOT_CONFIG_ID`
 * de `config/bot.ts` não é mais lido aqui.
 *
 * Para voltar ao conteúdo do arquivo existe um caminho explícito: o botão
 * "voltar ao padrão do fork" na tela do agente.
 */
export async function semearBotConfig(companyId: string): Promise<void> {
  const existente = await prisma.botConfig.findUnique({ where: { companyId } });
  if (existente) return;

  await prisma.botConfig.create({
    data: {
      companyId,
      personaNome: botConfig.persona.nome,
      personaPapel: botConfig.persona.papel,
      regras: botConfig.regras,
      faq: botConfig.faq,
    },
  });
}

// O Vitest define process.env.VITEST em todo processo de teste. Sem essa
// guarda, importar `seed` a partir de um arquivo de teste (para testar
// idempotência chamando a função diretamente) disparava também esta
// invocação de topo de arquivo, rodando o seed uma vez a mais — e
// desconectando o client compartilhado no meio da suíte.
if (!process.env.VITEST) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
