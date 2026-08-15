"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarLeadManualAction } from "@/core/leads/actions";
import { registrarFalhaDeRede, type ResultadoAcao } from "@/lib/acao";

/**
 * Validação client-side é deliberadamente mais permissiva que
 * `normalizarTelefone` (src/core/leads/dedupe.ts) — checa só "tem dígitos
 * suficientes pra ser um telefone", não a regra completa (DDD + 8/9 dígitos
 * depois de remover código do país e unificar o 9º dígito). As duas não
 * podem DIVERGIR na direção perigosa: se este schema fosse mais estrito que
 * o servidor, rejeitaria no cliente um telefone que o servidor aceitaria.
 * Ele pode ser mais permissivo (deixa passar algo que o servidor ainda vai
 * rejeitar) porque `criarLeadManualAction` sempre valida de novo e devolve a
 * recusa como `{ ok: false, erro }`, que o formulário mostra — a validação
 * real e definitiva mora no servidor, isto aqui só evita o roundtrip óbvio
 * (campo vazio, "abc", um dígito solto).
 */
const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  telefone: z
    .string()
    .trim()
    .min(1, "Informe o telefone")
    .refine((valor) => {
      const digitos = valor.replace(/\D/g, "");
      return digitos.length >= 10 && digitos.length <= 13;
    }, "Telefone precisa ter DDD + número (ex.: (11) 98888-7777)"),
  email: z.string().trim().email("E-mail inválido").optional().or(z.literal("")),
  responsavelId: z.string().min(1, "Escolha o responsável"),
});

type FormValues = z.infer<typeof schema>;

type Vendedor = { id: string; nome: string };

/**
 * Formulário de criação de lead.
 *
 * Já teve uma prop `podeAtribuirOutraPessoa` que, para VENDEDOR, trocava o
 * `<select>` de responsável por um campo desabilitado com o próprio nome —
 * porque `criarLeadManualAction` clampava a escolha no servidor. A auditoria de
 * segurança mostrou que aquele clamp não impedia nada (bastava criar e
 * reatribuir) e que criar e editar discordavam. Com a regra unificada — lead
 * é colaborativo, todo papel atribui —, a prop deixou de ter sentido e saiu,
 * junto com o campo desabilitado.
 */
export function LeadForm({
  responsavelPadraoId,
  vendedores,
}: {
  responsavelPadraoId: string;
  vendedores: Vendedor[];
}) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  /**
   * `router.refresh()` devolve `void` e não dá para aguardar. Sem a
   * transição, `onSubmit` retornava no instante seguinte à chamada,
   * `isSubmitting` virava `false`, o botão voltava a "Adicionar lead" — e a
   * tabela só mudava quando o servidor respondesse, quase um segundo depois.
   * A pessoa lia "pronto" olhando para a lista velha.
   *
   * Dentro de `startTransition`, `isPending` só cai quando o render do
   * servidor chega. É a única forma de o botão contar a verdade sobre uma
   * atualização que não é síncrona.
   */
  const [atualizando, iniciarAtualizacao] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      telefone: "",
      email: "",
      responsavelId: responsavelPadraoId,
    },
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);
    setSucesso(false);

    // Nenhum identificador de autor é enviado: a action deriva quem age da
    // sessão (ver decisão de segurança da Task 13).
    //
    // O erro chega como DADO. Este componente tinha uma escada de comparações
    // contra `erro.message` — "Telefone inválido", "Sem permissão para criar
    // lead", "Não autenticado" — todas comparando texto escrito no servidor.
    // Renomear qualquer uma delas em `service.ts`/`dedupe.ts` apagaria a
    // tradução em silêncio: sem erro de tipo, sem teste vermelho no ponto da
    // mudança, e a pessoa passaria a ler "não foi possível criar o lead" para
    // um telefone que ela consegue corrigir sozinha.
    let resultado: ResultadoAcao;
    try {
      resultado = await criarLeadManualAction({
        nome: data.nome,
        telefone: data.telefone,
        email: data.email || undefined,
        responsavelId: data.responsavelId,
      });
    } catch (erro) {
      // A action não lança — a REDE lança. Sem este ramo, uma conexão que cai
      // entre o clique e a resposta deixaria o botão voltar ao normal sem
      // mensagem nenhuma, como se nada tivesse sido tentado. Ver
      // `registrarFalhaDeRede` em `src/lib/acao.ts`.
      setErroEnvio(registrarFalhaDeRede("Falha ao criar lead", erro));
      return;
    }

    if (!resultado.ok) {
      // De propósito NÃO chamamos `reset` aqui: em caso de erro a pessoa não
      // pode perder o que já preencheu (ela só quer corrigir o telefone, não
      // digitar tudo de novo).
      setErroEnvio(resultado.erro);
      return;
    }

    reset({ nome: "", telefone: "", email: "", responsavelId: responsavelPadraoId });
    setSucesso(true);
    iniciarAtualizacao(() => router.refresh());
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" {...register("nome")} />
        {errors.nome && <p className="text-xs text-red-600">{errors.nome.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="telefone">Telefone</Label>
        <Input id="telefone" {...register("telefone")} placeholder="(11) 98888-7777" />
        {errors.telefone && <p className="text-xs text-red-600">{errors.telefone.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="responsavelId">Responsável</Label>
        <select
          id="responsavelId"
          {...register("responsavelId")}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {vendedores.map((vendedor) => (
            <option key={vendedor.id} value={vendedor.id}>
              {vendedor.nome}
            </option>
          ))}
        </select>
        {errors.responsavelId && (
          <p className="text-xs text-red-600">{errors.responsavelId.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting || atualizando}>
        {isSubmitting || atualizando ? "Salvando..." : "Adicionar lead"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="w-full text-sm text-red-600">
          {erroEnvio}
        </p>
      )}
      {sucesso && !erroEnvio && (
        <p className="w-full text-sm text-green-600">Lead criado com sucesso.</p>
      )}
    </form>
  );
}
