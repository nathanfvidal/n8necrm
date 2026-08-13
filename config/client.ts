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
  nome: "AutoCenter Exemplo",
  vertical: "automotivo",
  marca: {
    nome: "AutoCenter Exemplo",
    corPrimaria: "#0F62FE",
    fonte: "Geist",
    // Arte monocromática: a preta é para o tema claro, a branca para o
    // escuro. Escolhido o par de 3 KB sem metadado C2PA — as variantes
    // maiores da mesma arte carregavam ~9,5 KB de manifesto de proveniência.
    logo: { claro: "/logo-preto.svg", escuro: "/logo-branco.svg" },
  },
  // "whatsapp" liga o atendente de IA (Fatia 1) e o link "Conversas" no
  // menu — ver src/modules/whatsapp/. Diferente de catalog/analytics
  // (ainda sem rota, Fases 2-3), este módulo tem código funcionando de
  // verdade nesta fatia, então já entra ligado.
  modulos: ["whatsapp"],
  entidade: {
    singular: "Veículo",
    plural: "Veículos",
    campos: [
      { nome: "marca", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "modelo", tipo: "texto", obrigatorio: true, filtravel: true },
      { nome: "ano", tipo: "numero", obrigatorio: true, filtravel: true },
      { nome: "km", tipo: "numero", obrigatorio: false, filtravel: true },
      { nome: "cambio", tipo: "opcao", obrigatorio: false, filtravel: true, opcoes: ["Manual", "Automático"] },
      { nome: "cor", tipo: "texto", obrigatorio: false, filtravel: false },
    ],
  },
  funil: ["Novo", "Contato feito", "Visita agendada", "Proposta", "Fechado"],
  whatsapp: {
    numero: "5511999999999",
    mensagem: "Olá, tenho interesse no {item}",
  },
});
