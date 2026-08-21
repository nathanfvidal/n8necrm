-- Ciclo 1a, Task 1: Company, Membership, e companyId nas tabelas de tenant.
--
-- O banco em que isto roda TEM DADOS (4 User, 4 Contact, 4 PipelineStage,
-- 4 Lead, 2 AuditLog, 1 BotConfig -- medido antes desta migração). Por isso a
-- ORDEM abaixo não é estilo, é a única sequência que não quebra:
--
--   1. Criar "Company" e "Membership" (tabelas novas -- NOT NULL sem DEFAULT
--      é seguro aqui: não há linha antiga nem código antigo inserindo nelas).
--   2. Inserir UMA "Company" para os dados que já existem.
--   3. Inserir um "Membership" por "User" existente, COPIANDO "User"."papel"
--      -- antes de qualquer coisa depender do vínculo existir. "User"."papel"
--      NÃO é derrubada aqui (ver o comentário grande mais abaixo, antes do
--      bloco de "BotConfig").
--   4. Acrescentar "companyId" NULLABLE nas tabelas de tenant -- uma coluna
--      NOT NULL de uma vez numa tabela com linhas falha.
--   5. Preencher "companyId" com o id da empresa criada no passo 2.
--   6. só então "SET NOT NULL" + FK + índice.
--
-- Passo 6 também recebe um "SET DEFAULT" (para o id da mesma empresa) em cada
-- coluna "companyId" de tabela pré-existente. Não é redundante com o UPDATE
-- do passo 5: este banco e a aplicação NÃO sobem juntos (mesma premissa do
-- incidente documentado em
-- prisma/migrations/20260813210000_contato_atualizadoem_com_default -- ver
-- também tests/unit/migracoes-seguras.test.ts, que trava esta regra). Entre
-- esta migração ser aplicada e o deploy do código novo sair, o código ANTIGO
-- continua rodando e inserindo Contact/Lead/etc. SEM saber que "companyId"
-- existe. Sem DEFAULT, todo INSERT desse código antigo, nessa janela, morre
-- com 23502 -- exatamente o incidente que o teste acima existe para não
-- deixar se repetir.

-- ============================================================================
-- Passo 1: CREATE TABLE "Company" e "Membership".
-- ============================================================================

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "papel" "Role" NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");

-- CreateIndex
-- "usuarioAtual()" busca por userId em toda requisição (Task 2 deste ciclo).
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_companyId_idx" ON "Membership"("companyId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS e grants nas duas tabelas novas -- mesmo raciocínio de DUAS CAMADAS
-- INDEPENDENTES de
-- prisma/migrations/20260730212500_enable_rls_and_revoke_anon_grants:
--
--   1. ENABLE ROW LEVEL SECURITY sem política nenhuma -> default-deny para
--      todo papel que não seja o dono da tabela. O gatilho `rls_auto_enable()`
--      da plataforma já faz isto sozinho a cada CREATE TABLE em `public`
--      (confirmado lendo `pg_proc` antes de escrever esta migração) -- o
--      ENABLE explícito abaixo é redundante com ele, de propósito: não faz
--      sentido este arquivo depender silenciosamente de um gatilho que vive
--      fora dele para a garantia mais importante da migração.
--   2. REVOKE do que o Supabase concede por padrão a anon/authenticated. O
--      gatilho de RLS NÃO revoga grant -- só liga RLS -- e
--      20260813180000_blindar_privilegios_padrao já revogou os PRIVILÉGIOS
--      PADRÃO de tabela futura, então o REVOKE abaixo deveria ser um no-op
--      (nada para revogar). Fica explícito mesmo assim: a proteção real desta
--      migração é a SOMA das duas camadas, não a expectativa de que a
--      migração de agosto continue configurada do jeito que está.
--
-- Nenhuma política é criada -- decisão do spec (Ciclo 1a, seção 6): nada
-- nestas tabelas é servido pelo caminho anon/authenticated do PostgREST hoje.
-- ============================================================================

-- CreateRLS
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;

-- RevokeAnonAndAuthenticatedGrants
REVOKE ALL ON TABLE "Company" FROM anon, authenticated;
REVOKE ALL ON TABLE "Membership" FROM anon, authenticated;

-- ============================================================================
-- Passo 2 e 3: uma Company para os dados existentes, um Membership por User
-- existente copiando o papel.
-- ============================================================================
--
-- O id 'company-migracao-1a' é um literal escolhido à mão, não um cuid() --
-- este INSERT roda em SQL puro, fora do Prisma Client (que é quem gera cuid()
-- nas escritas normais da aplicação). Nada no banco exige formato de cuid na
-- coluna "id" (é só TEXT); o literal é deliberadamente diferente da forma de
-- um cuid para ficar óbvio, em qualquer consulta futura, que esta linha
-- nasceu de uma migração e não de `prisma.company.create()`.
--
-- "nome" usa o mesmo valor de `client.nome` (config/client.ts) -- é a mesma
-- identidade de produto que já nomeia este fork; não inventar um nome novo
-- para a mesma empresa.

-- InsertCompanyMigrada
INSERT INTO "Company" ("id", "nome", "criadoEm", "atualizadoEm")
VALUES ('company-migracao-1a', 'n8necrm', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- InsertMembershipPorUsuarioExistente
-- gen_random_uuid() é chamado UMA VEZ POR LINHA dentro de um SELECT (não é
-- uma constante avaliada uma vez só) -- cada Membership criado aqui recebe um
-- id próprio. Builtin do Postgres desde a versão 13, sem precisar de
-- extensão (confirmado: este banco roda Postgres 17.6).
INSERT INTO "Membership" ("id", "userId", "companyId", "papel", "criadoEm")
SELECT gen_random_uuid()::text, "id", 'company-migracao-1a', "papel", CURRENT_TIMESTAMP
FROM "User";

-- ============================================================================
-- Passo 4, 5 e 6: companyId nas tabelas de tenant.
--
-- Contact, PipelineStage, Lead, LeadNote, Task, Notification, Conversation,
-- WhatsappMessage, AuditLog -- todas seguem o MESMO padrão de três passos
-- (ADD COLUMN nullable -> UPDATE -> SET NOT NULL + SET DEFAULT + FK +
-- índice). BotConfig segue depois, com o passo extra de largar o default de
-- id constante.
--
-- FK sem ON DELETE explícito = RESTRICT (mesmo padrão que o Prisma já emite
-- para toda relação obrigatória neste schema -- ver, por exemplo,
-- "Lead_stageId_fkey" em 20260730211315_init/migration.sql). Apagar uma
-- Company com dado de tenant pendurado nela precisa ser um erro que alguém
-- resolve de propósito, não um DELETE CASCADE que apaga o CRM inteiro de um
-- cliente por engano.
-- ============================================================================

-- AddColumn
ALTER TABLE "Contact" ADD COLUMN "companyId" TEXT;
ALTER TABLE "PipelineStage" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "companyId" TEXT;
ALTER TABLE "LeadNote" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Task" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "companyId" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "companyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "companyId" TEXT;

-- Backfill
UPDATE "Contact" SET "companyId" = 'company-migracao-1a';
UPDATE "PipelineStage" SET "companyId" = 'company-migracao-1a';
UPDATE "Lead" SET "companyId" = 'company-migracao-1a';
UPDATE "LeadNote" SET "companyId" = 'company-migracao-1a';
UPDATE "Task" SET "companyId" = 'company-migracao-1a';
UPDATE "Notification" SET "companyId" = 'company-migracao-1a';
UPDATE "Conversation" SET "companyId" = 'company-migracao-1a';
UPDATE "WhatsappMessage" SET "companyId" = 'company-migracao-1a';
UPDATE "AuditLog" SET "companyId" = 'company-migracao-1a';

-- SetNotNullAndDefault
ALTER TABLE "Contact" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "PipelineStage" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "PipelineStage" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "Lead" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Lead" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "LeadNote" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "LeadNote" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "Task" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "Notification" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "Conversation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "WhatsappMessage" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "WhatsappMessage" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");
CREATE INDEX "PipelineStage_companyId_idx" ON "PipelineStage"("companyId");
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");
CREATE INDEX "LeadNote_companyId_idx" ON "LeadNote"("companyId");
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");
CREATE INDEX "Conversation_companyId_idx" ON "Conversation"("companyId");
CREATE INDEX "WhatsappMessage_companyId_idx" ON "WhatsappMessage"("companyId");
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- ============================================================================
-- Passo 7: BotConfig -- perde o truque de linha única por PK constante.
-- ============================================================================
--
-- Hoje "id" tem DEFAULT 'bot-config': um segundo INSERT sem id explícito
-- colide na chave primária, e é assim que a linha única era garantida. Config
-- por empresa QUEBRA esse truque de propósito -- passam a existir várias
-- linhas legítimas, uma por empresa. A unicidade continua imposta pelo BANCO,
-- só que por outro caminho: "@@unique([companyId])" (CREATE UNIQUE INDEX
-- abaixo) -- uma config por empresa, do mesmo jeito que antes era uma config
-- só.
--
-- A linha existente (id = 'bot-config', a única hoje) NÃO é renomeada: seu
-- "id" continua sendo o literal 'bot-config' depois desta migração -- é só
-- mais um valor de texto na coluna, sem significado especial nenhum a partir
-- de agora. Só o DEFAULT sai; o valor já gravado fica.
--
-- Todo `where: { id: "bot-config" }` que dependia do default constante passa
-- a devolver a linha errada (ou lançar not-found, dependendo do método) para
-- SEMPRE a partir daqui -- o compilador não pega isso, porque `id` continua
-- sendo `String` dos dois lados. Busca feita (Step 3 desta tarefa, ver o
-- relatório): confirmados 3 pontos em `src/modules/whatsapp/agente.ts`, 1 em
-- `src/modules/whatsapp/turno.ts`, e todo `prisma.botConfig...` direto em
-- `tests/unit/agente-actions.test.ts`, `tests/unit/bot-config-seed.test.ts` e
-- `tests/unit/whatsapp-turno.test.ts`. Nenhum desses é corrigido POR ESTA
-- migração: corrigi-los direito depende de companyId chegar até esse código
-- (Task 2 resolve `usuarioAtual().companyId`; Task 3 entrega o mecanismo de
-- escopo) -- infra que ainda não existe nesta tarefa. `prisma/seed.ts` É
-- corrigido aqui porque é o único desses pontos que esta própria migração
-- precisa continuar funcionando (Step 6: `npx prisma db seed`).

-- AlterTable
ALTER TABLE "BotConfig" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "BotConfig" ADD COLUMN "companyId" TEXT;

-- Backfill
UPDATE "BotConfig" SET "companyId" = 'company-migracao-1a';

-- SetNotNullAndDefault
ALTER TABLE "BotConfig" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "BotConfig" ALTER COLUMN "companyId" SET DEFAULT 'company-migracao-1a';

-- AddForeignKey
ALTER TABLE "BotConfig" ADD CONSTRAINT "BotConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_companyId_key" ON "BotConfig"("companyId");
