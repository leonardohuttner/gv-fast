<script setup>
// Plano de ensino: cria o plano nas turmas da sala que ainda não têm (plano existente não é alterado — aguarda aprovação).
// O rascunho fica salvo no navegador até ir para o portal.
import { ref, computed, watch, onMounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';
import Carregando from './Carregando.vue';

const props = defineProps({ sala: { type: Object, required: true } });
const emit = defineEmits(['expirou']);

const SITUACAO = { 0: ['Sem plano', ''], 1: ['Em elaboração', 'elab'], 2: ['Aguardando aprovação', 'aguard'], 3: ['Aguardando revisão', 'aguard'], 4: ['Aprovado', 'ok'] };
const MODELO_PADRAO = 10; // PTD - Plano de Trabalho Docente

const dados = ref(null);
const modelo = ref(null);
const textos = ref({});
const carregando = ref(false);
const msg = ref(null);
const fontes = ref([]);
const fonte = ref('');
const aba = ref(null);

const semPlano = computed(() => dados.value?.turmas.filter((t) => !t.codigo) ?? []);
const comPlano = computed(() => dados.value?.turmas.filter((t) => t.codigo) ?? []);
const camposU = computed(() => dados.value?.campos.filter((c) => c.tipo === 'U') ?? []);
const vazios = computed(() => camposU.value.filter((c) => !String(textos.value[c.campo] ?? '').trim()));
const turmaAba = computed(() => comPlano.value.find((t) => t.cpt === aba.value) ?? comPlano.value[0]);
const chaveRascunho = computed(() => `gvfast:plano:${props.sala.id}:${modelo.value}`);

// rascunho local (só neste navegador)
function lerRascunho() {
  try { textos.value = JSON.parse(localStorage.getItem(chaveRascunho.value) || '{}'); } catch { textos.value = {}; }
}
watch(textos, (v) => { try { localStorage.setItem(chaveRascunho.value, JSON.stringify(v)); } catch { /* sem storage */ } }, { deep: true });

async function executar(fn) {
  carregando.value = true;
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally { carregando.value = false; }
}

const carregar = () => executar(async () => {
  msg.value = null;
  dados.value = await api.plano(props.sala.id, modelo.value);
  if (!modelo.value) {
    modelo.value = dados.value.modelos.some((m) => m.codigo === MODELO_PADRAO) ? MODELO_PADRAO : dados.value.modelos[0]?.codigo;
    if (modelo.value) dados.value = await api.plano(props.sala.id, modelo.value);
  }
  lerRascunho();
  // turmas que podem servir de fonte de texto: mesma disciplina primeiro
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const minhas = new Set(props.sala.turmas.map((t) => String(t.cpt)));
  const disc = norm(props.sala.turmas[0].disciplina);
  fontes.value = (await api.turmas()).turmas.filter((t) => !minhas.has(String(t.cpt)) && !t.oculta)
    .map((t) => ({ ...t, mesma: norm(t.disciplina) === disc }))
    .sort((a, b) => b.mesma - a.mesma || b.ano.localeCompare(a.ano) || a.disciplina.localeCompare(b.disciplina));
});

function trocarModelo() {
  dados.value = null;
  carregar();
}

const preencherIndicadores = (c) => { textos.value = { ...textos.value, [c.campo]: dados.value.indicadores }; };

const copiarDe = () => executar(async () => {
  const cpt = fonte.value;
  fonte.value = '';
  if (!cpt) return;
  const p = await api.planoTurma(cpt);
  if (!p.codigo) { msg.value = { tipo: '', txt: 'Essa turma ainda não tem plano de ensino.' }; return; }
  const iguais = camposU.value.filter((c) => p.campos.some((x) => String(x.campo) === String(c.campo) && String(x.conteudo || '').trim()));
  if (!iguais.length) { msg.value = { tipo: '', txt: 'O plano dessa turma usa outro modelo — nenhum campo em comum.' }; return; }
  const sobrescreve = iguais.filter((c) => String(textos.value[c.campo] ?? '').trim());
  carregando.value = false;
  if (sobrescreve.length && !await confirmar(`${sobrescreve.length} campo(s) já preenchido(s) serão substituídos.`, { titulo: 'Copiar textos dessa turma?', ok: 'Substituir' })) return;
  const novos = { ...textos.value };
  for (const c of iguais) novos[c.campo] = p.campos.find((x) => String(x.campo) === String(c.campo)).conteudo;
  textos.value = novos;
  msg.value = { tipo: 'ok', txt: `✔ ${iguais.length} campo(s) copiados. Revise antes de salvar.` };
});

const salvar = async (acao) => {
  const destino = semPlano.value.map((t) => `${t.turma} (sala ${t.sala})`).join(' e ');
  const oque = acao === 2 ? 'Salvar e ENVIAR para aprovação do coordenador' : 'Salvar como "Em elaboração"';
  const extra = acao === 2 ? '\n\nDepois de enviado, o plano não pode mais ser alterado até a aprovação.' : '';
  if (!await confirmar(`${oque} em: ${destino}.${extra}\n\nDepois do envio as turmas são relidas para conferência.`, { titulo: 'Criar plano de ensino no portal?', ok: acao === 2 ? 'Salvar e enviar' : 'Salvar' })) return;
  await executar(async () => {
    const conteudos = Object.fromEntries(camposU.value.map((c) => [c.campo, String(textos.value[c.campo] ?? '').trim()]));
    const r = await api.criarPlano(props.sala.id, modelo.value, acao, conteudos);
    dados.value = { ...dados.value, turmas: r.turmas };
    if (r.divergencias.length) msg.value = { tipo: 'err', txt: `⚠ Conferência encontrou diferenças:\n${r.divergencias.join('\n')}` };
    else {
      msg.value = { tipo: 'ok', txt: `✔ Plano criado e conferido em ${r.feitas.join(' e ')}.${r.puladas.length ? ` (${r.puladas.join(', ')} já tinha plano — não alterado.)` : ''}` };
      try { localStorage.removeItem(chaveRascunho.value); } catch { /* */ }
    }
  });
};

onMounted(carregar);
</script>

<template>
  <section class="plano">
    <div class="barra">
      <div class="titulo">
        <h2>Plano de ensino</h2>
        <div class="sub">
          <span v-for="t in dados?.turmas ?? []" :key="t.cpt" class="chip" :class="SITUACAO[t.situacao]?.[1]">{{ t.turma }} · {{ SITUACAO[t.situacao]?.[0] ?? t.situacao }}</span>
        </div>
      </div>
      <button @click="carregar" :disabled="carregando">Recarregar</button>
    </div>

    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>
    <Carregando v-if="carregando && !dados" texto="Lendo o plano de ensino…" :detalhe="sala.turmas.length > 1 ? 'Uma turma por vez' : ''" />

    <template v-else-if="dados">
      <!-- Criação (turmas sem plano) -->
      <div v-if="semPlano.length" class="editor">
        <p class="sub">Será criado em: <b>{{ semPlano.map((t) => `${t.turma} (sala ${t.sala})`).join(' e ') }}</b>. O rascunho fica guardado neste navegador até você salvar.</p>
        <div class="barra">
          <label>Modelo
            <select v-model="modelo" @change="trocarModelo" :disabled="carregando">
              <option v-for="m in dados.modelos" :key="m.codigo" :value="m.codigo">{{ m.descricao }}</option>
            </select>
          </label>
          <label>Copiar textos de
            <select v-model="fonte" @change="copiarDe" :disabled="carregando">
              <option value="">— escolher turma —</option>
              <optgroup label="Mesma disciplina">
                <option v-for="t in fontes.filter((f) => f.mesma)" :key="t.cpt" :value="t.cpt">{{ t.turma.trim() }} · {{ t.periodo }}</option>
              </optgroup>
              <optgroup label="Outras disciplinas">
                <option v-for="t in fontes.filter((f) => !f.mesma)" :key="t.cpt" :value="t.cpt">{{ t.disciplina }} · {{ t.turma.trim() }} · {{ t.periodo }}</option>
              </optgroup>
            </select>
          </label>
        </div>

        <div v-for="c in camposU" :key="c.campo" class="campo">
          <div class="cab">
            <strong>{{ c.ordem }} {{ c.descricao }}</strong>
            <button v-if="/indicador/i.test(c.descricao) && dados.indicadores" class="mini" @click="preencherIndicadores(c)" :disabled="carregando">Preencher com os indicadores do currículo</button>
            <span class="sub conta">{{ String(textos[c.campo] ?? '').length }} car.</span>
          </div>
          <textarea v-model="textos[c.campo]" :class="{ vazio: !String(textos[c.campo] ?? '').trim() }" rows="5" :disabled="carregando" />
        </div>

        <div class="barra rodape">
          <span v-if="vazios.length" class="falta">{{ vazios.length }} campo(s) obrigatório(s) vazio(s)</span>
          <span class="esp" />
          <button @click="salvar(1)" :disabled="carregando || vazios.length > 0">Salvar (em elaboração)</button>
          <button class="pri" @click="salvar(2)" :disabled="carregando || vazios.length > 0">Salvar e enviar para aprovação</button>
        </div>
      </div>

      <!-- Leitura (turmas com plano: não alteráveis aqui) -->
      <div v-if="comPlano.length" class="leitura">
        <h3>{{ semPlano.length ? 'Já têm plano' : 'Plano no portal' }} <span class="sub">— somente leitura; alterações aguardam a aprovação</span></h3>
        <div v-if="comPlano.length > 1" class="abas">
          <button v-for="t in comPlano" :key="t.cpt" :class="{ ativa: t.cpt === turmaAba?.cpt }" @click="aba = t.cpt">{{ t.turma }} · {{ t.sala }}</button>
        </div>
        <div v-for="c in (turmaAba?.campos ?? []).filter((x) => x.tipo === 'U')" :key="c.codigo" class="campo">
          <strong>{{ c.descricao }}</strong>
          <pre>{{ c.conteudo }}</pre>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plano { max-width: 900px; }
.barra { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.titulo { flex: 1; min-width: 200px; }
h2 { font-size: 17px; margin: 0 0 6px; }
h3 { font-size: 14px; margin: 18px 0 8px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
select { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg); max-width: 380px; }
.chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--soft); margin: 0 4px 4px 0; }
.chip.ok { background: var(--ok-bg); color: var(--ok); }
.chip.aguard { background: var(--t1-bg); color: var(--accent); }
.chip.elab { background: var(--warn-bg); color: var(--warn); }
.campo { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.cab { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.cab strong { flex: 1; }
.mini { font-size: 12px; padding: 3px 8px; }
.conta { min-width: 60px; text-align: right; }
textarea { width: 100%; resize: vertical; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--fg); font: 13px/1.5 system-ui, sans-serif; }
textarea.vazio { border-color: var(--warn); }
.rodape { position: sticky; bottom: 0; background: var(--bg); padding: 10px 0; border-top: 1px solid var(--border); }
.esp { flex: 1; }
.falta { color: var(--warn); font-weight: 700; font-size: 12px; }
pre { white-space: pre-wrap; font: 13px/1.5 system-ui, sans-serif; margin: 6px 0 0; color: var(--fg); }
.abas { display: flex; gap: 4px; margin-bottom: 8px; }
.abas button.ativa { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
