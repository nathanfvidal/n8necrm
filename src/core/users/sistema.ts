/**
 * Contas de sistema: linhas de `User` que existem para dar um ator às
 * gravações automáticas, e que nenhuma tela de gestão pode criar, editar,
 * desativar ou reativar.
 *
 * Hoje há uma só — o atendente de WhatsApp, semeado por `prisma/seed.ts`
 * porque `AuditLog.userId` é FK obrigatória e não faz sentido atribuir uma
 * resposta gerada por IA a um vendedor humano.
 *
 * ## Por que a lista é duplicada em vez de importada do seed
 *
 * O id literal também aparece em `prisma/seed.ts` (`WHATSAPP_SYSTEM_USER_ID`).
 * Importar de lá para cá arrastaria o seed inteiro — `dotenv/config`, a
 * criação de etapas, os leads de exemplo — para dentro do bundle da
 * aplicação, e o seed tem efeito colateral de topo de arquivo. A direção
 * inversa é que é segura, e é a que existe: `prisma/seed.ts` importa este
 * módulo e usa `ID_SISTEMA_WHATSAPP` como fonte única.
 *
 * ## Por que isto não é só arrumação
 *
 * O usuário do WhatsApp tem `papel: "ADMIN"` e `ativo: false`. Sem esta
 * exclusão, um ADMIN humano poderia reativá-lo pela tela e, a partir daí, a
 * proteção do "último ADMIN ativo" (`service.ts`) passaria a contar um robô
 * que **não consegue fazer login** — a senha dele é um hash de bytes
 * aleatórios descartados na hora. O sistema autorizaria desativar a última
 * pessoa de verdade, achando que sobrou um administrador.
 *
 * Efeito colateral menor, mas real: `marcarAguardandoHumano`
 * (`src/modules/whatsapp/notificacoes.ts`) avisa todo `User` com
 * `ativo: true`. Um bot reativado passaria a acumular notificações que
 * ninguém lê.
 */
export const ID_SISTEMA_WHATSAPP = "system-whatsapp-bot";

const IDS_DE_SISTEMA: readonly string[] = [ID_SISTEMA_WHATSAPP];

export function ehContaDeSistema(id: string): boolean {
  return IDS_DE_SISTEMA.includes(id);
}

/**
 * Os ids em forma mutável, para o `notIn` do Prisma — que tipa a lista como
 * `string[]` e recusa `readonly string[]`. Devolve uma cópia a cada chamada,
 * então a lista de origem continua imutável.
 *
 * ## Por que uma função, e não um objeto `where` pronto para espalhar
 *
 * A primeira versão exportava `{ id: { notIn: [...] } }` para ser espalhado
 * em consultas — `where: { id: alvo, ...EXCLUI_CONTAS_DE_SISTEMA }`. O
 * TypeScript recusou com `'id' is specified more than once`, e estava certo:
 * o spread **sobrescreve** o `id` anterior, então aquele `where` deixava de
 * filtrar pela pessoa procurada e devolvia a primeira linha não-sistema que
 * o banco tivesse. As checagens que dependem do resultado (é ADMIN? está
 * ativo?) passariam a ser feitas sobre outra pessoa.
 *
 * Um filtro por `id` não compõe por spread; compõe dentro do mesmo objeto
 * (`id: { not: x, notIn: [...] }`). Por isso o que se exporta é a lista, e
 * quem consulta monta o predicado — mais verboso, e sem a armadilha.
 */
export function idsDeSistema(): string[] {
  return [...IDS_DE_SISTEMA];
}
