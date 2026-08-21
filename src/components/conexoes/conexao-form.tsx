"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { criarConexaoAction } from "@/core/conexoes/actions";
import { registrarFalhaDeRede } from "@/lib/acao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AvisoDeWebhook } from "./conexoes-table";

/**
 * Cadastro de conexão.
 *
 * ## O campo da chave é `type="password"` e nasce VAZIO
 *
 * Vazio porque não há valor anterior a exibir — a chave nunca volta do
 * servidor. `password` porque a tela de administração costuma ser aberta com
 * gente por perto, e o navegador não deve oferecer autocompletar para ela:
 * `autoComplete="off"` acompanha, pelo mesmo motivo.
 *
 * ## `META_CLOUD` aparece desabilitado, e o servidor recusa de qualquer forma
 *
 * O `disabled` é conveniência — diz que a opção existe e ainda não chegou. O
 * gate de verdade é `validarCampos` em `core/conexoes/service.ts`, que lança
 * `ConexaoInvalidaError`, e ele vale para um POST que nunca passou por aqui.
 *
 * O `<select>` não tem estado de propósito: com uma opção habilitada só, um
 * `useState` seria uma variável que nunca muda. No dia em que a Meta Cloud API
 * entrar (Ciclo 2b), ele ganha estado e a action passa a receber o valor
 * escolhido em vez do literal abaixo.
 */
export function ConexaoForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [dominio, setDominio] = useState("");
  const [instancia, setInstancia] = useState("");
  const [segredo, setSegredo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();

  function salvar() {
    setErro(null);
    setWebhookPath(null);
    iniciar(async () => {
      try {
        const resultado = await criarConexaoAction({
          canal: "EVOLUTION",
          nome,
          dominio,
          instancia,
          segredo,
        });
        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }
        // O campo da chave é limpo assim que a action confirma: deixá-lo
        // preenchido manteria o segredo na memória do navegador e no DOM sem
        // nenhuma razão — ele já foi gravado.
        setSegredo("");
        setNome("");
        setDominio("");
        setInstancia("");
        setWebhookPath(resultado.webhookPath);
        router.refresh();
      } catch (erroDeRede) {
        // A action promete não lançar, e essa promessa é do CÓDIGO, não do
        // transporte: conexão que cai entre o clique e a resposta rejeita o
        // `await` sem nunca ter entrado no `try` da action.
        setErro(registrarFalhaDeRede("Falha ao cadastrar conexão", erroDeRede));
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(evento) => {
        evento.preventDefault();
        salvar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="conexao-nome">Nome</Label>
          <Input
            id="conexao-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Comercial"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-canal">Canal</Label>
          <select
            id="conexao-canal"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue="EVOLUTION"
          >
            <option value="EVOLUTION">Evolution API</option>
            <option value="META_CLOUD" disabled>
              Meta Cloud API (em breve)
            </option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-dominio">Domínio da instância</Label>
          <Input
            id="conexao-dominio"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder="https://evolution.seudominio.com"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-instancia">Nome da instância</Label>
          <Input
            id="conexao-instancia"
            value={instancia}
            onChange={(e) => setInstancia(e.target.value)}
            placeholder="minha-instancia"
            required
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="conexao-segredo">Chave de API (apikey)</Label>
          <Input
            id="conexao-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder="cole aqui a apikey do painel da Evolution"
            required
          />
          <p className="text-xs text-muted-foreground">
            Guardada cifrada. Depois de salvar ela não pode ser lida de volta, só substituída.
          </p>
        </div>
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}

      <Button type="submit" disabled={processando}>
        {processando ? "Salvando..." : "Cadastrar conexão"}
      </Button>

      {webhookPath ? <AvisoDeWebhook caminho={webhookPath} /> : null}
    </form>
  );
}
