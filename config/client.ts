import { ClientConfig } from "./client.schema";

export const client: ClientConfig = {
  nome: "AutoCenter Exemplo",
  vertical: "automotivo",
  marca: {
    logo: "/logo.svg",
    corPrimaria: "#0F62FE",
    fonte: "Inter",
  },
  modulos: ["catalog", "analytics"],
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
