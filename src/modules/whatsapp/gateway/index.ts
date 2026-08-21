import "server-only";

/**
 * A porta única do pacote `gateway`.
 *
 * ## O que morreu aqui, no Ciclo 2a, e por quê
 *
 * Este arquivo tinha um schema Zod lendo `EVOLUTION_DOMAIN`,
 * `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY`, e um `Proxy` que construía UM
 * `EvolutionGateway` por processo, na primeira propriedade acessada.
 *
 * As duas coisas eram certas para um deploy de uma empresa só e são erradas
 * agora, por motivos diferentes:
 *
 * - **As variáveis** eram credencial por DEPLOY para um dado que é por
 *   EMPRESA. Não davam lugar para a segunda empresa, e trocar a chave era um
 *   redeploy.
 * - **O singleton** era uma credencial por processo, e um processo serve
 *   várias empresas. Com credencial por empresa, ele responderia o cliente de
 *   uma pela instância de outra.
 *
 * Elas não viraram "padrão de arquivo, sobreposto pelo banco", que é o que o
 * Ciclo 1c fez com a marca em `config/client.ts`, e a diferença é o custo do
 * padrão errado: marca errada abre o painel na cor genérica e se vê na hora;
 * credencial errada faz a empresa B responder clientes pelo número da A, e não
 * se vê nunca. Um padrão de credencial por deploy é `Company.findFirst()` com
 * outro nome.
 *
 * O que NÃO morreu é a lição que este arquivo carregava: **nada de validação
 * em escopo de módulo.** `next build` avalia cada módulo alcançável para
 * coletar a configuração das rotas, e a cadeia
 * `api/queues/whatsapp-turn` → `turno.ts` → `gateway/index.ts` fazia a
 * validação rodar em tempo de BUILD:
 *
 *     Failed to collect configuration for /api/queues/whatsapp-turn
 *     [cause]: Configuração do gateway de WhatsApp inválida: ...
 *
 * O build inteiro falhava — leads, funil e login inclusos, que não têm relação
 * nenhuma com WhatsApp. Ninguém percebeu por três dias porque o sintoma só
 * aparece onde as variáveis não estão: numa máquina de desenvolvimento o `.env`
 * tem tudo. Foi na Vercel que ele apareceu, e o Ciclo 2d saiu dela — mas a
 * regra NÃO era da plataforma: `next build` avalia módulo alcançável para
 * coletar configuração de rota em qualquer lugar que ele rode.
 *
 * Meia dúzia de arquivos aponta para cá quando explica a própria construção
 * preguiçosa (`fila/index.ts`, `fila/postgres.ts`, `llm/index.ts`,
 * `core/cofre/chave.ts`, `core/supabase-jwt/chave.ts` e `emitir.ts`,
 * `automation/n8n/index.ts`). O relato acima é o que essas referências vêm
 * buscar; ele fica, e é por isso que a contração apagou o schema e não a
 * história.
 *
 * ## O alcance exato da regra, medido
 *
 * A regra continua e agora é mais larga: importar este módulo não exige
 * **nenhuma credencial de canal** — nem as três da Evolution, que não existem
 * mais, nem `COFRE_CHAVE_MESTRA` — **e não consulta o banco**. Quem resolve
 * credencial é `./fabrica`, e ela só toca o banco quando é CHAMADA. Há caso de
 * teste para as duas metades em
 * `tests/unit/whatsapp-config-preguicosa.test.ts` — importar não lança, usar
 * com um canal não atendido lança com nome.
 *
 * O que a frase acima NÃO afirma, e a diferença importa: importar isto ainda
 * alcança `lib/env.ts` (via `core/conexoes/leitura` → `core/tenancy/escopo` →
 * `lib/prisma`), e AQUELE arquivo valida `DATABASE_URL` e `AUTH_SECRET` em
 * escopo de módulo. Medido em 2026-08-20: sem as duas, o import lança
 * `Invalid input: expected string, received undefined` com
 * `path: ["DATABASE_URL"]`. É o último ponto do repositório com o padrão
 * antigo, e não é dívida deste ciclo — está escrito aqui e no teste para que
 * ninguém leia "importar não lê ambiente" como garantia mais larga do que é.
 *
 * ## Onde a credencial vive agora
 *
 * Em `WhatsappConnection`, por empresa, com a apikey cifrada
 * (`src/core/cofre/`). A resolução é `src/core/conexoes/leitura.ts`, e a
 * construção do adaptador é `./fabrica`.
 */

export type { WhatsappGateway, EventoWhatsapp, TipoMensagemWhatsapp } from "./tipos";

// `ConexaoIncompletaError` entra junto com `CanalNaoImplementadoError`, e não
// por simetria decorativa: a Tarefa 6 separou as duas de propósito porque cada
// uma manda quem lê para um lugar diferente ("espere o Ciclo 2b" contra
// "corrija a linha em Configurações → Conexões"). Uma porta que exportasse só
// uma das duas convidaria a tratar a outra por `catch` genérico, que é
// exatamente o que a separação existe para evitar.
export {
  gatewayDaCredencial,
  gatewayDaConversa,
  gatewayDaEmpresa,
  CanalNaoImplementadoError,
  ConexaoIncompletaError,
} from "./fabrica";
