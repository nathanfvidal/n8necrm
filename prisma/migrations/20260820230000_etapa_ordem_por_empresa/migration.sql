-- Ciclo 1e, Task 2: PipelineStage.ordem deixa de ser unica GLOBAL.
--
-- POR QUE: a posicao "1" do funil era um recurso do BANCO INTEIRO. Duas
-- empresas nao podiam ter uma primeira etapa cada, e nem os testes podiam --
-- pipeline-isolamento.test.ts e contact-isolamento.test.ts reservam faixas
-- disjuntas de `ordem` so por causa disto.
--
-- E CORRIGE UM DEFEITO VIVO, nao so destrava a segunda empresa: criarEtapa
-- calcula max(ordem DA EMPRESA) + 1 desde o Ciclo 1d, e esse valor podia estar
-- ocupado por outra empresa -- P2002 na tela /etapas apontando para uma etapa
-- invisivel para quem clicou.
--
-- POR QUE SEM DEDUPLICACAO: a chave nova e a antiga MAIS uma coluna. Medido em
-- 2026-08-20: PipelineStage = 4 linhas, Company = 1, e
-- GROUP BY ("companyId", ordem) HAVING count(*) > 1 devolveu vazio.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL, so troca de indice. PERDOADAS nao recebe entrada.
--
-- O indice novo tambem serve melhor as consultas que existem: toda leitura de
-- funil em src/ tem a forma WHERE "companyId" = $1 ORDER BY "ordem", e um
-- btree ("companyId","ordem") atende igualdade no prefixo e ordenacao no
-- sufixo. Com 4 linhas isso nao e mensuravel aqui (NV3 do spec) -- e o
-- raciocinio de ordem de colunas ja esta registrado em prisma/schema.prisma.

-- DropIndex
DROP INDEX "PipelineStage_ordem_key";

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_companyId_ordem_key" ON "PipelineStage"("companyId", "ordem");
