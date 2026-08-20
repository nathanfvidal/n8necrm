import "server-only";

import {
  credencialDaConexao,
  credencialAtivaUnica,
  type CredencialDeConexao,
} from "@/core/conexoes/leitura";

import { EvolutionGateway } from "./evolution";
import type { WhatsappGateway } from "./tipos";

/**
 * De onde sai um gateway agora que a credencial vive no BANCO, por empresa.
 *
 * ## Por que o singleton não serve mais
 *
 * `whatsappGateway` (`./index.ts`) é um objeto por PROCESSO com uma credencial
 * só, lida de `EVOLUTION_*`. Um processo serve várias empresas — e uma empresa
 * pode ter mais de uma conexão (multi-instância é decisão travada do programa,
 * `CLAUDE.md`, decisão 4). Um singleton nesse mundo é a credencial da empresa
 * A respondendo pelo cliente da B.
 *
 * ## Este arquivo ADICIONA, não substitui — e isso é de propósito
 *
 * O ciclo é *expande → migra → contrai*: esta fábrica nasce AO LADO do
 * `whatsappGateway`, as Tarefas 7 e 8 migram os dois consumidores (rota do
 * webhook; `turno.ts`/`agente.ts`) e só a Tarefa 10 apaga o antigo junto com
 * as variáveis `EVOLUTION_*`. Fazer tudo de uma vez deixaria alguma tarefa
 * intermediária com o `typecheck` vermelho. Há caso de teste afirmando que o
 * caminho antigo continua funcionando
 * (`tests/unit/whatsapp-gateway-fabrica.test.ts`, describe "o caminho ANTIGO
 * continua vivo"), porque "não removi nada" sem prova é a forma de afirmação
 * que quebra em produção em silêncio.
 *
 * ## Nada aqui é memoizado, e isso é a decisão, não o esquecimento
 *
 * Um `Map<companyId, WhatsappGateway>` em escopo de módulo economizaria uma
 * consulta e reintroduziria exatamente o estado global que o programa proíbe:
 * ele sobrevive entre requisições e o modo de falha é servir a credencial
 * errada depois de a conexão ter sido substituída pela tela. O custo de não
 * memoizar é uma consulta e uma decifragem AES-GCM sobre poucas dezenas de
 * bytes por mensagem enviada.
 *
 * Quatro casos de teste travam essa frase, porque ela é do tipo que vira prosa
 * sozinha: dois contam as consultas (por empresa e por conexão), um compara a
 * IDENTIDADE dos gateways devolvidos (contagem sozinha deixaria passar um
 * cache que consulta e devolve objeto guardado), e um varre o FONTE deste
 * arquivo atrás de `let`/`var`/`Map`/`Set`/`WeakMap`/`globalThis` — o mesmo
 * padrão de `tests/unit/config-leitura.test.ts`.
 *
 * ## `companyId` viaja como parâmetro explícito, e não em `AsyncLocalStorage`
 *
 * Este módulo é chamado de webhook, de fila e de consumidor — os caminhos que
 * rodam FORA do ciclo de request, onde estado implícito não é preenchido e
 * falha calado. Parâmetro explícito falha no `typecheck`, que é onde a gente
 * quer que falhe.
 *
 * ## Este arquivo mora em `modules/`, e importa de `core/`
 *
 * Direção permitida pela fronteira do `eslint.config.mjs` (`modules` → `core`,
 * nunca o contrário). O cofre e a tabela de conexões são de `core` porque a
 * tela de Configurações não é um módulo opcional; o adaptador de protocolo é
 * de `modules` porque WhatsApp é.
 */
export class CanalNaoImplementadoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CanalNaoImplementadoError";
  }
}

/**
 * A linha existe e o canal é atendido, mas ela está incompleta.
 *
 * Classe SEPARADA de `CanalNaoImplementadoError` de propósito, pelo mesmo
 * raciocínio que separa `ConexaoNaoConfiguradaError` de `ConexaoAmbiguaError`
 * em `core/conexoes/leitura.ts`: as duas recusas mandam quem lê para lugares
 * diferentes. "Canal não implementado" manda esperar o Ciclo 2b; "conexão
 * incompleta" manda corrigir a linha em Configurações → Conexões, agora. Um
 * nome só faria alguém abrir o roadmap por causa de um `dominio` nulo. Há caso
 * de teste conferindo que uma não é a outra.
 */
export class ConexaoIncompletaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoIncompletaError";
  }
}

/**
 * O único ponto do sistema que decide QUAL adaptador atende um canal.
 *
 * `EvolutionGateway` não mudou nem uma linha por causa deste ciclo: ele já
 * recebia `{ domain, instance, apiKey }` pelo construtor e nunca leu
 * `process.env` — o comentário dele registra isso desde a Fatia 1 ("recebe a
 * configuração já validada pelo construtor"). O que mudou foi de ONDE esses
 * três valores vêm.
 *
 * A `apiKey` em claro entra aqui, vai direto para o construtor e não é
 * guardada em lugar nenhum deste módulo. Quem decifra é
 * `core/conexoes/leitura.ts`, a cada chamada; quem redige a chave do corpo de
 * erro da Evolution é `redigirApiKey`, dentro de `evolution.ts` — e esse
 * caminho tem caso de teste PELA FÁBRICA, não só pela classe, porque a Tarefa
 * 3 deixou nomeado que `redigirApiKey` cobre `enviarTexto` e só ele.
 */
export function gatewayDaCredencial(credencial: CredencialDeConexao): WhatsappGateway {
  if (credencial.canal !== "EVOLUTION") {
    // Recusa NOMEADA, e ela existe para que o Ciclo 2b troque este ramo por
    // uma implementação em vez de acrescentar um `else` a um `if` que cairia
    // silenciosamente no Evolution. Tem caso de teste.
    throw new CanalNaoImplementadoError(
      `A conexão ${JSON.stringify(credencial.id)} é do canal ${credencial.canal}, que este CRM ` +
        `ainda não atende — a Meta Cloud API é o Ciclo 2b. O valor existe no enum para que aquele ` +
        `ciclo não precise de uma migração de enum.`
    );
  }

  // O serviço valida os dois na escrita (`core/conexoes/service.ts`), mas uma
  // linha editada por SQL à mão chega aqui. Sem esta guarda, `null` viraria a
  // string "null" dentro da URL de envio e a falha apareceria como um HTTP 404
  // da Evolution, que não aponta para a causa.
  //
  // Nem esta mensagem nem a de cima carregam a credencial: elas citam id e
  // canal, nunca o objeto inteiro. Tem caso de teste — a mensagem vai para o
  // Sentry, e lá ela fica fora do controle de quem opera o CRM.
  if (!credencial.dominio || !credencial.instancia) {
    throw new ConexaoIncompletaError(
      `A conexão ${JSON.stringify(credencial.id)} é Evolution mas está sem ` +
        `${!credencial.dominio ? "domínio" : "instância"}. Corrija em Configurações → Conexões.`
    );
  }

  return new EvolutionGateway({
    domain: credencial.dominio,
    instance: credencial.instancia,
    apiKey: credencial.apiKey,
  });
}

/**
 * O gateway de uma CONVERSA — é este que o envio usa.
 *
 * `connectionId` preenchido é o caso de toda conversa criada a partir do Ciclo
 * 2a: a ingestão grava por qual conexão a mensagem entrou, e a resposta sai
 * pela mesma. Sem isso, "multi-instância" seria mentira — com duas conexões na
 * mesma empresa, responder pela "primeira" é responder pelo número errado.
 *
 * `connectionId` nulo é conversa anterior ao ciclo. Ela cai em
 * `credencialAtivaUnica`, que RECUSA quando há mais de uma ativa. O
 * `conversationId` viaja no contexto porque é ele que transforma o erro em
 * algo acionável: sem ele, o log diria "conexão ambígua" e ninguém saberia
 * qual conversa ficou sem resposta.
 *
 * Não há `catch` em volta de nenhuma das duas leituras, e isso é a parte que
 * importa. Um `catch` que "resolvesse" a falha de `credencialDaConexao`
 * caindo em `credencialAtivaUnica` responderia o cliente por outra conexão em
 * silêncio — a mesma família de defeito que o ciclo inteiro existe para
 * eliminar. O erro sobe intacto, inclusive o do cofre (chave mestra ausente),
 * que `core/conexoes/leitura.ts` também deixa passar de propósito. Três casos
 * de teste travam isso: ambígua, conexão de outra empresa e nenhuma ativa.
 *
 * Desde a Tarefa 7 do Ciclo 2a, `credencialDaConexao` também recusa a conexão
 * DESATIVADA (`ConexaoDesativadaError`), e ela sobe por aqui pelo mesmo motivo
 * das outras: cair em `credencialAtivaUnica` depois de uma recusa dessas
 * desfaria, em silêncio, o que o operador desligou na tela.
 */
export async function gatewayDaConversa(
  companyId: string,
  conversa: { id: string; connectionId: string | null }
): Promise<WhatsappGateway> {
  const credencial = conversa.connectionId
    ? await credencialDaConexao(companyId, conversa.connectionId)
    : await credencialAtivaUnica(companyId, `a conversa ${conversa.id}`);

  return gatewayDaCredencial(credencial);
}

/**
 * O gateway de uma EMPRESA, quando não há conversa envolvida.
 *
 * `contexto` é obrigatório e não tem padrão: ele é o que entra na mensagem de
 * `ConexaoNaoConfiguradaError`/`ConexaoAmbiguaError`, e um padrão genérico
 * ("uso desconhecido") produziria exatamente o erro que não ajuda ninguém.
 */
export async function gatewayDaEmpresa(
  companyId: string,
  contexto: string
): Promise<WhatsappGateway> {
  return gatewayDaCredencial(await credencialAtivaUnica(companyId, contexto));
}
