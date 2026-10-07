# GV Fast

Client leve e local para o **Portal Professor do Senac RS** (APSWEB / GVdasa GV College).

O portal oficial é lento, espalha as tarefas por várias telas e tem problemas de cadastro — o principal é a **sala dividida**: uma mesma sala física aparece como duas (ou mais) turmas, e o professor precisa lançar tudo duas vezes. O GV Fast junta essas turmas, organiza o dia do professor e grava no portal por ele, sempre conferindo o que foi gravado.

> Uso pessoal, com a conta do próprio professor. O app não guarda senha, não contorna nenhuma proteção do portal e roda só na sua máquina.

---

## O que ele faz

| Tela | Para quê |
|---|---|
| **Hoje** | Abre direto no seu dia: chamadas **atrasadas**, **aulas sem conteúdo registrado**, aulas de **hoje**, **amanhã** e das próximas semanas — de todas as turmas e anos, já com as salas divididas juntas. Um clique abre a chamada certa no dia certo. |
| **Turma › Chamada** | Calendário só com os dias de aula (pendente / lançada / cancelada / sem conteúdo). Lista **única** de alunos das turmas da sala, 3 horas por aula, presença/falta/falta justificada/atraso. Alunos desistentes/evadidos aparecem travados. Mostrador **horas dadas / carga horária** e **alerta de frequência** (limite de 25% de faltas; aviso quando restam 2 aulas ou menos). |
| **Turma › Chamada › Conteúdo** | Conteúdo **realizado** do dia (aula dada) ou **programado** (aula futura), da programação de aulas do portal, com "usar o programado". Grava em todas as turmas da sala. |
| **Turma › Avaliações** | Indicadores do currículo já importados; cria "uma avaliação por indicador" (Trabalho 1/tb1, Trabalho 2/tb2…) em um clique e grava em todas as turmas da sala. |
| **Turma › Notas** | Grade única dos alunos da sala por conceito (A / NA / PA). O professor marca as avaliações; **indicador** e **menção** se preenchem pela regra (indicador = avaliação; menção D só se todos os indicadores forem A) e podem ser trocados à mão. |
| **Turma › Plano de ensino** | Cria o plano (PTD) nas turmas da sala que ainda não têm: indicadores preenchidos do currículo, textos copiados de outra turma, rascunho guardado no navegador. Plano existente fica só leitura (aguarda aprovação). |
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
- **Sessão viva**: enquanto você estiver logado, o servidor faz uma chamada leve a cada 4 minutos para o portal não encerrar a sessão por inatividade. Se ela cair mesmo assim, o app volta para a tela de login (o portal devolve a página de login com "200 OK", e o app reconhece isso).
- **Cada tela, um formato**: o diário e as avaliações usam ExtJS (UTF-8), a programação de aulas usa uma biblioteca própria que envia em Latin-1 sem codificar o corpo, as notas exigem `form_key` em cada chamada de carga. O servidor reproduz cada uma exatamente como a tela do portal.
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
   - o painel **Conteúdo** registra o que foi dado na aula (ou o planejado, em dia futuro).
5. **Avaliações** → "Uma avaliação por indicador" → **Salvar**. Se o portal devolver um relatório de modificações, o app mostra e pede confirmação antes de gravar. Avaliação com a mesma sigla não é duplicada.
6. **Notas** → marque as avaliações (ou "todos A" por coluna) → confira indicador e menção → **Salvar**. O app grava turma a turma, pede ao portal o cálculo dos resultados e relê.
7. **Plano de ensino** → modelo PTD → preencha (indicadores automáticos, copiar de outra turma) → **Salvar** (em elaboração) ou **Salvar e enviar para aprovação**.

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

### App de desktop (.dmg / .exe)

O mesmo app empacotado com **Electron**: uma janela própria, sem terminal. O servidor do GV Fast roda escondido numa porta livre e os dados locais ficam na pasta de dados do app no sistema.

```bash
cd app
npm install
cp .env.example .env      # GV_UNIDADE com a sua unidade (o build lê daqui)
npm run dist:mac          # → app/release/GV Fast-<versão>-arm64.dmg   (Mac Apple Silicon)
npm run dist:win          # → app/release/GV Fast Setup <versão>.exe   (Windows 64 bits; dá para gerar no Mac)
npm run desktop           # abre o app de desktop sem empacotar (teste rápido)
```

- O build grava a unidade em `app/electron/config.json` (fora do git) e ela vai **dentro do instalador**: o instalador é de uso pessoal, **não publique**.
- Instaladores e saída do build ficam em `app/release/` (fora do git). Nada de binário no repositório.
- Apps não assinados: na primeira abertura, **Mac** → Ajustes do Sistema › Privacidade e Segurança › "Abrir mesmo assim"; **Windows** → SmartScreen › "Mais informações" › "Executar assim mesmo".
- Para atualizar: gere de novo e instale por cima (os dados locais são mantidos).

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
| `GET/POST /api/salas/:id/notas` | ler / gravar notas por conceito (com cálculo e conferência) |
| `GET/POST /api/salas/:id/plano` · `GET /api/turmas/:cpt/plano` | plano de ensino: criar nas turmas sem plano; ler plano de outra turma |
| `GET/POST /api/salas/:id/programacao` | conteúdo programado / realizado por dia (com conferência) |

> A API local não tem senha própria: enquanto o servidor estiver rodando e logado, qualquer programa na sua máquina pode chamá-la. Não exponha a porta para a rede.

---

## Estrutura

```
app/
  server/
    index.mjs        API + Vite (dev) / dist (produção)
    portal.mjs       conversa com o portal: login, form_key, fila, conferência, sessão; diário,
                     avaliações, notas, plano de ensino, programação de aulas
    avaliacoes.mjs   monta a configuração de avaliações no formato do portal
    notas.mjs        grade de notas por conceito: regras de indicador/menção e aplicação
    salas.mjs        vínculos de salas, vínculos recusados, turmas ocultas
    cache.mjs        cache de turmas, datas, carga horária e "dia tem conteúdo?"
  src/
    App.vue          navegação (Hoje · Turma · Todas as turmas)
    components/      Hoje, Chamada, Calendario, Conteudo, Caderno, Avaliacoes, Notas, Plano,
                     Turmas, Login, Dialogo, Carregando
  data/              dados locais (não versionado)
  electron/main.mjs  app de desktop: sobe o servidor e abre a janela
  scripts/           config-desktop.mjs (gera a configuração do build pessoal)
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
- A sessão expira sem redirecionar: devolve a página de login com "200 OK".
- Sem cabeçalhos de navegador, algumas páginas (plano de ensino) devolvem o JSON da última chamada AJAX no lugar da página.

Vale reportar à TI do Senac — afeta outros professores.

## O que já foi testado gravando no portal

| Tela | Situação |
|---|---|
| Chamada (inclusive sala dividida) | ✔ gravado e conferido |
| Plano de ensino | ✔ tela aberta e lida; criação a testar com o professor acompanhando |
| Avaliações | lida ✔ · gravação a testar |
| Notas | lida ✔ · gravação a testar |
| Conteúdo da aula (programação) | lida ✔ · gravação a testar (envio conferido contra o JS do portal) |
| Caderno (observações) | lido ✔ · gravação a testar |

Primeira gravação de cada tela: um item só, conferindo depois no portal.

## Próximos passos

- Testar a gravação de avaliações, notas, conteúdo e caderno.
- Atualização automática do app de desktop.
- Calendário de aulas a partir de planilha (.xlsx).
