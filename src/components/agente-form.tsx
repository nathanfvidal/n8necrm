"use client";

import { useState, useTransition } from "react";
import type { BotConfig } from "@prisma/client";

import { salvarConfigAgenteAction, restaurarConfigPadraoAction } from "@/modules/whatsapp/agente-actions";
import { montarPromptSistema } from "@/modules/whatsapp/prompt";
import { MAX_PERSONA_NOME, MAX_PERSONA_PAPEL, MAX_REGRA, MAX_FAQ } from "@/modules/whatsapp/agente-limites";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Editor da configuração do agente.
 *
 * As regras vivem num único `textarea`, uma por linha, em vez de uma lista de
 * campos com botões de adicionar/remover: são poucas, mudam raramente, e
 * editar texto corrido é mais rápido que operar uma lista — sem contar que a
 * lista precisaria de reordenação para ser útil, o que ninguém pediu.
 */
export function AgenteForm({ config }: { config: BotConfig }) {
  const [ativo, setAtivo] = useState(config.ativo);
  const [personaNome, setPersonaNome] = useState(config.personaNome);
  const [personaPapel, setPersonaPapel] = useState(config.personaPapel);
  const [regrasTexto, setRegrasTexto] = useState(config.regras.join("\n"));
  const [faq, setFaq] = useState(config.faq);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [processando, iniciar] = useTransition();

  // Limpa o aviso de "Salvo" (e qualquer erro anterior) assim que a pessoa
  // volta a mexer em qualquer campo — rodada de correção 1, achado M2: sem
  // isto, "Salvo. Vale na próxima resposta." continuava na tela ao lado de
  // edições ainda não salvas, prometendo algo que não é mais verdade.
  // `ConversaResponder` já faz o mesmo no campo de resposta.
  function limparStatus() {
    setErro(null);
    setSalvo(false);
  }

  const regras = regrasTexto
    .split("\n")
    .map((regra) => regra.trim())
    .filter((regra) => regra.length > 0);
  const regraAcimaDoLimite = regras.some((regra) => regra.length > MAX_REGRA);

  // Prévia calculada no cliente com a MESMA função que o servidor usa, sobre
  // os MESMOS valores aparados (`.trim()`) que a action grava — rodada de
  // correção 1, achado M3: sem o `.trim()` aqui, digitar " Ana " mostrava
  // "Você é  Ana ," na prévia mas gravava "Você é Ana," (a action já aparava
  // antes desta correção), e a promessa "é exatamente este texto que o
  // modelo recebe" ficava falsa bem abaixo dela. `regras` já vem aparada de
  // `regrasTexto.split("\n").map(trim)...` acima.
  //
  // Editar algo cujo efeito é invisível é como programar sem compilar — e
  // como `montarPromptSistema` é pura e determinística, renderizar o texto
  // final custa quase nada e transforma "acho que ficou bom" em "é isto que
  // o modelo vai ler".
  const previa = montarPromptSistema({
    personaNome: personaNome.trim(),
    personaPapel: personaPapel.trim(),
    regras,
    faq: faq.trim(),
  });

  // As actions DEVOLVEM resultado, não lançam — `try/catch` aqui não
  // funcionaria em produção, porque o Next redige erros não tratados de
  // Server Action antes que cheguem ao cliente. Mesmo padrão de
  // `ConversaResponder`/`ConversaEstadoIa`: checa `resultado.ok`, nunca
  // `catch`. Ver o comentário de `ResultadoAcao` em
  // `src/modules/whatsapp/actions.ts`.
  function salvar() {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const resultado = await salvarConfigAgenteAction({ ativo, personaNome, personaPapel, regras, faq });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setSalvo(true);
    });
  }

  function restaurar() {
    // Confirmação porque a ação descarta trabalho e não tem desfazer.
    if (
      !window.confirm(
        "Restaurar persona, regras e FAQ ao padrão do fork? As edições atuais serão perdidas."
      )
    ) {
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await restaurarConfigPadraoAction();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      // Reload cheio, não `router.refresh()`: os campos deste formulário são
      // `useState` inicializado a partir de `config` só no mount — trocar a
      // prop do Server Component pai não remonta este Client Component, e um
      // `router.refresh()` deixaria a tela mostrando os valores antigos
      // editados mesmo com a linha já restaurada no banco.
      window.location.reload();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <label className="flex items-center gap-2 rounded-md border p-3">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => {
              setAtivo(e.target.checked);
              limparStatus();
            }}
          />
          <span className="text-sm font-medium">Atendimento automático ligado</span>
          <span className="text-xs text-muted-foreground">
            Desligado, a IA não responde em nenhuma conversa.
          </span>
        </label>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="persona-nome" className="text-sm font-medium">
              Nome da persona
            </label>
            {/* Contador visível ANTES de colar, não só um erro depois — rodada
                de correção 1, achado I1: "um limite que só aparece como erro
                depois de colar é uma armadilha". */}
            <span
              className={cn(
                "text-xs",
                personaNome.length > MAX_PERSONA_NOME ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {personaNome.length}/{MAX_PERSONA_NOME}
            </span>
          </div>
          <input
            id="persona-nome"
            className="w-full rounded-md border p-2 text-sm"
            maxLength={MAX_PERSONA_NOME}
            value={personaNome}
            onChange={(e) => {
              setPersonaNome(e.target.value);
              limparStatus();
            }}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="persona-papel" className="text-sm font-medium">
              Papel da persona
            </label>
            <span
              className={cn(
                "text-xs",
                personaPapel.length > MAX_PERSONA_PAPEL ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {personaPapel.length}/{MAX_PERSONA_PAPEL}
            </span>
          </div>
          <input
            id="persona-papel"
            className="w-full rounded-md border p-2 text-sm"
            maxLength={MAX_PERSONA_PAPEL}
            value={personaPapel}
            onChange={(e) => {
              setPersonaPapel(e.target.value);
              limparStatus();
            }}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="regras" className="text-sm font-medium">
              Regras — uma por linha
            </label>
            <span className="text-xs text-muted-foreground">até {MAX_REGRA} caracteres cada</span>
          </div>
          <textarea
            id="regras"
            className="w-full rounded-md border p-2 font-mono text-xs"
            rows={12}
            value={regrasTexto}
            onChange={(e) => {
              setRegrasTexto(e.target.value);
              limparStatus();
            }}
          />
          {/* Sem `maxLength` nativo aqui — o textarea combina todas as regras
              num único campo, e o limite é POR REGRA (linha), não do campo
              inteiro. O aviso abaixo cobre o mesmo caso antes do clique em
              Salvar, que é onde a action de fato recusa (ver `agente-actions.ts`). */}
          {regraAcimaDoLimite && (
            <p className="text-xs text-destructive">
              Uma ou mais regras passam de {MAX_REGRA} caracteres — seriam recusadas ao salvar.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="faq" className="text-sm font-medium">
              Perguntas frequentes
            </label>
            <span
              className={cn("text-xs", faq.length > MAX_FAQ ? "text-destructive" : "text-muted-foreground")}
            >
              {faq.length}/{MAX_FAQ}
            </span>
          </div>
          <textarea
            id="faq"
            className="w-full rounded-md border p-2 text-xs"
            rows={8}
            maxLength={MAX_FAQ}
            value={faq}
            onChange={(e) => {
              setFaq(e.target.value);
              limparStatus();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para o agente não receber bloco de FAQ nenhum.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={processando}>
            {processando ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="outline" onClick={restaurar} disabled={processando}>
            Voltar ao padrão do fork
          </Button>
        </div>

        {salvo && <p className="text-sm text-muted-foreground">Salvo. Vale na próxima resposta.</p>}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-medium">Prévia do prompt</h2>
        <p className="text-xs text-muted-foreground">É exatamente este texto que o modelo recebe.</p>
        <pre
          data-testid="previa-prompt"
          className="max-h-[40rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs"
        >
          {previa}
        </pre>
      </div>
    </div>
  );
}
