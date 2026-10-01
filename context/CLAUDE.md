# GV Fast — client próprio para o Portal Professor (APSWEB / GVdasa GV College) — Senac RS

> Este arquivo é público junto com o repositório. **Nunca** colocar aqui (nem em código, commits, logs ou prints):
> CPF, senha, valores ou nomes de cookies/tokens, nomes de alunos/professores, matrículas, códigos reais de turma/usuário/unidade.
> Exemplos usam valores fictícios.

## Objetivo
Client leve que consome o Portal Professor, pensado na rotina do professor:
1. **Login simples** — só CPF + senha (unidade fixa via `.env`).
2. **Sala dividida** — uma sala física cadastrada como **2+ turmas**. O client agrupa numa sala virtual, mostra **uma lista única** (cada aluno pertence a UMA turma), grava cada aluno **na turma dele** e **relê para conferir** (registro oficial).
3. **Agenda** — o professor não precisa saber em que ano/turma a aula está: tela "Hoje" com atrasadas, hoje, amanhã e próximos dias.
4. **Fluxo completo**, nas turmas da sala de uma vez: configurar avaliações → lançar notas → chamada → digitação final de notas.
5. (Depois) calendário de aulas a partir de .xlsx.

Uso pessoal, com a conta do próprio professor. Não virar multiusuário sem aval da TI do Senac.

## O sistema (portal)
- Base: `https://apsweb.senacrs.com.br/modulos/professor/` — PHP (`.php5`), ExtJS 3/4, jQuery.
- Respostas misturadas: HTML/XML em ISO-8859-1, alguns JSON em UTF-8 (olhar o `content-type`).
- Há WAF/bot manager na frente. **Não contornar** WAF/bot manager/CAPTCHA. Requisições via Node funcionam normalmente.
- Sessão por cookies (guardados só em memória no servidor do app).

### Login (formulário tradicional)
1. `GET login.php5` (abre sessão).
2. `POST login.php5?view=ajax` — carrega unidades: `form_key=sha1(urlEncode('loadUnidades'+base))`, `ViewLoginAjax[method]=loadUnidades`, `base`. Resposta XML.
3. `POST login.php5?` (form-urlencoded): `dbList=PHOENIXHA/GVDASA_GVCOLLEGE`, `lstUnidades=<empresa,unidade>`, `usr=<CPF>`, `passwd=<base64 da senha>`, `base=`, `postBack=1`, `acao=login`, `ViewLoginXmlXsl[method]=btnLogin_click`, `form_key`.
4. Sucesso = HTML com `location.assign('index.php5')`.

**`form_key`** não vem do servidor: `hashFormulario()` (`/lib/system/js/lib.js`) = `sha1(urlEncode(valores dos campos concatenados na ordem do DOM))`,
com `urlEncode = escape()` + `+→%2B`, `@→%40`, `*→%2A`, `/→%2F`, `%20→+`. A página carrega reCAPTCHA mas não usa no form; se passar a exigir, parar.

### IDs ofuscados
`ofuscado = base64(cada byte XOR 0xAA)`. Ex.: `"2025"` → `mJqYnw==`. O app gera/decodifica sozinho.

### Turmas
- Lista por ano: `POST index.php5` (multipart): `prof=`, `anos=<enc(ano)>`, `semestre=-2`, `curso=-2`, `postBack=1`, `acao=aplicaFiltros`.
  HTML traz `GridIndex.addArray(ano, sem, enc(codigoturma), curso, ciclo, turma, unidade, disciplina, enc(codigoProfessorTurma), notasCalc, sala, …, dataIni, dataFim)` (datas vazias).
- O portal abre por padrão num ano futuro (lista vazia); o app busca ano anterior, atual e próximo.
- **Código de turma não é único** (uma turma pode ter várias disciplinas). Chave única = `codigoProfessorTurma` (cpt).
- O portal não indica turmas de substituição → o app permite marcar "Não é minha" (fica só local).

### ⚠ Turma "atual" fica na sessão
Toda tela de turma (diário, avaliações, notas) usa a **última turma aberta** em
`turmas.php5?anos=<enc>&semestre=-2&curso=-2&codigoProfessorTurma=<enc>` — o parâmetro `?turma=` do diário é ignorado para os dados.
→ Operar **uma turma por vez, em série**, e **conferir antes de gravar**: o HTML do diário expõe `DiarioClasse.codigoProfessorTurma`, que precisa bater com o esperado.

### Diário de classe (`diarioClasse.php5?turma=<enc(codigoturma)>`)
- O GET embute os dias letivos: `DiarioClasse.aulasDiario = Ext.decode('[{modulo, data, descricaoTurno, periodos{…situacao}}]')`, e `DiarioClasse.codigoUsuario`.
- AJAX: `POST` mesma URL, form-urlencoded, `X-Requested-With`, `ViewDiarioClasseXmlXsl[method]=<método>` → `{success, errorcode, errormsg, total, data}`.
- `loadAlunosAulaDiario` (`data`, `modulo`, `codigoEmpresaPolo=`, `codigoUnidadePolo=`) → alunos com `enturmacao`, `nome`, `descricaoResultado`, `permiteDigitarFrequencia`, `percentual`, `periodos{d<data>t<turno>p<n>: {diarioClasse, diarioClasseAluno, enturmacaoVinculo, indicadorPresenca, justificativaFalta, turmaHorariosEad, situacao}}`.
- `salvaIndicadoresAula` (✔ testado): `periodos` = JSON `[{diarioClasse, situacao:1}]` (só se a aula ainda não estava realizada), `indicadores` = JSON `[{enturmacao, enturmacaoVinculo, diarioClasse, diarioClasseAluno, indicadorPresenca, justificativaFalta, turmaHorariosEad, editAfast}]`, `modulo`, `empresa=false`, `unidade=false`.
- Indicadores: 1 presença, 2 falta, 3 falta justificada, 4 atraso. Situação da aula: 0 não realizada, 1 realizada, 2 cancelada.
- **Dia não realizado**: o portal mostra "–" em todos os períodos e ignora o que estiver guardado no banco. O app faz igual.
- Cada aula = 3 períodos (horas), cada um com sua presença.
- Observação ("caderno"): **um texto por turma + módulo** (não por dia). `getObservacaoDiarioClasse` / `salvarObservacaoDiarioClasse` com `numeroModulo`, `codigoUsuario` (+ `observacao`).
- `atualizaResultado` (sem parâmetros): recalcula frequência/faltas.

### Configurar avaliações (`configuraravaliacoes.php5`)
- JS: `presenters/EditarParciais/EditarParciais.js` + componente `Ext.gvux.ConfigAvaliacao.js`.
- Página embute `Page.descricaoTurma`, `Page.tipoAvaliacaoTurma` (`'C'` = conceito), regras de base curricular.
- Leituras (POST, prefixo `configuraravaliacoes.php5?ViewEditarParciaisXmlXsl[method]=`): `ajax_loadModulos`, `ajax_loadDadosAvaliacao` (moduloAtual), `ajax_loadParciais` (moduloAtual), `ajax_loadFormulas`.
  Indicadores do currículo: `GET editarparciais.php5?ViewEditarParciaisXmlXsl[method]=ajax_loadParciaisIndicadores` → `[{id:'I1', descricao, descricaoreduzida, peso}]`.
- Tipos: 5 Conceito, 6 Fórmula por conceito (turmas por conceito); 1 Somada, 2 Média aritm., 3 Média pond., 4 Fórmula por nota.
- Modelo: tipo Conceito → **indicadores viram parciais** → professor cria **avaliações como subparciais** de cada indicador.
  - Parcial nova: `{codigoParcial:-n, codigoParcialPai:null, idParcial:'I1', descricao, descricaoReduzida, peso, modoCalculoSubparciais:5, ordem, parcialBonus:0}`
  - Subparcial nova: `{codigoParcial:-n, codigoParcialPai:<pai>, idParcial:-n, descricao(≤600), descricaoReduzida(≤10), modoCalculoSubparciais:' ', ordem, peso:'', parcialBonus:0}` (temporários negativos)
  - Regra: todo indicador precisa de ≥1 avaliação.
- Salvar: `ajax_salvaDados` com `moduloAtual`, `dados` (JSON), `parciais` (JSON lista plana), `confirma` 0|1. Se `data.salvo` falso → vem `data.relatorio` → mostrar e reenviar com `confirma=1`.
- **"Replicar configuração" do portal está quebrado** (erro PHP `Undefined constant "_MODULO_ATUAL_"`). O app grava em cada turma, em série.
- Convenção do professor: 1 avaliação por indicador, "Trabalho N" / `tbN` (ou "Prova N" / `pvN`), em sequência.

### A mapear
- Digitação de notas (`digitarnotas.php5`).

## O app (`app/`)
Vue 3 + Vite (front) + servidor Node sem framework (`app/server/`), um processo só, só em `127.0.0.1:5180`.
- Rodar: `npm --prefix app run dev` (configuração em `app/.env`, ver `app/.env.example`).
- `server/portal.mjs` — sessão no portal: login, `form_key`, fila em série, conferência de turma, diário, observações, avaliações.
- `server/index.mjs` — API JSON usada pelo front (`/api/login|sessao|agenda|turmas|salas|salas/:id/{aulas,chamada,observacoes,resultado,avaliacoes}`).
- `server/salas.mjs` — vínculos (automáticos: mesma disciplina+curso, turmas diferentes, ≥1 dia em comum), vínculos recusados, turmas ocultas.
- `server/cache.mjs` — cache de turmas/datas para a agenda abrir na hora; atualiza em segundo plano após o login.
- `server/avaliacoes.mjs` — monta a configuração de avaliações no formato do portal (idempotente por sigla).
- `app/data/` — dados locais (cache, vínculos). **Não versionado.**
- Navegadores embutidos podem bloquear `confirm()/prompt()` → o app usa diálogo próprio (`src/dialogo.js`).

## Regras
- Credenciais só pela tela de login do app (ou variável de ambiente); nunca em arquivo, log ou commit.
- Logs sem valores de cookie, sem dados de aluno.
- Toda escrita no portal: confirmação explícita do professor + releitura para conferir.
- Não contornar WAF/bot manager/CAPTCHA.
- Recomendado: reportar à TI do Senac a turma dividida e o "Replicar configuração" quebrado.
