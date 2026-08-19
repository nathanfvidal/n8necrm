import { clientConfigSchema } from "./client.schema";

/**
 * `parse` e não anotação de tipo: até 2026-08-09 este arquivo só DECLARAVA
 * `: ClientConfig`, então o schema Zod existia e nunca rodava — `marca` e
 * `entidade` podiam conter qualquer coisa sem ninguém notar.
 *
 * Validar em escopo de módulo já derrubou o deploy deste projeto uma vez: o
 * módulo `whatsapp` validava VARIÁVEIS DE AMBIENTE na importação, e
 * `next build` fazia a validação rodar sem elas na Vercel. Aqui é seguro pelo
 * motivo oposto — os valores estão neste arquivo versionado, não no ambiente,
 * e não há como faltarem no build.
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
  // O enum de `modulos` em client.schema.ts JÁ inclui "automation", que é onde
  // o módulo de fluxos do n8n entra no Ciclo 4 — não há enum a estender lá.
  // Aqui fica só "whatsapp", o único com código funcionando hoje.
  modulos: ["whatsapp"],
  // Entidade genérica, mas NÃO vazia. `campos: []` passa no schema, e mesmo
  // assim está errado: testes e telas iteram sobre `client.entidade.campos`
  // (export de leads, formulário de lead, filtros de listagem), e uma lista
  // vazia os deixa exercitando o caminho degenerado em vez do caminho real.
  // Dois campos, um de cada tipo básico, mantêm a paridade de forma com a
  // config que a base tinha.
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
