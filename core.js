// Lógica pura do app (sem DOM). Testada com `node --test`.
import { load, dump, CORE_SCHEMA } from './vendor/js-yaml.mjs';
import { marked } from './vendor/marked.esm.js';

export const PASTAS = { artigo: 'artigos-cientificos', ferramenta: 'ferramentas', web: 'web', nota: 'notas', projeto: 'projetos' };
export const TIPOS = { artigo: 'Artigo científico', ferramenta: 'Ferramenta', web: 'Web e vídeo', nota: 'Nota', projeto: 'Projeto' };
const PREFIXOS = [...Object.values(PASTAS), 'inbox'].map((p) => p + '/');
const RELEVANCIA = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;
const WL = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const asList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

export function parseNote(path, text) {
  const slug = path.split('/').pop().replace(/\.md$/, '');
  const m = text.match(FM);
  if (!m) return { path, slug, meta: {}, body: text, erro: null };
  try {
    const meta = load(m[1], { schema: CORE_SCHEMA });
    return { path, slug, meta: meta && typeof meta === 'object' ? meta : {}, body: m[2], erro: null };
  } catch (e) {
    return { path, slug, meta: {}, body: m[2], erro: e.reason || e.message };
  }
}

export function serializeNote(meta, body) {
  return '---\n' + dump(meta, { schema: CORE_SCHEMA, lineWidth: -1 }) + '---\n' + body;
}

export function matches(note, q) {
  const termos = fold(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const m = note.meta;
  const hay = fold([m.titulo, m.titulo_pt, m.descricao, m.doi, ...asList(m.autores), ...asList(m.tags), note.body].join(' '));
  return termos.every((t) => hay.includes(t));
}

export function applyFilters(notes, f = {}) {
  return notes.filter((n) => {
    const m = n.meta;
    if (f.tipo && m.tipo !== f.tipo) return false;
    if (f.area && m.area !== f.area) return false;
    if (f.projeto && !asList(m.projetos).includes(f.projeto)) return false;
    if (f.revisao === 'pendente' && m.revisado !== false) return false;
    if (f.revisao === 'revisada' && m.revisado === false) return false;
    for (const [k, v] of Object.entries(f.campos || {})) if (v && !asList(m[k]).includes(v)) return false;
    return matches(n, f.q || '');
  });
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) =>
    String(b.meta.criado ?? '').localeCompare(String(a.meta.criado ?? '')) ||
    String(a.meta.titulo ?? a.slug).localeCompare(String(b.meta.titulo ?? b.slug), 'pt'));
}

export function facetValues(notes, campo) {
  const c = new Map();
  for (const n of notes) for (const v of asList(n.meta[campo])) c.set(v, (c.get(v) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt'));
}

export function resolveLink(notes, alvo) {
  const a = fold(alvo.trim());
  return notes.find((n) => fold(n.slug) === a || fold(n.meta.titulo) === a || fold(n.meta.titulo_pt) === a) || null;
}

const linksOf = (body) => [...body.matchAll(WL)].map((m) => m[1]);

// ponytail: O(n²) sobre o vault inteiro; pré-indexar links se passar de alguns milhares de notas
export function backlinks(notes, note) {
  return notes.filter((n) => n !== note && (
    linksOf(n.body).some((l) => resolveLink(notes, l) === note) ||
    (note.meta.tipo === 'projeto' && asList(n.meta.projetos).includes(note.slug))));
}

// Devolve HTML NÃO sanitizado: a UI passa por DOMPurify antes de inserir no DOM.
export function renderBody(notes, body) {
  const comLinks = body.replace(WL, (_, alvo, texto) => {
    const n = resolveLink(notes, alvo);
    const rot = esc((texto || alvo).trim());
    return n
      ? `<a class="wl" href="#/n/${encodeURIComponent(n.path)}">${rot}</a>`
      : `<span class="wl quebrado" title="Nota não encontrada">${rot}</span>`;
  });
  return marked.parse(comLinks);
}

export function fieldsFor(m) {
  if (m.tipo === 'artigo') {
    const au = asList(m.autores);
    return [['Autores', au.length > 2 ? `${au[0]} et al.` : au.join(', ')], ['Ano', m.ano], ['Desenho', m.desenho],
      ['Acesso', m.acesso === 'completo' ? 'Texto completo' : 'Só resumo', m.fonte]];
  }
  if (m.tipo === 'ferramenta') {
    return [['Relevância', RELEVANCIA[m.relevancia] || m.relevancia],
      ['Estrelas', m.estrelas == null ? null : Number(m.estrelas).toLocaleString('pt-BR')],
      ['Último commit', m.ultimo_commit], ['Licença', m.licenca]];
  }
  if (m.tipo === 'web') return [['Plataforma', m.plataforma], ['Autor', m.autor], ['Publicado', m.publicado], ['Fonte', 'Abrir original', m.fonte]];
  if (m.tipo === 'projeto') return [['Status', m.status], ['Área', m.area]];
  return [];
}

export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[.,;:!?)\]]+$/, '') : null;
}

export function captureFile({ texto = '', url = null, tipo = 'auto', origem = 'app', agora = new Date(), rand = Math.random }) {
  const link = url || firstUrl(texto);
  const obs = (link ? texto.split(link).join('') : texto).trim();
  const stamp = agora.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const sufixo = rand().toString(36).slice(2, 6).padEnd(4, '0');
  const meta = { url: link, tipo, criado: agora.toISOString(), origem };
  return { path: `inbox/${stamp}-${sufixo}.md`, content: serializeNote(meta, obs ? obs + '\n' : '') };
}

export function diffTree(index, tree) {
  const atual = new Map(tree
    .filter((t) => t.type === 'blob' && t.path.endsWith('.md') && PREFIXOS.some((p) => t.path.startsWith(p)))
    .map((t) => [t.path, t.sha]));
  const buscar = [...atual].filter(([p, sha]) => index[p] !== sha).map(([path, sha]) => ({ path, sha }));
  const remover = Object.keys(index).filter((p) => !atual.has(p));
  return { buscar, remover };
}

export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function slugify(t, max = 60) {
  const s = String(t).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return s.slice(0, max).replace(/-+$/, '') || 'sem-titulo';
}

export function newNote(titulo, paths, area, agora = new Date()) {
  const base = slugify(titulo);
  let nome = base;
  for (let n = 2; paths.has(`notas/${nome}.md`); n++) nome = `${base}-${n}`;
  const meta = { tipo: 'nota', titulo, area, tags: [], projetos: [], criado: agora.toISOString().slice(0, 10), revisado: true };
  return { path: `notas/${nome}.md`, content: serializeNote(meta, '\n') };
}
