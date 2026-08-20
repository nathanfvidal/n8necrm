import { clientConfigSchema } from "./client.schema";

/**
 * O PADRÃO do produto. Desde o Ciclo 1c, não mais "a configuração".
 *
 * `marca` e `modulos` daqui são o valor usado quando a empresa não decidiu:
 * `CompanyConfig` sobrepõe campo a campo, e empresa SEM LINHA usa isto inteiro
 * (`src/core/config/schema.ts`, `mesclarConfig`). Os outros blocos continuam
 * morando só aqui, e cada um por um motivo medido — ver a seção 4.1 do spec
 * `docs/superpowers/specs/2026-08-20-ciclo-1c-config-no-banco-design.md`:
 * `vertical`, `entidade` e `whatsapp` não têm consumidor nenhum fora do teste
 * do próprio schema (verificado por grep em `src/`, `tests/`, `config/` e
 * `prisma/` em 2026-08-20: zero ocorrências de `client.vertical` e
 * `client.whatsapp`), e `funil` já vive em `PipelineStage` com CRUD próprio
 * desde o Ciclo de etapas — aqui ele é semente de INSTALAÇÃO, lida uma vez
 * pelo `prisma/seed.ts` quando a tabela está vazia.
 *
 * **Consequência que morde:** depois que existe uma linha de `CompanyConfig`
 * para uma empresa, editar `marca` ou `modulos` aqui deixa de ter efeito para
 * ela. É o mesmo contrato que `funil` já tem com `PipelineStage` (ver
 * `prisma/seed.ts`): arquivo é semente, banco é o estado.
 *
 * Hoje NENHUM seed cria linha de `CompanyConfig` — `prisma/seed.ts` não
 * menciona o modelo (grep em 2026-08-20; quem cria linha é só
 * `tests/unit/config-isolamento.test.ts`, para o próprio teste). Ou seja: toda
 * empresa desta árvore ainda cai neste arquivo por inteiro, marca e módulos, e
 * assim continua até alguém decidir a identidade do produto (decisão 8 do spec
 * do programa, ainda EM ABERTO) ou gravar a primeira sobreposição pela tela.
 *
 * `parse` e não anotação de tipo: até 2026-08-09 este arquivo só DECLARAVA
 * `: ClientConfig`, então o schema Zod existia e nunca rodava — `marca` e
 * `entidade` podiam conter qualquer coisa sem ninguém notar.
 *
 * Validar em escopo de módulo já derrubou o deploy deste projeto uma vez: o
 * módulo `whatsapp` validava VARIÁVEIS DE AMBIENTE na importação, e
 * `next build` fazia a validação rodar sem elas na Vercel. Aqui é seguro pelo
 * motivo oposto — os valores estão neste arquivo versionado, não no ambiente,
 * e não há como faltarem no build. É essa propriedade que faz o arquivo ser o
 * padrão e o banco a sobreposição, e não o contrário.
 */
export const client = clientConfigSchema.parse({
  nome: "n8necrm",
  // Decisão 8 do spec (2026-08-19): a identidade do produto está EM ABERTO de
  // propósito. "generico" é o marcador dessa decisão adiada, não um
  // placeholder esquecido — `vertical` é obrigatório no schema e string vazia
  // passaria na validação sem dizer nada a quem ler depois.
  vertical: "generico",
  marca: {
    nome: "n8necrm",
    // Croma acima do piso de `CROMA_MINIMO` (config/client.schema.ts): o
    // schema RECUSA cinza, porque abaixo desse piso as superfícies derivadas
    // ficam indistinguíveis de neutro e o white-label para de funcionar em
    // silêncio. Ou seja: não existe "cor neutra provisória" aqui.
    corPrimaria: "#6D4AFF",
    fonte: "Geist",
    // `logo` omitido: é opcional, e sem arquivo o painel mostra o nome em
    // texto. Não inventar caminho para asset que não existe — o regex de
    // `caminhoDeAsset` aceitaria, e a imagem quebraria só em runtime.
  },
  // O enum de `modulos` em client.schema.ts JÁ incluía "automation" desde
  // antes do Ciclo 4 começar — não houve enum a estender lá. A Task 4 do
  // Ciclo 4 é quem liga o módulo de fato, com a tela `/fluxos` no ar.
  modulos: ["whatsapp", "automation"],
  // Entidade genérica, mas NÃO vazia. `campos: []` passaria no schema, mas
  // `entidade.campos` não tem nenhum consumidor real hoje — nem tela, nem
  // export, nem filtro: `prisma/schema.prisma:75-78` documenta que o
  // caminho de campos configuráveis "foi desenhado e descartado" em favor
  // de colunas fixas no modelo `Lead` (confirmado por grep em `src/`,
  // `tests/` e `config/`: a única leitura de `.campos` fora deste arquivo é
  // `tests/unit/client-config.test.ts`, que testa a validação do próprio
  // schema Zod). Os dois campos ficam mesmo assim, por duas razões que não
  // dependem de consumidor nenhum: manter a paridade de forma com a config
  // que a base tinha, e exercitar a validação do schema com um `texto` e um
  // `numero` reais em vez do caminho degenerado de uma lista vazia.
  entidade: {
    singular: "Item",
    plural: "Itens",
    campos: [
      { nome: "titulo", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "valor", tipo: "numero", obrigatorio: false, filtravel: true },
    ],
  },
  funil: ["Novo", "Em contato", "Proposta", "Fechado"],
  whatsapp: {
    numero: "5511999999999",
    mensagem: "Olá, tenho interesse em {item}",
  },
});
