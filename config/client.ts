import { ClientConfig } from "./client.schema";

export const client: ClientConfig = {
  nome: "AutoCenter Exemplo",
  vertical: "automotivo",
  marca: {
    logo: "/logo.svg",
    corPrimaria: "#0F62FE",
    fonte: "Inter",
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
};
