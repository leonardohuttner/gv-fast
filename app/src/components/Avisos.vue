<script setup>
import { avisos, fecharAviso } from '../aviso.js';
</script>

<template>
  <div class="avisos" aria-live="polite">
    <div v-for="a in avisos" :key="a.id" class="aviso" :class="a.tipo" role="status">
      <span class="txt">{{ a.txt }}</span>
      <button class="x" @click="fecharAviso(a.id)" aria-label="Fechar">×</button>
    </div>
  </div>
</template>

<style scoped>
.avisos { position: fixed; right: 16px; bottom: 16px; z-index: 120; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); }
.aviso { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--fg); box-shadow: 0 6px 24px rgb(0 0 0 / .25); font-size: 13px; line-height: 1.45; animation: entra .2s ease-out; }
.aviso.ok { border-color: var(--ok); background: var(--ok-bg); }
.aviso.err { border-color: var(--err); background: var(--err-bg); }
.txt { flex: 1; white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }
.x { border: 0; background: transparent; color: inherit; font-size: 18px; line-height: 1; padding: 0 2px; cursor: pointer; opacity: .7; }
.x:hover { opacity: 1; }
@keyframes entra { from { transform: translateY(8px); opacity: 0; } }
</style>
