-- Ciclo 1f: derruba "User"."papel". De vez.
--
-- ## Por que "de vez"
--
-- A coluna ja foi derrubada uma vez, por 20260819130000_derruba_user_papel, e
-- restaurada horas depois por 20260819140000_restaura_user_papel_temporariamente.
-- Aquela tentativa foi a terceira do Ciclo 1a, e as tres falharam pelo mesmo
-- mecanismo: quem media achava um grupo de leitores, concluia que era o
-- alcance total, e um grupo novo aparecia DEPOIS do ponto sem volta.
--
-- O que mudou: a medicao de 2026-08-21
-- (.superpowers/sdd/medicao-user-papel.md) mediu com DOIS instrumentos
-- independentes e achou o buraco do primeiro. O `tsc`, rodado num worktree
-- descartavel contra uma linha de base comprovadamente zerada, apontou 62
-- erros -- todos atribuiveis ao campo, e a nada mais. A varredura textual
-- achou o que ele nao pega: `papel` escrito atraves de `.map()`
-- (tests/unit/audit-isolamento.test.ts:163) passava no typecheck, porque a
-- checagem de propriedade excedente do TypeScript so vale para objeto literal
-- fresco atribuido direto ao parametro.
--
-- Superficie real: 32 arquivos, 11 leitores e 42 escritores, NENHUM leitor em
-- `src/`. Nao os ~80 que o comentario do schema afirmava -- aquele numero
-- contava prosa e `Membership.papel` junto.
--
-- ## Como este DROP e diferente do anterior
--
-- 1. Os 53 pontos foram convertidos ANTES, em commits separados, cada um com
--    a arvore compilando e a suite verde. O DROP anterior veio primeiro e
--    quebrou 26 lugares de uma vez, com a coluna ja fora do banco.
-- 2. A coluna passou por 20260821120000_user_papel_aceita_nulo antes, porque
--    ela era NOT NULL sem DEFAULT e parar de escreve-la produziria 23502 --
--    o incidente de 20260813200000, pela porta oposta.
-- 3. Existe uma trava permanente contra a volta:
--    tests/unit/user-papel-nao-volta.test.ts. Ela le ESTE schema como texto e
--    reprova um campo `papel` em `model User`, e varre o repositorio
--    reprovando `papel` dentro de qualquer chamada a `prisma.user.*`. As duas
--    metades provam que mordem, com fixtures do codigo real.
--
-- ## O que foi medido no banco antes de escrever isto
--
-- A consulta de dependentes do Step 2 da Task 11 (pg_views, pg_matviews,
-- pg_proc, pg_policies, pg_indexes filtrados por `papel`, mais pg_depend com
-- deptype <> 'a' sobre a coluna) devolveu VAZIO em 2026-08-21, contra o mesmo
-- banco em que esta migracao roda. Nenhuma view, funcao, politica de RLS ou
-- indice referencia a coluna. Isso e uma resposta legivel obtida ANTES; nao
-- substitui a defesa do proprio DROP, descrita abaixo.
--
-- O que aquela consulta NAO alcanca, e segue nao verificado: SQL cru contra
-- "User" que viva fora do banco e fora deste repositorio -- um no Postgres num
-- workflow de n8n.nateksoft.com, ou uma consulta salva no Supabase Studio.
--
-- ## A verificacao abaixo
--
-- Roda dentro da transacao da migracao (o Prisma envolve cada migration.sql
-- numa transacao em Postgres), que e o unico momento em que ainda da para
-- desfazer. A do DROP anterior comparava User.papel com Membership.papel;
-- esta nao pode exigir igualdade para todo mundo, porque desde
-- 20260821120000 a coluna aceita nulo e quem nasceu depois dela a tem NULA.
-- Entao sao duas checagens: ninguem pode ficar SEM papel (todo User precisa de
-- ao menos um Membership), e quem ainda tem valor na coluna nao pode divergir
-- do vinculo.
--
-- O DROP tambem e a ultima defesa por si so: sem CASCADE, o Postgres RECUSA
-- derrubar coluna de que uma view, indice, constraint ou coluna gerada
-- dependa. CASCADE nao aparece aqui de proposito.

-- ============================================================================
-- Verificacao ANTES do DROP
-- ============================================================================

DO $$
DECLARE
  sem_vinculo integer;
  divergentes integer;
BEGIN
  SELECT count(*) INTO sem_vinculo
  FROM "User" u
  WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u.id);

  IF sem_vinculo > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuario(s) sem nenhum Membership. Derrubar a coluna faria o papel deles sumir sem destino. Nada foi apagado.',
      sem_vinculo;
  END IF;

  SELECT count(*) INTO divergentes
  FROM "User" u
  WHERE u.papel IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = u.id AND m.papel = u.papel
    );

  IF divergentes > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuario(s) com User.papel divergente de todo Membership. Reconcilie antes -- e note que a divergencia era o risco declarado como R4 na auditoria do Ciclo 1a. Nada foi apagado.',
      divergentes;
  END IF;
END $$;

-- ============================================================================
-- So chega aqui se as duas verificacoes passaram.
-- ============================================================================

-- AlterTable
ALTER TABLE "User" DROP COLUMN "papel";
