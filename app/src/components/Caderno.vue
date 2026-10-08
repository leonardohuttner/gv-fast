<script setup>
// Caderno = "Digitar observação" do portal: um texto por turma e módulo (vale para a disciplina toda, não por dia).
import { ref, computed, watch } from 'vue';
import { api, NaoLogado, SAIU } from '../api.js';
import { confirmar } from '../dialogo.js';
import { mensagem } from '../aviso.js';

const props = defineProps({
  sala: { type: Object, required: true },
  data: { type: String, default: null },
  alunos: { type: Array, default: () => [] },
});
const emit = defineEmits(['expirou']);

const obs = ref([]);
const aba = ref(null);
const texto = ref('');
const carregando = ref(false);
const msg = mensagem();
const area = ref(null);

const atual = computed(() => obs.value.find((o) => o.cpt === aba.value));
const sujo = computed(() => atual.value && texto.value !== atual.value.texto);
const alunosDaAba = computed(() => props.alunos.filter((a) => String(a.cpt) === String(aba.value) && !SAIU.test(a.situacaoAluno || '')));
const dataBr = computed(() => props.data ? props.data.split('-').reverse().slice(0, 2).join('/') : '');
const ETIQUETAS = ['Atraso', 'Saiu cedo', 'Falta', 'Aviso', 'Alerta', 'Conteúdo', 'Atividade'];
const aluno = ref('');

async function executar(fn) {
  carregando.value = true;
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally { carregando.value = false; }
}

const carregar = () => executar(async () => {
  msg.value = null;
  obs.value = (await api.observacoes(props.sala.id, props.data)).observacoes;
  if (!obs.value.some((o) => o.cpt === aba.value)) aba.value = obs.value[0]?.cpt ?? null;
  texto.value = atual.value?.texto ?? '';
});

async function trocarAba(cpt) {
  if (sujo.value && !await confirmar('Há texto não salvo no caderno. Trocar de turma e descartar?', { ok: 'Descartar e trocar', perigo: true })) return;
  aba.value = cpt;
  texto.value = atual.value?.texto ?? '';
}

// Insere uma linha "[dd/mm] Etiqueta: aluno — " no fim do texto e posiciona o cursor
function inserir(etiqueta) {
  const nome = aluno.value ? aluno.value.split(' ').slice(0, 2).join(' ') : '';
  const linha = `[${dataBr.value}] ${etiqueta}${nome ? ': ' + nome : ''} — `;
  texto.value = (texto.value.trimEnd() ? texto.value.trimEnd() + '\n' : '') + linha;
  aluno.value = '';
  requestAnimationFrame(() => { const el = area.value; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; el.scrollTop = el.scrollHeight; } });
}

const salvar = () => executar(async () => {
  const r = await api.salvarObservacao(props.sala.id, aba.value, props.data, texto.value);
  atual.value.texto = r.texto;
  texto.value = r.texto;
  msg.value = r.conferido ? { tipo: 'ok', txt: '✔ Salvo e conferido no portal.' } : { tipo: 'err', txt: '⚠ O portal devolveu um texto diferente do enviado. Confira antes de editar de novo.' };
});

watch(() => props.sala.id, carregar, { immediate: true });
</script>

<template>
  <aside class="caderno">
    <div class="cab">
      <strong>Caderno</strong>
      <span class="sub">observações do diário</span>
    </div>
    <div v-if="obs.length > 1" class="abas">
      <button v-for="o in obs" :key="o.cpt" :class="{ ativa: o.cpt === aba }" @click="trocarAba(o.cpt)">{{ o.turma }} · {{ o.sala }}</button>
    </div>
    <div class="atalhos">
      <select v-model="aluno" title="Aluno (opcional)">
        <option value="">— aluno —</option>
        <option v-for="a in alunosDaAba" :key="a.enturmacao" :value="a.nome">{{ a.nome }}</option>
      </select>
      <button v-for="e in ETIQUETAS" :key="e" @click="inserir(e)" :disabled="!data || carregando">{{ e }}</button>
    </div>
    <textarea ref="area" v-model="texto" :disabled="carregando || !atual" placeholder="Anotações da disciplina: atrasos, avisos, combinados, desempates…" />
    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>
    <div class="rodape">
      <span class="sub">Módulo {{ atual?.modulo ?? '–' }} · vale para a disciplina toda</span>
      <button @click="texto = atual.texto" :disabled="!sujo || carregando">Desfazer</button>
      <button class="pri" @click="salvar" :disabled="!sujo || carregando">Salvar</button>
    </div>
  </aside>
</template>

<style scoped>
.caderno { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.cab { display: flex; gap: 8px; align-items: baseline; }
.abas { display: flex; gap: 4px; }
.abas button { font-size: 12px; padding: 4px 8px; }
.abas button.ativa { background: var(--accent); border-color: var(--accent); color: #fff; }
.atalhos { display: flex; gap: 4px; flex-wrap: wrap; }
.atalhos button { font-size: 12px; padding: 3px 8px; }
.atalhos select { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg); max-width: 100%; }
textarea { width: 100%; min-height: 260px; resize: vertical; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--fg); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.rodape { display: flex; gap: 6px; align-items: center; }
.rodape .sub { flex: 1; }
.msg { margin: 0; }
</style>
