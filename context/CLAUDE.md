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
- **Sessão expira por inatividade** e o portal NÃO redireciona: devolve a página de login com 200 (`<title>Login - APSWEB`). O `#req` detecta isso e lança `SessaoExpirada` (app volta para o login).
  O servidor faz um "keep-alive" a cada 4 min enquanto logado (`app.php/Configuracoes?…loadConfiguracoes`).

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
- Indicadores: 1 presença, 2 falta, 3 falta justificada, 4 atraso.
- **Falta justificada (3) leva motivo** em `justificativaFalta` (por período). Lista: `getJustificativasFalta` (`filtroSexo=-1`, `filtroIdade=-1`, `tipoFaltaJustificada=1`) → `{rows:[{CODIGO, DESCRICAO, LEGENDA, TIPOMARCACAO ('FJ'|'EC'), SEXO (null|'M'|'F'), IDADEMINIMA, IDADEMAXIMA}]}` (sem `success`). 20 motivos (ex.: AM atestado médico, AC, ACI, DL, FM, LN, LP; EC entrada em curso). Restrições de sexo/idade (0 = sem limite); o portal pula alunos fora da regra. Trocar para outro indicador zera o motivo.
- `loadAlunosAulaDiario` traz `sexo` ('M'/'F') e `dataNascimento` ('AAAA-MM-DD hh:mm:ss'); o app calcula só a idade no servidor. Situação da aula: 0 não realizada, 1 realizada, 2 cancelada.
- **Dia não realizado**: o portal mostra "–" em todos os períodos e ignora o que estiver guardado no banco. O app faz igual.
- Cada aula = 3 períodos (horas), cada um com sua presença.
- Carga horária: `DiarioClasse.cargaHorariaBase` no HTML do diário. Horas dadas = períodos com situação 1 (ex.: 9 dias × 3 = 27 "aulas dadas" do portal).
- Frequência mínima 75% da carga horária → limite de faltas = 25% (ex.: 60 h → 15 h). `totalFaltas` do aluno vem em horas.
  App: mostrador horas dadas / carga na Chamada + alerta quando restam ≤ 2 aulas de falta (amarelo) ou limite atingido/ultrapassado (vermelho).
- Observação ("caderno"): **um texto por turma + módulo** (não por dia). `getObservacaoDiarioClasse` / `salvarObservacaoDiarioClasse` com `numeroModulo`, `codigoUsuario` (+ `observacao`).
- `atualizaResultado` (sem parâmetros): recalcula frequência/faltas.

### Plano de ensino (`planoensino.php5`, mapeado — NADA gravado)
- Depende da turma da sessão. JS: `presenters/PlanoEnsino/document.view.PlanoEnsino.js` (+ `lib/shared/js/PlanoEnsinoLib.js` só templates).
- Página embute `PlanoEnsino.codigo` (vazio = sem plano), `PlanoEnsino.situacao`, `PlanoEnsino.aprovacaoPlanoPeloCoord`, permissões (copiar, enviar, excluir).
- Situação: 0 não criado, 1 em elaboração, 2 aguardando aprovação, 3 aguardando revisão, 4 aprovado.
- Todas as chamadas: `POST planoensino.php5` com `ViewPlanoEnsinoXmlXsl[method]=<m>`, `asJSON=true`:
  - `getModelos` → modelos `[{codigo, descricao, ativo}]` (ex.: 10 = PTD Plano de Trabalho Docente, 11 = PTD PI Planejamento Integrado do Curso).
  - `getTreeCamposModelo` (`codigoModelo`) → árvore de campos `{codigo, descricao, ordem, tipo, filhos}`.
    Tipos: R resumo (agrupa), U texto do professor (obrigatório), E/B/C/P só leitura vindos da base (`getValorCampoModelo`, `tipoCampo`).
    PTD (10): 1.1 Indicadores da UC (22), 1.2 Elementos da Competência (23), 1.3 Situações de Aprendizagem (24), 1.4 Recursos Didáticos (25), 1.5 Avaliação (26), 1.6 Contribuições da UC para o PI (27) — todos U.
    PTD PI (11): Indicadores, Tema Gerador, Desafios, Contribuições de cada UC para o PI, Problematização, Desenvolvimento, Síntese — todos U.
  - `getTreeCamposPlano` (`codigoPlanoEnsino`) → plano existente: mesmos campos com `codigo` (do plano), `campo` (do modelo), `conteudo`.
  - `getDadosCabecalho`, `getDadosCurriculo` (`codigoPlanoEnsino`), `getHistorico` / `getHistoricoByTipo`, `efetuaExclusaoPlanoEnsino`.
  - **Salvar**: `savePlanoEnsino` com os valores do form + `situacao`, `acessoCoordenador`, `updateClicked`, `acaoSalvar` (1 = salvar → situação 1; 2 = salvar e enviar → 2 se precisa aprovação do coordenador, senão 4).
    Form de plano novo: `modelo=<cod>`, `codigo=`, e por campo `campos[<campo>][campo]`, `campos[<campo>][ordem]` (ex. "1.1"), `campos[<campo>][conteudo]`.
    Plano existente: chave é o `codigo` do plano e o hidden vira `campos[<codigo>][codigo]`.
  - **Copiar para outras turmas**: `getTurmasProfessor` (lista; veio vazia na turma testada) → `copiarPlanoTurma` com `turmas` = JSON `[codigoTurma…]`, `acaoSalvar=1`.
- **Plano existente não pode ser alterado pelo professor** (aguarda aprovação) → o app só CRIA plano em turma sem plano; existentes ficam só leitura.
- Quirk: sem cabeçalhos de navegador, o GET de `planoensino.php5` pode devolver o JSON da última chamada AJAX. **Resolvido mandando `Accept: text/html…` + `Referer` (página da turma)** em todo GET de página (`#req`); o app ainda tem 2 caminhos de reserva e confere `PlanoEnsino.codigo` no HTML.
- No app: sub-aba "Plano de ensino" (`src/components/Plano.vue`), rotas `GET|POST /api/salas/:id/plano`, `GET /api/turmas/:cpt/plano` (copiar textos de outra turma); rascunho em localStorage.
- Indicadores do PTD (1.1) são os mesmos do currículo usados em avaliações (`ajax_loadParciaisIndicadores`) → dá para preencher automático.

### Digitação de notas (`digitarnotas.php5`, mapeado — NADA gravado)
- Depende da turma da sessão. JS: `presenters/DigitarNotas/DigitarNotas.js` + `core/js/Formula.Base.js`.
- Página embute `DigitarNotas.emEdicao` (módulo) e `DigitarNotas.controleDigitacao`.
- Chamadas de carga levam **form_key** via `createExtAjaxFormKey`: `form_key = sha1(urlEncode(concat dos valores de hashParams, na ordem))`:
  1. `getNextStep` (`step`, `controleDigitacao`, `modulo`) — começa em `step=e00` e segue `data.proximaEtapa.id` até vir `null`.
  2. `getInfoDigitacao` (`modulo`) → parâmetros: `formaAvaliacao` ('C' conceito / 'N' nota), `conceitos.parcial` ([' ','A','NA','NC','PA']), `conceitos.modulo` ([' ','D','ND','SM']), `numeroDecimais`, `aulasDadas`, `cargaHoraria`, nomes de colunas…
  3. `getAvaliacoesModulo` (`controleDigitacao`, `modulo`) → estrutura: parciais (indicadores) `P<cod>` e subparciais (avaliações) `<id>` com `compoe`/`compostaDe`, `descRed`, `modoCalculoSubparciais`.
  4. `GET digitarnotas.php5?ViewDigitarNotasXmlXsl[method]=getNotasTurma&modulo=<m>&codigoEmpresa=null&codigoUnidade=null` → `rows[]` por aluno.
- Campos por aluno: `<idParcial>` valor; `CD_<id>` código do item; `D_<id>`/`DJ_`/`DL_`/`DD_` dispensa; `NM_<mod>` menção (conceito do módulo), `CDN_`, `FM_<mod>` faltas, `CDF_`, `CDM_`, `DM_`; `RES` resultado; `EDT` editável; `DCS` situação do aluno; `NOM`/`MAT` (dados pessoais — nunca logar).
- **Conceito sem fórmula (formaCalculo 5, idFormula vazio): o portal NÃO calcula** indicador nem menção — o professor preenche avaliação, indicador e menção.
- Salvar: `salvarNotas` (sem form_key) com `modulo`, `codigoControleDigitacao`, `aulasDadas`, `decimais`, `formaAvaliacao`, `notas` = JSON `{ALUNOS:[{NOTAMODULO:{CODIGOAVALIACAOITEM,VALORAVALIACAO,CODIGODISPENSA}, FALTAMODULO:{…}, PREVENTIVA:{…,NAOCOMPARECEU}, MEDIAMODULO:{CODIGOAVALIACAOITEM,CODIGODISPENSA}, PARCIAIS:[{CODIGOAVALIACAOITEM,VALORAVALIACAO,CODIGODISPENSA,IDPARCIAL}]}]}` (todos os alunos), `idsparciais[]` (lista, na ordem de `estruturaParciais.enviar`), `gvroute` (constante do JS).
  Depois: `calcularNotas` (sem parâmetros) → médias/resultados.
- Regras do professor (o app aplica; o portal não calcula): indicador = conceito da(s) avaliação(ões) dele; **menção D só se todos os indicadores forem A**, senão ND. Não usa NC nem SM.
- No app: sub-aba "Notas" (`src/components/Notas.vue`), `server/notas.mjs` (visão/regras/aplicação), rotas `GET|POST /api/salas/:id/notas`. Ainda não testado gravando.

### Programação de aulas (`programacao.php5`, mapeado — NADA gravado)
- Depende da turma da sessão. JS: `js/programa.js` (+ `js/copiarPrograma.js` para "Copiar programação").
- O GET embute um `PagePrincipal.addText(dataBR, 'AAAAMMDD', codigoProgramacao, 'AAAA-MM-DD 00:00:00', modulo, Base64.decode(programado), Base64.decode(realizado), editaProgramado, editaRealizado)` por dia, e `addDatasInicial(de, ate)`.
- **Conteúdo de aula é OPCIONAL** (o professor pode ou não preencher); **o diário/chamada é obrigatório**. O app mostra conteúdo pendente só de forma discreta.
- Regra observada: dia já dado → programado travado (0) e **realizado editável (1)**; dia futuro → programado editável (1) e realizado travado ("Aula não realizada").
- Salvar (botão Salvar, junta o que mudou): `POST programacao.php5?useAjaxView=1` com `ViewProgramacaoAjax[method]=ajax_autoSavePrograma`, `debugReqId`,
  e por campo alterado `textProgramaAula[<campo>][campo|valor|codigo|data|modulo|tipo]` (campo = `p<AAAAMMDD>` programado / `r<AAAAMMDD>` realizado; valor = urlEncode(texto + ' '); tipo = `programa` | `realizado`),
  `empresa`/`unidade` (null se não EAD) e `form_key = sha1(urlEncode('ajax_autoSavePrograma' + Σ(campo+valor+codigo+data+modulo+tipo)))` (valor já com urlEncode).
- Copiar programação: `ajax_loadDadosTurma`, `ajax_loadTurmas`, `ajax_copiarProgramacao` (não testado).
- O oAjax monta o corpo **sem codificar** (`nome=valor&`); só o valor passa por `urlEncode` (escape → Latin-1). O app replica byte a byte (`corpoCru` no `#req`) e troca caracteres fora do Latin-1 (`paraLatin1`). Valor e form_key conferidos contra o JS do portal.
- No app: painel "Conteúdo" na Chamada (`src/components/Conteudo.vue`), marca no calendário e aviso "Aulas sem conteúdo registrado" na tela Hoje; rotas `GET|POST /api/salas/:id/programacao`. O cache guarda só se o dia tem conteúdo (não o texto).
- Situação real (2026-10-06): turmas de Testes com 1 dia preenchido em ~12 dias dados; a de manutenção de redes 2026 sem nenhum dia preenchido.

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
- Plano de ensino: testar `savePlanoEnsino` e `copiarPlanoTurma` com o professor acompanhando.

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
