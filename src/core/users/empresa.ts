import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Resolve a empresa de um usuário a partir do vínculo (`Membership`).
 *
 * ## Por que este helper existe, e por que ele é uma PONTE, não a solução final
 *
 * `usuarioAtual()` (`core/auth/session.ts`) ainda devolve `User` puro, sem
 * `companyId` — essa resolução é da Task 2 do Ciclo 1a (ver
 * `docs/superpowers/plans/2026-08-19-n8necrm-ciclo-1a-tenancy.md`), que
 * ainda não rodou. Enquanto isso, a Task 1 já tornou `companyId` `NOT NULL`
 * em 10 tabelas de tenant, e todo `create` de uma delas precisa de uma
 * origem real para a coluna — a Tarefa de reparo que criou este arquivo
 * (`.superpowers/sdd/reparo-src-companyid.md`) mapeou, ponto a ponto, qual é
 * essa origem em cada `create`.
 *
 * Nos pontos em que a função já recebe explicitamente o id de quem está
 * agindo (`autorId`/`responsavelId`/`usuarioId` — padrão que este código já
 * segue, ver o comentário de `criarLead` em `core/leads/service.ts` sobre por
 * que esses ids chegam como parâmetro em vez de lidos de uma sessão), a única
 * fonte HOJE de "qual empresa" é o vínculo dessa pessoa.
 *
 * **Isto NÃO é o mesmo erro que buscar "a única empresa do banco"**
 * (`prisma.company.findFirst()`), que a tarefa de reparo proíbe: aquilo
 * ignora quem está pedindo e vaza no dia em que existir uma segunda empresa
 * sem relação nenhuma com o autor. Isto é escopado à PESSOA identificada pelo
 * parâmetro que a função já recebia — é exatamente o que `usuarioAtual()` vai
 * fazer sozinho quando a Task 2 rodar (uma vez por requisição, memoizada);
 * aqui é uma consulta extra por chamada, o preço da ponte. Quando a Task 2
 * existir, os pontos que hoje chamam este helper podem passar a receber
 * `companyId` explícito de quem chama (`UsuarioAtivo.companyId`), e as
 * chamadas a esta função somem.
 *
 * `findFirstOrThrow`, não `findFirst`: a migração da Task 1 garante
 * exatamente um vínculo por usuário existente (nenhum caminho de código cria
 * um segundo ainda — a Task 2 é quem passa a LANÇAR nesse caso, ver
 * `EmpresaAmbiguaError` no plano). Se isso deixar de valer antes de a Task 2
 * rodar, é melhor lançar um erro claro do que pegar em silêncio o primeiro
 * vínculo de alguém com mais de um.
 */
export async function companyIdDoUsuario(
  usuarioId: string,
  cliente: Prisma.TransactionClient = prisma
): Promise<string> {
  const vinculo = await cliente.membership.findFirstOrThrow({
    where: { userId: usuarioId },
    select: { companyId: true },
  });
  return vinculo.companyId;
}
