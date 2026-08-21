import { Html, Body, Container, Text, Heading } from "@react-email/components";

/**
 * Template do e-mail "novo lead recebido", renderizado por `dispatch.ts`
 * (`notificarNovoLead`) e passado como `react` para `resend.emails.send`.
 *
 * Sem `import "server-only"`: `@react-email/components` é JSX puro, sem
 * Prisma nem nada sensível a segredo — nada aqui precisa (nem deveria)
 * bloquear import de um Client Component, embora hoje nenhum importe.
 */
/**
 * Template do e-mail de rajada destrutiva, renderizado por
 * `core/audit/alerta.ts` e enviado a cada ADMIN ativo da empresa (menos o
 * autor). Existe desde o reparo do achado 40 da auditoria: o alerta gravava só
 * a notificação in-app, então **o evento mais grave do sistema chegava pelo
 * canal mais fraco** — um badge no sino, que só é visto por quem estiver
 * logado e olhar.
 *
 * O conteúdo é EXATAMENTE o do payload in-app (`AlertaAtividadePayload`): nome
 * de quem agiu, quantas ações, em que janela. Nada de e-mail da pessoa, id de
 * entidade ou lista do que foi destruído — e-mail sai do perímetro do CRM e
 * fica na caixa de terceiros, então ele carrega menos, nunca mais, do que a
 * notificação que já é considerada segura o bastante para o sino.
 *
 * Sem link para o CRM de propósito: a rota que mostraria o `AuditLog` filtrado
 * não existe, e um link quebrado num alerta de segurança treina o leitor a
 * ignorar o próximo.
 */
export function AlertaAtividadeEmail({
  autorNome,
  total,
  janelaMinutos,
}: {
  autorNome: string;
  total: number;
  janelaMinutos: number;
}) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Atividade destrutiva em rajada</Heading>
          <Text>
            {autorNome} executou {total} ações sensíveis (exclusões, desativações, exportação
            de dados) nos últimos {janelaMinutos} minutos.
          </Text>
          <Text>
            Se isso não era esperado, revise o histórico de auditoria e considere desativar a
            conta enquanto apura.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function NovoLeadEmail({ contatoNome, etapaNome }: { contatoNome: string; etapaNome: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Novo lead recebido</Heading>
          <Text>
            {contatoNome} entrou no funil na etapa &quot;{etapaNome}&quot;.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
