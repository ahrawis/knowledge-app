// Dados: cache em IndexedDB, leitura/escrita no repositório do vault pela API do GitHub, fila offline de capturas.
import { diffTree, b64encode, b64decode } from './core.js';

const DB = 'knowledge';
const ST = 'kv';
let dbp;

function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function idb(modo, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const q = fn(d.transaction(ST, modo).objectStore(ST));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
const getKV = (k) => idb('readonly', (s) => s.get(k));
const setKV = (k, v) => idb('readwrite', (s) => s.put(v, k));

export function getConfig() {
  try { return JSON.parse(localStorage.getItem('knowledge.cfg')) || null; } catch { return null; }
}
export function setConfig(c) { localStorage.setItem('knowledge.cfg', JSON.stringify(c)); }

export async function esquecerTudo() {
  localStorage.removeItem('knowledge.cfg');
  (await db()).close();
  dbp = undefined;
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = res; });
}

const MENSAGENS = {
  401: 'Token inválido ou expirado. Gere um novo e cole em Ajustes.',
  403: 'O token não tem permissão de escrita (Contents: Read and write) ou o limite da API foi atingido.',
  404: 'Repositório não encontrado. Confira dono e nome em Ajustes.',
  409: 'Esta nota mudou em outro lugar. Sincronize e refaça a alteração.',
  422: 'Esta nota mudou em outro lugar. Sincronize e refaça a alteração.',
};

async function gh(caminho, opts = {}) {
  const c = getConfig();
  if (!c?.token) throw Object.assign(new Error('Configure o acesso ao GitHub em Ajustes.'), { status: 0 });
  const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${caminho}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) throw Object.assign(new Error(MENSAGENS[r.status] || `O GitHub respondeu com erro ${r.status}.`), { status: r.status });
  return r.json();
}

const caminhoApi = (path) => `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

export const testarConexao = () => gh('');

export async function carregarCache() { return (await getKV('notas')) || {}; }

export async function sincronizar(aoProgredir) {
  const cache = await carregarCache();
  const { tree } = await gh('/git/trees/HEAD?recursive=1');
  const indice = Object.fromEntries(Object.entries(cache).map(([p, v]) => [p, v.sha]));
  const { buscar, remover } = diffTree(indice, tree);
  for (const p of remover) delete cache[p];
  let feitos = 0;
  for (let i = 0; i < buscar.length; i += 8) {
    await Promise.all(buscar.slice(i, i + 8).map(async ({ path, sha }) => {
      const blob = await gh(`/git/blobs/${sha}`);
      cache[path] = { sha, text: b64decode(blob.content) };
      aoProgredir?.(++feitos, buscar.length);
    }));
  }
  await setKV('notas', cache);
  return cache;
}

async function atualizarCache(path, valor) {
  const cache = await carregarCache();
  if (valor) cache[path] = valor; else delete cache[path];
  await setKV('notas', cache);
}

export async function salvar(path, text, sha, mensagem) {
  const r = await gh(caminhoApi(path), {
    method: 'PUT',
    body: JSON.stringify({ message: mensagem, content: b64encode(text), ...(sha ? { sha } : {}) }),
  });
  await atualizarCache(path, { sha: r.content.sha, text });
  return r.content.sha;
}

export async function remover(path, sha, mensagem) {
  await gh(caminhoApi(path), { method: 'DELETE', body: JSON.stringify({ message: mensagem, sha }) });
  await atualizarCache(path, null);
}

export async function capturar(arq) {
  try {
    return { estado: 'enviado', sha: await salvar(arq.path, arq.content, null, `captura: ${arq.path}`) };
  } catch (e) {
    if (e.status) throw e; // erro do GitHub (token, permissão): mostrar ao usuário
    const fila = (await getKV('fila')) || [];
    fila.push(arq);
    await setKV('fila', fila);
    return { estado: 'na fila' };
  }
}

export async function enviarFila() {
  const fila = (await getKV('fila')) || [];
  const resto = [];
  for (const arq of fila) {
    try { await salvar(arq.path, arq.content, null, `captura: ${arq.path}`); } catch { resto.push(arq); }
  }
  await setKV('fila', resto);
  return fila.length - resto.length;
}

export async function tamanhoFila() { return ((await getKV('fila')) || []).length; }
