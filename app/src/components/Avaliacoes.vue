<script setup>
// Configurar avaliações (por conceito): indicadores do currículo + avaliações do professor.
// Padrão: uma avaliação por indicador, "Trabalho N" / tbN (ou "Prova N" / pvN), numeradas em sequência.
// Grava em todas as turmas da sala (o "Replicar" do portal está quebrado).
import { ref, computed, onMounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';
import Carregando from './Carregando.vue';
import { mensagem } from '../aviso.js';

const props = defineProps({ sala: { type: Object, required: true } });
const emit = defineEmits(['expirou']);

const TIPOS = { Trabalho: 'tb', Prova: 'pv' };
const turmas = ref([]);
const novas = ref([]);
const carregando = ref(false);
const msg = mensagem();
let seq = 0;

// Indicadores da sala (união das turmas), com as avaliações que já existem em cada turma
const indicadores = computed(() => {
  const m = new Map();
  for (const t of turmas.value) {
    for (const i of t.indicadores) {
      const ind = m.get(i.chave) ?? { chave: i.chave, sigla: i.sigla, descricao: i.descricao, existentes: new Map(), turmas: [] };
      ind.turmas.push(t.turma);
      for (const a of i.avaliacoes) {
        const k = String(a.sigla).trim().toLowerCase();
        const e = ind.existentes.get(k) ?? { sigla: a.sigla, descricao: a.descricao, turmas: [] };
        e.turmas.push(t.turma);
        ind.existentes.set(k, e);
      }
      m.set(i.chave, ind);
    }
  }
  return [...m.values()].sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true })).map((i) => ({ ...i, existentes: [...i.existentes.values()] }));
});

const novasDe = (chave) => novas.value.filter((n) => n.indicador === chave);
const semAvaliacao = computed(() => indicadores.value.filter((i) => !i.existentes.length && !novasDe(i.chave).length));
const naoConceito = computed(() => turmas.value.filter((t) => !t.configurada && t.tipoTurma !== 'C'));
const podeSalvar = computed(() => novas.value.length && !semAvaliacao.value.length && !naoConceito.value.length && novas.value.every((n) => n.descricao.trim() && n.sigla.trim() && n.sigla.trim().length <= 10));

// Próximo número de um tipo (olha o que já existe na sala e as novas)
function proximoNumero(tipo) {
  const prefixo = TIPOS[tipo];
  const usados = [
    ...indicadores.value.flatMap((i) => i.existentes.map((e) => e.sigla)),
    ...novas.value.filter((n) => n.tipo === tipo).map((n) => n.sigla),
  ].map((s) => Number((String(s).trim().toLowerCase().match(new RegExp(`^${prefixo}(\\d+)$`)) || [])[1])).filter(Boolean);
  return (usados.length ? Math.max(...usados) : 0) + 1;
}

function adicionar(chave, tipo = 'Trabalho') {
  const n = proximoNumero(tipo);
  novas.value.push({ id: ++seq, indicador: chave, tipo, numero: n, descricao: `${tipo} ${n}`, sigla: `${TIPOS[tipo]}${n}`, manual: false });
}

// Padrão do professor: uma avaliação por indicador que ainda não tem nenhuma
function gerarPadrao(tipo = 'Trabalho') {
  for (const i of semAvaliacao.value) adicionar(i.chave, tipo);
}

function trocarTipo(n) {
  if (n.manual) return;
  n.numero = proximoNumero(n.tipo);
  n.descricao = `${n.tipo} ${n.numero}`;
  n.sigla = `${TIPOS[n.tipo]}${n.numero}`;
}

const remover = (n) => { novas.value = novas.value.filter((x) => x.id !== n.id); };

async function executar(fn) {
  carregando.value = true;
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally { carregando.value = false; }
}

const carregar = () => executar(async () => {
  msg.value = null;
  turmas.value = (await api.avaliacoes(props.sala.id)).turmas;
});

// O portal pode devolver um "relatório de modificações" e pedir confirmação
const textoRelatorio = (r) => {
  if (r == null) return '';
  if (typeof r === 'string') return r.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  if (Array.isArray(r)) return r.map(textoRelatorio).join('\n');
  if (typeof r === 'object') return Object.values(r).map(textoRelatorio).filter(Boolean).join(' · ');
  return String(r);
};

const salvar = async () => {
  const lista = novas.value.map((n) => `• ${n.indicador}: ${n.descricao} (${n.sigla})`).join('\n');
  const destino = turmas.value.map((t) => `${t.turma} (sala ${t.sala})`).join(' e ');
  if (!await confirmar(`${lista}\n\nVai para: ${destino}.\nDepois do envio as turmas são relidas para conferência.`, { titulo: 'Gravar avaliações no portal?', ok: 'Gravar no portal' })) return;
  await executar(async () => {
    msg.value = null;
    const payload = novas.value.map(({ indicador, descricao, sigla }) => ({ indicador, descricao: descricao.trim(), sigla: sigla.trim() }));
    const aprovados = [];
    for (;;) {
      const r = await api.salvarAvaliacoes(props.sala.id, payload, aprovados);
      if (r.pendente) {
        carregando.value = false;
        const ok = await confirmar(textoRelatorio(r.pendente.relatorio) || '(sem detalhes)', { titulo: `Portal pede confirmação — ${r.pendente.turma}`, ok: 'Confirmar e gravar' });
        carregando.value = true;
        if (!ok) { msg.value = { tipo: '', txt: `Cancelado em ${r.pendente.turma}. ${r.feitas.length ? 'Já gravado: ' + r.feitas.map((f) => f.turma).join(', ') + '.' : 'Nada foi gravado.'}` }; return; }
        aprovados.push(r.pendente.cpt);
        continue;
      }
      turmas.value = r.turmas;
      novas.value = [];
      msg.value = r.divergencias.length
        ? { tipo: 'err', txt: `⚠ Conferência encontrou diferenças:\n${r.divergencias.join('\n')}` }
        : { tipo: 'ok', txt: `✔ Gravado e conferido em ${r.feitas.map((f) => f.turma).join(' e ')}.` };
      return;
    }
  });
};

onMounted(carregar);
</script>

<template>
  <section class="aval">
    <div class="barra">
      <div class="titulo">
        <h2>Avaliações</h2>
        <div class="sub">{{ sala.nome }} · {{ sala.turmas.map((t) => `${t.turma.trim()} (sala ${t.sala})`).join(' + ') }}</div>
      </div>
      <button @click="carregar" :disabled="carregando">Recarregar</button>
    </div>

    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>
    <Carregando v-if="carregando && !turmas.length" texto="Lendo a configuração de avaliações…" :detalhe="sala.turmas.length > 1 ? 'Uma turma por vez' : ''" />

    <template v-else-if="turmas.length">
      <div v-if="naoConceito.length" class="msg err">
        {{ naoConceito.map((t) => t.turma).join(', ') }} não é por conceito. Por enquanto configure essa turma pelo portal.
      </div>

      <div class="barra">
        <button v-if="semAvaliacao.length" class="pri" @click="gerarPadrao('Trabalho')" :disabled="carregando">Uma avaliação por indicador (Trabalho 1, 2…)</button>
        <button v-if="semAvaliacao.length" @click="gerarPadrao('Prova')" :disabled="carregando">…como Prova</button>
        <span class="sub dica">{{ turmas.some((t) => !t.configurada) ? 'Ainda sem configuração no portal: os indicadores do currículo serão importados (Conceito).' : '' }}</span>
        <button @click="novas = []" :disabled="carregando || !novas.length">Desfazer</button>
        <button class="pri" @click="salvar" :disabled="carregando || !podeSalvar">Salvar ({{ novas.length }})</button>
      </div>
      <p v-if="novas.length && semAvaliacao.length" class="falta">Todo indicador precisa de pelo menos uma avaliação: falta em {{ semAvaliacao.map((i) => i.sigla).join(', ') }}.</p>

      <div v-for="i in indicadores" :key="i.chave" class="ind">
        <div class="cab">
          <span class="chave">{{ i.sigla }}</span>
          <span class="desc">{{ i.descricao }}</span>
          <button class="mais" @click="adicionar(i.chave)" :disabled="carregando" title="Adicionar avaliação">+ avaliação</button>
        </div>
        <ul>
          <li v-for="e in i.existentes" :key="e.sigla" class="exist">
            <span class="sig">{{ e.sigla }}</span><span>{{ e.descricao }}</span>
            <span class="sub">{{ e.turmas.length === turmas.length ? 'no portal' : 'só em ' + e.turmas.join(', ') }}</span>
          </li>
          <li v-for="n in novasDe(i.chave)" :key="n.id" class="nova">
            <select v-model="n.tipo" @change="trocarTipo(n)" :disabled="n.manual">
              <option v-for="(p, t) in TIPOS" :key="t" :value="t">{{ t }}</option>
            </select>
            <input v-model="n.descricao" @input="n.manual = true" maxlength="600" placeholder="Descrição" class="d">
            <input v-model="n.sigla" @input="n.manual = true" maxlength="10" placeholder="Reduzida" class="s">
            <button class="x" @click="remover(n)" title="Remover">✕</button>
          </li>
          <li v-if="!i.existentes.length && !novasDe(i.chave).length" class="vazio sub">Nenhuma avaliação</li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
.aval { max-width: 900px; }
.barra { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.titulo { flex: 1; min-width: 200px; }
h2 { font-size: 17px; margin: 0 0 4px; }
.dica { flex: 1; }
.falta { color: var(--warn); font-weight: 700; font-size: 12px; margin: 0 0 10px; }
.ind { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.cab { display: flex; gap: 10px; align-items: flex-start; }
.chave { font-weight: 700; background: var(--t1-bg); color: var(--accent); border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.desc { flex: 1; }
.mais { font-size: 12px; padding: 4px 8px; white-space: nowrap; }
ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
li { display: flex; gap: 8px; align-items: center; }
.exist { padding: 4px 0; }
.sig { font-weight: 700; min-width: 48px; color: var(--ok); }
.nova select, .nova input { font: inherit; padding: 6px 8px; border: 1px solid var(--accent); border-radius: 6px; background: transparent; color: var(--fg); }
.nova .d { flex: 1; min-width: 0; }
.nova .s { width: 90px; }
.x { padding: 4px 8px; }
.vazio { padding: 4px 0; }
</style>
