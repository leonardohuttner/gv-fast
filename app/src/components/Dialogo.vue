<script setup>
import { ref, watch, nextTick } from 'vue';
import { dialogo, responder } from '../dialogo.js';

const btnOk = ref(null);
const campo = ref(null);

// textos vindos do portal trazem entidades HTML (&nbsp; etc.)
const decodificar = (t) => String(t ?? '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]{2,}/g, ' ');

watch(() => dialogo.aberto, async (aberto) => {
  if (!aberto) return;
  await nextTick();
  (campo.value ?? btnOk.value)?.focus();
  campo.value?.select();
});
</script>

<template>
  <div v-if="dialogo.aberto" class="fundo" @mousedown.self="responder(false)" @keydown.esc="responder(false)">
    <form class="caixa" role="dialog" aria-modal="true" @submit.prevent="responder(true)">
      <h3 v-if="dialogo.titulo">{{ dialogo.titulo }}</h3>
      <p class="texto">{{ decodificar(dialogo.texto) }}</p>
      <input v-if="dialogo.campo" ref="campo" v-model="dialogo.valor">
      <div class="botoes">
        <button type="button" @click="responder(false)">{{ dialogo.cancelar }}</button>
        <button ref="btnOk" type="submit" class="pri" :class="{ perigo: dialogo.perigo }">{{ dialogo.ok }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.fundo { position: fixed; inset: 0; z-index: 100; background: rgb(0 0 0 / .45); display: grid; place-items: center; padding: 16px; }
.caixa { display: flex; flex-direction: column; max-height: calc(100vh - 32px); width: 100%; max-width: 560px; background: var(--card); color: var(--fg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 10px 40px rgb(0 0 0 / .3); }
h3 { margin: 0 0 8px; font-size: 16px; }
p.texto { margin: 0 0 14px; white-space: pre-wrap; line-height: 1.5; overflow-y: auto; min-height: 0; flex: 1 1 auto; padding-right: 4px; }
input { width: 100%; margin-bottom: 14px; }
.botoes { display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 4px; border-top: 1px solid var(--soft); }
.perigo { background: var(--err); border-color: var(--err); }
</style>
