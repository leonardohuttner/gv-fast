# GV Fast

Client leve e local para o **Portal Professor do Senac RS** (APSWEB / GVdasa GV College).

O portal oficial é lento, espalha as tarefas por várias telas e tem problemas de cadastro — o principal é a **sala dividida**: uma mesma sala física aparece como duas (ou mais) turmas, e o professor precisa lançar tudo duas vezes. O GV Fast junta essas turmas, organiza o dia do professor e grava no portal por ele, sempre conferindo o que foi gravado.

> Uso pessoal, com a conta do próprio professor. O app não guarda senha, não contorna nenhuma proteção do portal e roda só na sua máquina.

---

## O que ele faz

| Tela | Para quê |
|---|---|
| **Hoje** | Abre direto no seu dia: chamadas **atrasadas**, aulas de **hoje**, **amanhã** e das próximas semanas — de todas as turmas e anos, já com as salas divididas juntas. Um clique abre a chamada certa no dia certo. |
| **Turma › Chamada** | Calendário só com os dias de aula (pendente / lançada / cancelada). Lista **única** de alunos das turmas da sala, 3 horas por aula, presença/falta/falta justificada/atraso. Alunos desistentes/evadidos aparecem travados. |
| **Turma › Avaliações** | Indicadores do currículo já importados; cria "uma avaliação por indicador" (Trabalho 1/tb1, Trabalho 2/tb2…) em um clique e grava em todas as turmas da sala. |
| **Caderno** | As observações do diário (um bloco de notas por disciplina) com atalhos: `[30/09] Atraso: Fulano — …`. |
| **Todas as turmas** | Turmas dos últimos/próximos anos com datas de início e fim, vínculos de sala dividida e o botão **"Não é minha"** (substituições). Encerradas ficam escondidas. |

Toda gravação pede confirmação e, em seguida, **relê o portal e compara** com o que foi marcado. Divergências aparecem na tela.

---

## Como funciona

```
┌──────────────┐   JSON    ┌──────────────────────────┐   HTTP (sessão do professor)   ┌──────────────────┐
│  Front Vue   │ ───────▶ │  Servidor local (Node)   │ ─────────────────────────────▶ │  Portal APSWEB   │
│  (navegador) │ ◀─────── │  127.0.0.1:5180          │ ◀───────────────────────────── │  (PHP / ExtJS)   │
└──────────────┘           └──────────────────────────┘                                 └──────────────────┘
                                    │
                                    └── app/data/  (cache de datas, vínculos, turmas ocultas — local, não versionado)
```

O portal **não tem API pública**. O servidor do GV Fast fala com os mesmos endereços internos que as telas do portal usam e esconde as esquisitices dele:

- **Login**: reproduz o formulário do portal, incluindo o `form_key` (um SHA-1 dos campos que o navegador calcula). A sessão fica **só em memória**; reiniciar o servidor = entrar de novo.
- **Turma "atual" na sessão**: o portal só trabalha com uma turma por vez (a última aberta). O servidor opera **em fila, uma turma por vez**, e antes de qualquer gravação **confere** se o portal abriu a turma/disciplina certa — se não, não envia nada.
- **IDs disfarçados**: os códigos de turma vão embaralhados na URL; o app codifica/decodifica sozinho.
- **Dados escondidos no HTML**: lista de turmas e dias de aula vêm dentro de `<script>`; o servidor extrai.

### Fluxo de uso

1. **Login** — CPF e senha (a unidade vem do `.env`). A senha vai direto para o portal.
2. **Atualização em segundo plano** — o servidor busca suas turmas (ano anterior, atual e próximo) e os dias de aula de cada uma, guardando em cache. Na primeira vez há uma tela de carregamento; nas próximas, a agenda abre na hora e se atualiza sozinha.
3. **Vínculo automático de salas divididas** — turmas com mesma disciplina e curso, códigos diferentes e aulas no mesmo dia viram uma sala só. Dá para desfazer (e o app lembra).
4. **Hoje** → clique na aula → **Chamada**:
   - dia pendente começa vazio (igual ao portal); "Aula realizada — todos presentes" e ajuste quem faltou;
   - **Salvar** grava cada aluno na turma dele, marca a aula como realizada e relê as turmas para conferir.
5. **Avaliações** → "Uma avaliação por indicador" → **Salvar**. Se o portal devolver um relatório de modificações, o app mostra e pede confirmação antes de gravar. Avaliação com a mesma sigla não é duplicada.

---

## Rodando

Requisitos: **Node 22+**.

```bash
cd app
npm install
cp .env.example .env    # ajuste GV_UNIDADE com a sua unidade ("empresa,unidade")
npm run dev             # http://localhost:5180
```

`GV_UNIDADE` é o valor da sua unidade na lista "Unidade" da tela de login do portal, no formato `empresa,unidade`.

Build de produção: `npm run build && npm start` (serve o `dist/` pelo mesmo servidor).

---

## API local

O front usa uma API JSON simples (só em `127.0.0.1`):

| Rota | |
|---|---|
| `POST /api/login` · `POST /api/logout` · `GET /api/sessao` | sessão no portal |
| `GET /api/agenda` | aulas por dia/sala + pendências + progresso da atualização |
| `GET /api/turmas` · `POST /api/turmas/ocultar` | turmas; marcar "não é minha" |
| `GET/POST /api/salas` · `DELETE /api/salas/:id` | salas (grupos de turmas) |
| `GET /api/salas/:id/aulas` | dias de aula da sala |
| `GET/POST /api/salas/:id/chamada` | ler / gravar frequência (com conferência) |
| `GET/PUT /api/salas/:id/observacoes` | caderno |
| `POST /api/salas/:id/resultado` | atualizar resultado (frequência/faltas) |
| `GET/POST /api/salas/:id/avaliacoes` | ler / gravar avaliações (com conferência) |

> A API local não tem senha própria: enquanto o servidor estiver rodando e logado, qualquer programa na sua máquina pode chamá-la. Não exponha a porta para a rede.

---

## Estrutura

```
app/
  server/
    index.mjs        API + Vite (dev) / dist (produção)
    portal.mjs       conversa com o portal: login, form_key, fila, conferência, diário, avaliações
    avaliacoes.mjs   monta a configuração de avaliações no formato do portal
    salas.mjs        vínculos de salas, vínculos recusados, turmas ocultas
    cache.mjs        cache de turmas e datas
  src/
    App.vue          navegação (Hoje · Turma · Todas as turmas)
    components/      Hoje, Chamada, Calendario, Caderno, Avaliacoes, Turmas, Login, Dialogo, Carregando
  data/              dados locais (não versionado)
context/CLAUDE.md    mapa técnico do portal (endpoints, formatos, regras)
```

---

## Segurança e privacidade

- Nada de CPF, senha, cookies ou tokens em código, arquivo, log ou commit. A senha só passa pela memória do servidor durante o login.
- Dados de alunos nunca são gravados em disco pelo app; `app/data/` guarda apenas códigos de turma, datas e preferências.
- O app **não contorna** WAF, bot manager ou CAPTCHA. Se o portal passar a exigir, o caminho é rodar como extensão do navegador.
- Toda escrita no portal: confirmação explícita + releitura para conferir.

## Problemas conhecidos do portal

- **Sala dividida** cadastrada como turmas separadas.
- **"Replicar configuração"** de avaliações quebrado (erro interno do portal). O GV Fast grava em cada turma, em série.
- O portal abre por padrão num ano sem turmas.

Vale reportar à TI do Senac — afeta outros professores.

## Próximos passos

- Digitação de notas (`digitarnotas.php5`).
- Calendário de aulas a partir de planilha (.xlsx).
