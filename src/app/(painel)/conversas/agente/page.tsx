import { redirect } from "next/navigation";
import Link from "next/link";

import { exigirModulo } from "@/lib/module-gate";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { lerConfigBot } from "@/modules/whatsapp/agente";
import { AgenteForm } from "@/components/agente-form";

/**
 * Configuração do agente de IA — ADMIN apenas.
 *
 * A rota é `/conversas/agente`, segmento ESTÁTICO convivendo com o dinâmico
 * `/conversas/[id]`. O Next resolve estático antes de dinâmico, então esta
 * página sempre ganha; uma conversa cujo id fosse literalmente "agente"
 * ficaria inacessível, o que não acontece com ids `cuid()`. Registro isto
 * aqui porque, quebrando, o sintoma parece bug de dado ("por que a conversa
 * X não abre?") e não tem nada a ver com dado — é resolução de rota.
 *
 * Não vira item de menu de propósito: o painel já tem sete entradas e esta é
 * uma tela de uso raro, alcançada pelo link "Configurar agente" no cabeçalho
 * de `/conversas/[id]`.
 *
 * `(painel)/layout.tsx` já garante sessão válida antes de qualquer página
 * deste route group renderizar — `usuarioAtual()` aqui não repete essa
 * checagem, só lê o papel para o gate de permissão abaixo.
 */
export default async function AgentePage() {
  exigirModulo("whatsapp");

  const usuario = await usuarioAtualOuLogin();
  if (!hasPermission(usuario.papel, "configurar_agente")) {
    redirect("/conversas");
  }

  const config = await lerConfigBot(usuario.id);

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/conversas" className="text-sm text-muted-foreground hover:underline">
          ← Conversas
        </Link>
        <h1 className="text-xl font-semibold">Agente de atendimento</h1>
        <p className="text-sm text-muted-foreground">
          Personalidade, regras e perguntas frequentes usadas em toda resposta automática.
        </p>
      </div>

      <AgenteForm config={config} />
    </div>
  );
}
