<script setup>
import { ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['entrou']);
const cpf = ref('');
const senha = ref('');
const erro = ref('');
const enviando = ref(false);

async function entrar() {
  erro.value = '';
  enviando.value = true;
  try {
    await api.login(cpf.value, senha.value);
    senha.value = '';
    emit('entrou');
  } catch (e) {
    erro.value = e.message;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <main class="login">
    <form class="card" @submit.prevent="entrar">
      <h1>GV Fast</h1>
      <p class="sub">Portal Professor · Senac RS</p>
      <label for="cpf">CPF</label>
      <input id="cpf" v-model="cpf" inputmode="numeric" autocomplete="username" placeholder="Somente números" required>
      <label for="senha">Senha</label>
      <input id="senha" v-model="senha" type="password" autocomplete="current-password" required>
      <div v-if="erro" class="msg err">{{ erro }}</div>
      <button class="pri" type="submit" :disabled="enviando">{{ enviando ? 'Entrando…' : 'Entrar' }}</button>
    </form>
  </main>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.card { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; }
h1 { font-size: 18px; margin: 0 0 2px; }
.sub { margin: 0 0 12px; }
label { font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
button { margin-top: 18px; padding: 10px; }
</style>
