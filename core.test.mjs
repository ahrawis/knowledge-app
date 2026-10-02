import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNote, serializeNote, matches, applyFilters, sortNotes, facetValues, resolveLink, backlinks,
  renderBody, fieldsFor, firstUrl, captureFile, diffTree, b64encode, b64decode, slugify, newNote,
} from './core.js';

const ARTIGO = `---
tipo: artigo
titulo: "Depersonalisation disorder: a cognitive-behavioural conceptualisation"
titulo_pt: Transtorno de despersonalização
area: Psicologia clínica
tags: [despersonalização, ansiedade]
projetos: [guia-dpdr]
criado: 2026-10-01
revisado: false
autores: [Hunter EC, Phillips ML, Chalder T]
ano: 2003
fonte: https://exemplo.org/artigo
acesso: abstract
foco: [Etiologia e mecanismos]
desenho: Modelo teórico
---
Ver [[Escala de Cambridge]] e [[nao existe]].
`;
const n = (path, text) => parseNote(path, text);
const notas = () => [
  n('artigos-cientificos/hunter.md', ARTIGO),
  n('artigos-cientificos/escala-de-cambridge.md', '---\ntipo: artigo\ntitulo: Escala de Cambridge\narea: Psicologia clínica\nrevisado: true\nfoco: [Diagnóstico e avaliação]\ncriado: 2026-09-01\n---\nCitada por [[Depersonalisation disorder: a cognitive-behavioural conceptualisation]].\n'),
  n('ferramentas/marker.md', '---\ntipo: ferramenta\ntitulo: Marker\narea: Tecnologia & IA\nstatus: quero-testar\nrevisado: false\ncriado: 2026-10-01\nprojetos: [guia-dpdr]\n---\nPDF em Markdown.\n'),
  n('projetos/guia-dpdr.md', '---\ntipo: projeto\ntitulo: Guia DPDR\nstatus: ativo\n---\n'),
];

test('parseNote/serializeNote preservam acentos e datas como texto', () => {
  const a = n('artigos-cientificos/hunter.md', ARTIGO);
  assert.equal(a.slug, 'hunter');
  assert.equal(a.meta.titulo_pt, 'Transtorno de despersonalização');
  assert.equal(a.meta.criado, '2026-10-01');
  assert.equal(a.meta.revisado, false);
  assert.equal(a.meta.ano, 2003);
  const texto = serializeNote(a.meta, a.body);
  assert.match(texto, /^criado: 2026-10-01$/m);
  assert.deepEqual(n(a.path, texto).meta, a.meta);
});

test('parseNote com YAML inválido não lança', () => {
  const r = n('notas/x.md', '---\ntipo: [nota\n---\ncorpo\n');
  assert.ok(r.erro);
  assert.deepEqual(r.meta, {});
  assert.equal(r.body, 'corpo\n');
});

test('busca ignora acento e exige todos os termos', () => {
  const a = notas()[0];
  assert.ok(matches(a, 'despersonalizacao'));
  assert.ok(matches(a, 'TRANSTORNO hunter'));
  assert.ok(!matches(a, 'despersonalizacao marker'));
  assert.ok(matches(a, ''));
});

test('applyFilters combina tipo, projeto, revisão e campos', () => {
  const ns = notas();
  assert.equal(applyFilters(ns, { tipo: 'artigo' }).length, 2);
  assert.equal(applyFilters(ns, { projeto: 'guia-dpdr' }).length, 2);
  assert.deepEqual(applyFilters(ns, { revisao: 'pendente', tipo: 'artigo' }).map((x) => x.slug), ['hunter']);
  assert.deepEqual(applyFilters(ns, { revisao: 'revisada' }).map((x) => x.slug).sort(), ['escala-de-cambridge', 'guia-dpdr']);
  assert.deepEqual(applyFilters(ns, { campos: { foco: 'Etiologia e mecanismos' } }).map((x) => x.slug), ['hunter']);
});

test('sortNotes: mais recente primeiro, depois título', () => {
  assert.deepEqual(sortNotes(notas()).map((x) => x.slug), ['hunter', 'marker', 'escala-de-cambridge', 'guia-dpdr']);
});

test('facetValues conta valores de listas e escalares', () => {
  assert.deepEqual(facetValues(notas(), 'area'), [['Psicologia clínica', 2], ['Tecnologia & IA', 1]]);
});

test('links e backlinks', () => {
  const ns = notas();
  assert.equal(resolveLink(ns, 'escala de cambridge').slug, 'escala-de-cambridge');
  assert.equal(resolveLink(ns, 'HUNTER').slug, 'hunter');
  assert.equal(resolveLink(ns, 'nao existe'), null);
  assert.deepEqual(backlinks(ns, ns[0]).map((x) => x.slug), ['escala-de-cambridge']);
  assert.deepEqual(backlinks(ns, ns[3]).map((x) => x.slug).sort(), ['hunter', 'marker']);
});

test('renderBody resolve wikilinks e escapa rótulos', () => {
  const ns = notas();
  const html = renderBody(ns, ns[0].body + '\n[[x|<b>rot</b>]]\n');
  assert.match(html, /<a class="wl" href="#\/n\/artigos-cientificos%2Fescala-de-cambridge\.md">Escala de Cambridge<\/a>/);
  assert.match(html, /<span class="wl quebrado"[^>]*>nao existe<\/span>/);
  assert.match(html, /&lt;b&gt;rot&lt;\/b&gt;/);
});

test('fieldsFor artigo abrevia autores e marca acesso', () => {
  assert.deepEqual(fieldsFor(notas()[0].meta), [
    ['Autores', 'Hunter EC et al.'], ['Ano', 2003], ['Desenho', 'Modelo teórico'], ['Acesso', 'Só resumo', 'https://exemplo.org/artigo'],
  ]);
});

test('firstUrl tira pontuação final', () => {
  assert.equal(firstUrl('Olha esse reel https://www.instagram.com/reel/C9x/?igsh=abc. muito bom'), 'https://www.instagram.com/reel/C9x/?igsh=abc');
  assert.equal(firstUrl('sem link'), null);
});

test('captureFile extrai link do texto e gera nome único', () => {
  const agora = new Date('2026-10-01T14:20:05Z');
  const a = captureFile({ texto: 'Veja https://github.com/a/b @guia-dpdr', origem: 'celular', agora, rand: () => 0.123456 });
  const b = captureFile({ texto: 'Veja https://github.com/a/b @guia-dpdr', origem: 'celular', agora, rand: () => 0.654321 });
  assert.match(a.path, /^inbox\/20261001T142005-[a-z0-9]{4}\.md$/);
  assert.notEqual(a.path, b.path);
  const p = parseNote(a.path, a.content);
  assert.equal(p.meta.url, 'https://github.com/a/b');
  assert.equal(p.meta.tipo, 'auto');
  assert.equal(p.meta.origem, 'celular');
  assert.equal(p.body.trim(), 'Veja  @guia-dpdr');
  const s = parseNote('inbox/x.md', captureFile({ texto: 'só uma ideia', agora }).content);
  assert.equal(s.meta.url, null);
  assert.equal(s.body.trim(), 'só uma ideia');
});

test('diffTree busca novos/alterados, remove apagados, ignora fora das pastas', () => {
  const tree = [
    { path: 'notas/a.md', sha: '1', type: 'blob' },
    { path: 'notas/b.md', sha: '2b', type: 'blob' },
    { path: 'inbox/c.md', sha: '3', type: 'blob' },
    { path: '_sistema/taxonomia.yml', sha: '4', type: 'blob' },
    { path: '.claude/skills/x/SKILL.md', sha: '5', type: 'blob' },
    { path: 'notas/.gitkeep', sha: '6', type: 'blob' },
    { path: 'notas', sha: '7', type: 'tree' },
  ];
  const r = diffTree({ 'notas/a.md': '1', 'notas/b.md': '2a', 'notas/velha.md': '9' }, tree);
  assert.deepEqual(r.buscar, [{ path: 'notas/b.md', sha: '2b' }, { path: 'inbox/c.md', sha: '3' }]);
  assert.deepEqual(r.remover, ['notas/velha.md']);
});

test('b64 ida e volta com acentos, emoji e texto grande', () => {
  for (const s of ['ção 🧠 despersonalização', 'x'.repeat(200000) + 'é']) assert.equal(b64decode(b64encode(s)), s);
  assert.equal(b64decode('w6c=\n'), 'ç');
});

test('slugify igual ao Python e newNote evita colisão', () => {
  assert.equal(slugify('Transtorno de Despersonalização: TCC!'), 'transtorno-de-despersonalizacao-tcc');
  assert.equal(slugify('!!!'), 'sem-titulo');
  const r = newNote('Ideia', new Set(['notas/ideia.md']), 'Psicologia clínica', new Date('2026-10-01T12:00:00Z'));
  assert.equal(r.path, 'notas/ideia-2.md');
  const p = parseNote(r.path, r.content);
  assert.equal(p.meta.revisado, true);
  assert.equal(p.meta.criado, '2026-10-01');
});
