-- Ciclo 2d, Task 1: TurnoJob -- a fila de turnos sai do Vercel Queues e passa a
-- viver no Postgres que este projeto ja tem.
--
-- Tabela NOVA e VAZIA. NOT NULL sem DEFAULT e seguro aqui porque nao ha linha
-- antiga nem codigo publicado inserindo nela --
-- tests/unit/migracoes-seguras.test.ts isenta coluna criada dentro do proprio
-- CREATE TABLE (a isencao esta no analisador, em `criadas.has`, e tem caso
-- proprio). A lista PERDOADAS daquele arquivo continua com 2 entradas: esta
-- migracao nao precisa de isencao nenhuma.
--
-- NENHUM backfill: nao ha o que migrar. Os jobs que estivessem no Vercel Queues
-- no momento da troca ficam la e nunca sao entregues -- e isso e inofensivo
-- neste projeto porque nao ha deploy publicado (docs/ESTADO.md: "nada
-- integrado, nada publicado"), entao nao existe fila viva em lugar nenhum.

-- CreateTable
CREATE TABLE "TurnoJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "tentativaReagendamento" INTEGER NOT NULL DEFAULT 0,
    "chaveIdempotencia" TEXT NOT NULL,
    "disponivelEm" TIMESTAMP(3) NOT NULL,
    "leaseAte" TIMESTAMP(3),
    "tentativasEntrega" INTEGER NOT NULL DEFAULT 0,
    "mortoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnoJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TurnoJob_companyId_chaveIdempotencia_key" ON "TurnoJob"("companyId", "chaveIdempotencia");

-- CreateIndex
-- O indice que a REIVINDICACAO usa. A ordem das colunas segue o predicado dela:
-- filtra por "mortoEm" IS NULL primeiro, depois ordena/corta por
-- "disponivelEm". Indice parcial (WHERE "mortoEm" IS NULL) seria menor, e foi
-- recusado de proposito: o Prisma nao o representa em schema.prisma, e um
-- indice que existe no banco e nao existe no schema e deriva esperando
-- acontecer na proxima vez que alguem rodar `prisma migrate diff`.
CREATE INDEX "TurnoJob_mortoEm_disponivelEm_idx" ON "TurnoJob"("mortoEm", "disponivelEm");

-- CreateIndex
CREATE INDEX "TurnoJob_companyId_idx" ON "TurnoJob"("companyId");

-- CreateIndex
CREATE INDEX "TurnoJob_conversationId_idx" ON "TurnoJob"("conversationId");

-- AddForeignKey
-- RESTRICT para Company, igual a CompanyConfig e WhatsappConnection: apagar
-- empresa com trabalho pendente e o tipo de operacao que deve parar e ser
-- olhada.
ALTER TABLE "TurnoJob" ADD CONSTRAINT "TurnoJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE para Conversation: o job e um ponteiro, e o ponteiro nao sobrevive ao
-- alvo.
ALTER TABLE "TurnoJob" ADD CONSTRAINT "TurnoJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260813180000_blindar_privilegios_padrao cobre os GRANTs automaticos de
-- objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES NAO liga RLS --
-- isso continua sendo por tabela, a mao (cinto).
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica e escrita aqui:
-- a excecao NOMEADA para o Realtime e Ciclo 3.
ALTER TABLE "TurnoJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TurnoJob" FROM anon, authenticated;
