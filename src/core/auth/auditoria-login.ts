import { registrarAuditoria } from "@/core/audit/log";

/**
 * A porta de entrada deixa rastro.
 *
 * ## O achado
 *
 * Item 39 da auditoria de 2026-08-21
 * (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`): troca de
 * senha e exclusão eram auditadas; **login, logout e tentativa falha não**, e
 * isso não constava como decisão adiada em spec nenhum.
 *
 * O `RateLimit` não substitui, por três motivos medidos: ele conta acerto e
 * erro JUNTOS (`core/rate-limit/login.ts` — "toda tentativa consome uma
 * unidade, certa ou errada"), é volátil (janela de 10 minutos) e guarda
 * contagem, não o par conta/IP/instante. Na pergunta que importa depois de um
 * vazamento — *quem entrou nessa conta, de onde, e quando* — não havia o que
 * consultar.
 *
 * ## O que é gravado, e o que NUNCA é
 *
 * `antes`/`depois` ficam VAZIOS nas três ações, e isso é o precedente literal
 * de `redefinirSenha` (`core/users/service.ts`), que audita sem os dois
 * "porque não há nada aqui que seja seguro guardar". Aqui vale igual e por um
 * motivo mais direto: o único dado que o evento carrega além do identificador
 * é a SENHA TENTADA. Ela não entra em lugar nenhum — nem em claro, nem em
 * hash, nem em tamanho. Um hash de senha tentada é um oráculo offline pronto
 * para quem alcançar o log; o TAMANHO dela reduz o espaço de busca de graça.
 *
 * O que se grava é `entidade: "User"` + `entidadeId: <id de quem entrou>` +
 * `ip` + `criadoEm` (padrão da tabela). É exatamente o par conta/IP/instante
 * que faltava.
 */

/** Login aceito. */
export const ACAO_LOGIN = "login";

/** Sessão encerrada pelo botão "Sair". */
export const ACAO_LOGOUT = "logout";

/**
 * Prefixo estável da linha de log de tentativa recusada.
 *
 * Estável de propósito: é por ele que se filtra no painel de logs da Vercel, e
 * mudá-lo quebra a busca de quem estiver investigando. `tests/unit/auditoria-login.test.ts`
 * trava o texto.
 */
export const PREFIXO_TENTATIVA_RECUSADA = "[auditoria] login recusado";

/**
 * Grava a linha de login/logout, sem nunca derrubar quem está entrando ou
 * saindo.
 *
 * ## Fail-OPEN aqui, ao contrário da exportação de leads
 *
 * `app/(painel)/export/leads/route.ts` é fail-closed: se o log não grava, o
 * CSV não sai. A diferença tem razão, e é a mesma que `registrarAuditoria` já
 * aplica ao alerta de rajada. Lá o log ERA o controle — sem ele, o dado
 * pessoal sairia sem rastro nenhum. Aqui, derrubar o login porque o banco
 * recusou uma linha de auditoria transforma um problema de registro numa
 * negação de serviço do sistema inteiro, disparável por qualquer falha
 * transitória do Postgres. E derrubar o LOGOUT seria pior ainda: a pessoa
 * clica em "Sair" e continua logada, que é literalmente o defeito que o
 * `AGENTS.md` conta.
 *
 * A falha vai para o log do servidor com o mesmo prefixo das tentativas
 * recusadas, para que "sumiram as linhas de login" seja uma pergunta
 * respondível.
 */
async function gravarEventoDeSessao(input: {
  acao: string;
  userId: string;
  companyId: string;
  ip?: string;
}): Promise<void> {
  try {
    await registrarAuditoria({
      companyId: input.companyId,
      userId: input.userId,
      acao: input.acao,
      entidade: "User",
      entidadeId: input.userId,
      // `antes`/`depois` ausentes de propósito — ver o topo do arquivo.
      ip: input.ip,
    });
  } catch (erro) {
    console.error(`${PREFIXO_TENTATIVA_RECUSADA} — falha ao gravar ${input.acao}:`, erro);
  }
}

/**
 * Login aceito.
 *
 * `companyId` vem do vínculo (`Membership`) de quem acabou de entrar, lido na
 * MESMA consulta que já buscava o usuário em `autorizarCredenciais` — sem ida
 * extra ao banco e, principalmente, sem `prisma.company.findFirst()`, que
 * ignora quem está pedindo e vaza no dia da segunda empresa (a proibição está
 * escrita em `core/users/empresa.ts`).
 *
 * Quem não tiver exatamente um vínculo não chega aqui: `autorizarCredenciais`
 * pula a auditoria e registra a anomalia no log do servidor. É o mesmo
 * critério que `usuarioAtual()` já aplica — zero vínculo é sessão inválida,
 * mais de um LANÇA em vez de escolher (`EmpresaAmbiguaError`).
 */
export async function auditarLogin(input: {
  userId: string;
  companyId: string;
  ip?: string;
}): Promise<void> {
  await gravarEventoDeSessao({ ...input, acao: ACAO_LOGIN });
}

/** Sessão encerrada pelo botão "Sair". */
export async function auditarLogout(input: {
  userId: string;
  companyId: string;
  ip?: string;
}): Promise<void> {
  await gravarEventoDeSessao({ ...input, acao: ACAO_LOGOUT });
}

/**
 * Sanitiza um valor controlado pelo cliente antes de ele entrar numa linha de
 * log.
 *
 * O e-mail tentado vem do corpo de um POST **publico e nao autenticado**. Uma
 * quebra de linha nele forja uma linha de log inteira ("log injection"), e e
 * assim que um atacante planta evidencia falsa exatamente no arquivo em que
 * alguem vai procurar a verdade depois. Espaco em branco e caractere de
 * controle (a faixa U+0000..U+001F cobre CR, LF, tab e o escape ANSI que um
 * terminal interpretaria) viram um ponto medio.
 *
 * O corte em 200 caracteres e o mesmo de `chaveDaConta`
 * (`core/rate-limit/login.ts`), e pelo mesmo espirito: entrada de endpoint
 * aberto nao define o tamanho do que a gente escreve.
 *
 * O hifen NAO e tocado: e caractere legitimo de e-mail, e apaga-lo tornaria a
 * linha inutil para busca. A primeira versao desta funcao escrevia a classe
 * como `[\s -]`, que casa o hifen literal por acidente -- o caso de
 * `auditoria-login.test.ts` que exige `e2e-admin` intacto trava isso.
 */
function paraLinhaDeLog(valor: string): string {
  return valor.replace(/[\s\u0000-\u001f\u007f]/g, "·").slice(0, 200);
}

/**
 * Tentativa de login recusada.
 *
 * ## POR QUE ISTO NÃO VAI PARA O `AuditLog` — decisão, não esquecimento
 *
 * Foi decidido aqui, na Fase 2 da auditoria (2026-08-21), e o relatório em
 * `.superpowers/sdd/fase2a-seguranca.md` deixa a alternativa escrita para o
 * dono reabrir. As três razões:
 *
 * **1. O schema não comporta metade dos casos.** `AuditLog.userId` é FK
 * OBRIGATÓRIA para `User` e `AuditLog.companyId` é `NOT NULL`. Uma tentativa
 * com e-mail que não existe não tem nem um nem outro. Inventar um usuário
 * (uma conta "anônima", a conta de sistema do WhatsApp) contaminaria o rastro
 * de alguém real com ações que não foram dele — e o rastro é justamente o que
 * se lê para saber de quem foi o quê.
 *
 * **2. Gravar só a metade identificável reabre o oráculo de enumeração que
 * este projeto já pagou para fechar.** `HASH_INERTE`
 * (`core/auth/credenciais.ts`) existe porque o RELÓGIO entregava a resposta:
 * e-mail inexistente respondia ~3x mais rápido (0,24 s contra 0,08 s,
 * medidos). Um `INSERT` no `AuditLog` só quando a conta existe recria a mesma
 * diferença — mediana de 85 ms por consulta neste banco (`sa-east-1`, medido
 * no Ciclo 1f) sobre uma base de ~240 ms de bcrypt. E torna a própria tabela
 * um oráculo: "tem linha de tentativa, logo esta conta existe".
 *
 * **3. Assim as duas metades custam o mesmo.** Esta função é chamada no MESMO
 * ponto, com o mesmo trabalho, para conta existente e inexistente. É a mesma
 * postura de `checarLimiteLogin`, que consome cota mesmo para e-mail que não
 * existe pelo mesmo motivo escrito lá.
 *
 * ## O que se perde, dito na cara
 *
 * Retenção. Log de runtime da Vercel é curto (horas a dias, conforme o
 * plano), enquanto uma linha de `AuditLog` é permanente. Para "quem ENTROU
 * nessa conta" — a pergunta do achado — a resposta é permanente, porque
 * `auditarLogin` grava. Para "quem TENTOU", a resposta é o log e o
 * `RateLimit`, e dura pouco.
 *
 * A alternativa que fecharia isso é uma tabela `LoginAttempt` própria, sem FK
 * para `User` — que é decisão de schema (RLS, contagem de tabelas do
 * `banco-blindado.spec.ts`, poda) e não cabia numa correção de segurança sem
 * o dono. Fica escrita.
 *
 * ## Por que `conta` aparece na linha
 *
 * `existente`/`inexistente` é dado do SERVIDOR, não da resposta HTTP — quem
 * está atacando não vê esta linha. Para quem investiga, é a diferença entre
 * "alguém está martelando uma conta real" e "alguém está varrendo e-mails no
 * escuro", que pedem reações diferentes. O e-mail em si já é persistido hoje,
 * em `RateLimit.chave` (`login:conta:<email>`), para os dois casos.
 */
export function registrarTentativaRecusada(input: {
  email: string;
  ip: string;
  conta: "existente" | "inexistente";
  motivo: "credenciais" | "limite" | "desativada";
}): void {
  console.warn(
    `${PREFIXO_TENTATIVA_RECUSADA} email=${paraLinhaDeLog(input.email)} ` +
      `ip=${paraLinhaDeLog(input.ip)} conta=${input.conta} motivo=${input.motivo}`
  );
}
