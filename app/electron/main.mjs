// GV Fast — app de desktop (Electron).
// Sobe o mesmo servidor local do GV Fast (modo produção, servindo dist/) numa porta livre
// e abre uma janela apontando para ele. Dados locais ficam na pasta de dados do app no sistema.
import { app, BrowserWindow, shell, dialog } from 'electron';
import net from 'node:net';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) app.quit();

// Configuração: a do usuário (pasta de dados/config.json) tem prioridade; senão a que veio no build (electron/config.json)
function lerConfig() {
  for (const arq of [path.join(app.getPath('userData'), 'config.json'), path.join(AQUI, 'config.json')]) {
    if (!existsSync(arq)) continue;
    try { return JSON.parse(readFileSync(arq, 'utf8')); } catch { /* arquivo inválido: tenta o próximo */ }
  }
  return {};
}

const portaLivre = () => new Promise((ok, erro) => {
  const s = net.createServer();
  s.on('error', erro);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

async function esperarServidor(url, ms = 20000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try { if ((await fetch(url)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('O servidor do GV Fast não respondeu.');
}

let janela = null;

app.whenReady().then(async () => {
  try {
    const cfg = lerConfig();
    const porta = await portaLivre();
    Object.assign(process.env, { NODE_ENV: 'production', PORT: String(porta), GV_DATA_DIR: app.getPath('userData') });
    if (cfg.GV_UNIDADE) process.env.GV_UNIDADE = String(cfg.GV_UNIDADE);

    await import(pathToFileURL(path.join(AQUI, '..', 'server', 'index.mjs')).href);
    const base = `http://127.0.0.1:${porta}`;
    await esperarServidor(`${base}/api/sessao`);

    janela = new BrowserWindow({
      width: 1280, height: 860, minWidth: 900, minHeight: 600,
      title: 'GV Fast', autoHideMenuBar: true, backgroundColor: '#12161b',
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    // links externos abrem no navegador do sistema; a janela só navega dentro do app
    janela.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    janela.webContents.on('will-navigate', (ev, destino) => {
      if (!destino.startsWith(base)) { ev.preventDefault(); shell.openExternal(destino); }
    });
    await janela.loadURL(base);
  } catch (e) {
    dialog.showErrorBox('GV Fast', `Não foi possível iniciar: ${e.message}`);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.on('window-all-closed', () => app.quit());
