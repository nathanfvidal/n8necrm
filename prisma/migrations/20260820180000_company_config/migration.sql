-- Ciclo 1c, Task 1: CompanyConfig -- a metade por empresa de config/client.ts.
--
-- Tabela NOVA e VAZIA. `NOT NULL` sem `DEFAULT` e seguro aqui porque nao ha
-- linha antiga e nao ha codigo publicado inserindo nela.
-- `tests/unit/migracoes-seguras.test.ts` isenta explicitamente coluna criada
-- dentro do proprio CREATE TABLE -- a isencao esta no analisador (`criadas.has`)
-- e tem caso proprio: "tabela criada na propria migracao pode ter NOT NULL sem
-- DEFAULT".
--
-- NENHUM backfill, de proposito. Empresa sem linha e estado SUPORTADO: a
-- leitura (src/core/config/leitura.ts, Task 2 deste ciclo) cai nos padroes de
-- config/client.ts, que e o comportamento de hoje. Backfillar congelaria no
-- banco os valores atuais do arquivo -- inclusive a identidade do produto, que
-- a decisao 8 do spec do programa ainda NAO tomou -- e a partir dai editar o
-- arquivo deixaria de ter efeito, em silencio.

-- CreateTable
CREATE TABLE "CompanyConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "corPrimaria" TEXT,
    "fonte" TEXT,
    "logoClaro" TEXT,
    "logoEscuro" TEXT,
    "modulos" TEXT[],
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorId" TEXT,

    CONSTRAINT "CompanyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyConfig_companyId_key" ON "CompanyConfig"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyConfig" ADD CONSTRAINT "CompanyConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyConfig" ADD CONSTRAINT "CompanyConfig_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automaticos de objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES
-- NAO liga RLS -- isso continua sendo por tabela, a mao (cinto). Mesmo par de
-- linhas que 20260806155117_whatsapp_fatia_2_bot_config escreveu.
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica e escrita aqui:
-- a excecao NOMEADA para o Realtime e Ciclo 3.
ALTER TABLE "CompanyConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyConfig" FROM anon, authenticated;
