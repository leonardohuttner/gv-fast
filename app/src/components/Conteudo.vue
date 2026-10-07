<script setup>
// Conteúdo do dia (programação de aulas do portal): "realizado" em dia já dado, "programado" em dia futuro.
// Grava em todas as turmas da sala e relê para conferir.
import { ref, computed, watch } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';

const props = defineProps({
  sala: { type: Object, required: true },
  data: { type: String, default: null },
  programacao: { type: Array, default: () => [] }, // [{ cpt, turma, dias: [...] }]
});
const emit = defineEmits(['salvo', 'expirou']);

const texto = ref('');
const salvando = ref(false);
const msg = ref(null);

const diasDoDia = computed(() => props.programacao.map((t) => ({ turma: t.turma, dia: t.dias.find((d) => d.data === props.data) })).filter((x) => x.dia));
const dia = computed(() => diasDoDia.value[0]?.dia ?? null);
// realizado se o portal permite (aula dada); senão, programado (aula futura)
const tipo = computed(() => (dia.value?.editaRealizado ? 'realizado' : dia.value?.editaProgramado ? 'programa' : null));
const atual = computed(() => (tipo.value === 'realizado' ? dia.value?.realizado : dia.value?.programado) ?? '');
const diferentes = computed(() => new Set(diasDoDia.value.map((x) => (tipo.value === 'realizado' ? x.dia.realizado : x.dia.programado) ?? '')).size > 1);
const sujo = computed(() => texto.value.trim() !== atual.value.trim());

watch(() => [props.data, atual.value], () => { texto.value = atual.value; msg.value = null; }, { immediate: true });

const usarProgramado = () => { texto.value = dia.value?.programado ?? ''; };

async function salvar() {
  const destino = diasDoDia.value.map((x) => x.turma).join(' e ');
  const oque = tipo.value === 'realizado' ? 'Conteúdo realizado' : 'Conteúdo programado';
  if (!await confirmar(`${oque} de ${props.data.split('-').reverse().join('/')} em: ${destino}.\n\nDepois do envio as turmas são relidas para conferência.`, { titulo: 'Gravar no portal?', ok: 'Gravar no portal' })) return;
  salvando.value = true;
  msg.value = null;
  try {
    const r = await api.salvarProgramacao(props.sala.id, props.data, tipo.value, texto.value);
    emit('salvo', r.turmas);
    msg.value = r.divergencias.length
      ? { tipo: 'err', txt: `⚠ Conferência encontrou diferenças:\n${r.divergencias.join('\n')}` }
      : { tipo: 'ok', txt: `✔ Gravado e conferido em ${r.feitas.join(' e ')}.${r.puladas.length ? ' (' + r.puladas.join(', ') + ')' : ''}` };
  } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally {
    salvando.value = false;
  }
}
</script>

<template>
  <div v-if="dia && tipo" class="conteudo">
    <div class="cab">
      <strong>{{ tipo === 'realizado' ? 'Conteúdo realizado' : 'Conteúdo programado' }}</strong>
      <span class="sub">opcional{{ tipo === 'realizado' && !atual.trim() ? ' · sem registro no portal' : '' }}</span>
      <span v-if="diferentes" class="sub">· diferente entre as turmas (mostrando {{ diasDoDia[0].turma }})</span>
      <span class="esp" />
      <button v-if="tipo === 'realizado' && dia.programado" class="mini" @click="usarProgramado" :disabled="salvando" title="Copiar o conteúdo programado (como o >>> do portal)">usar o programado</button>
    </div>
    <p v-if="tipo === 'realizado' && dia.programado" class="sub prog"><b>Programado:</b> {{ dia.programado }}</p>
    <textarea v-model="texto" rows="3" :disabled="salvando" :placeholder="tipo === 'realizado' ? 'O que foi trabalhado nesta aula…' : 'O que está planejado para esta aula…'" />
    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>
    <div class="rodape">
      <button @click="texto = atual" :disabled="salvando || !sujo">Desfazer</button>
      <button class="pri" @click="salvar" :disabled="salvando || !sujo || !texto.trim()">{{ salvando ? 'Gravando…' : 'Salvar conteúdo' }}</button>
    </div>
  </div>
</template>

<style scoped>
.conteudo { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 12px; }
.cab { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
.esp { flex: 1; }
.mini { font-size: 12px; padding: 3px 8px; }
.prog { margin: 0 0 6px; }
textarea { width: 100%; resize: vertical; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--fg); font: 13px/1.5 system-ui, sans-serif; }
.rodape { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.msg { margin: 6px 0 0; }
</style>
