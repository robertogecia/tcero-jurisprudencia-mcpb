// v1.7.0 (15/10/2026) — porte do servidor_tcero.py v1.7.0 (commit 785c88a): julgados_que_citam_tcero. Funções puras (texto → texto), sem rede;
// a consulta ao portal fica em index.js (`julgadosQueCitam`). Mesmas frases do Python.
import * as L from "./lib.js";
import { listarRecibosTcero } from "./v160.js";
import { posicaoTcero } from "./posicao2.js";

const RE_ESPACOS_PY = /[ \t\n\r\f\v]+/g;
export const JANELA_ANTES = 350;
export const JANELA_DEPOIS = 250;
export const JANELAS_MAX = 3;
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** (forma de 8 caracteres "NNNNN/AA", dígitos sem zeros à esquerda, ano) ou null. Pendências do red team 22/10/2026: a MESMA normalização de
 * buscar/obter/verificar (`L.normalizarNumeroTc`: sigla e "Acórdão"/"Processo" na frente, ano de 4 dígitos, espaço na barra). */
export function numeroCitado(v) {
  const r = L.normalizarNumeroTc(v);
  return r.valido ? [r.forma, r.n, r.aa] : null;
}

/** Ocorrência do número no TEXTO de outro julgado, com ou sem zeros à esquerda; recusa dígito colado antes, ano de 4 dígitos e data. */
export function regexNumeroCitado(n, aa, flags = "") {
  return new RegExp(`(?<![0-9/])0*${escRe(n)}\\s?/\\s?${escRe(aa)}(?![0-9]|/[0-9])`, flags);
}

/** [[posição, janela]] em volta das ocorrências do número no texto de OUTRO julgado (ocorrências coladas numa mesma janela contam uma). */
export function janelasDeCitacaoTcero(texto, n, aa, antes = JANELA_ANTES, depois = JANELA_DEPOIS, maximo = JANELAS_MAX) {
  if (!texto) return [];
  const out = [];
  let ult = -1e9;
  for (const m of texto.matchAll(regexNumeroCitado(n, aa, "g"))) {
    if (m.index - ult < depois) continue;
    ult = m.index;
    out.push([m.index, texto.slice(Math.max(0, m.index - antes), m.index + m[0].length + depois).replace(RE_ESPACOS_PY, " ").trim()]);
    if (out.length >= maximo) break;
  }
  return out;
}

export function ehOProprio(s, forma, sigla = null) {
  // número de PROCESSO não tem sigla; número de ACÓRDÃO só é o próprio se a sigla também bater (quando as duas são conhecidas)
  if (forma === L.padronizarNumero(L.texto(s.processo))) return true;
  if (forma !== L.padronizarNumero(L.texto(s.numero))) return false;
  const a = L.texto(sigla).toUpperCase();
  const b = L.texto(s.sigla).toUpperCase();
  return !(a && b && a !== b);
}

// Pendências do red team 22/10/2026 (achado médio): sem sigla nem tipo, `ehOProprio` descartava calado como "próprio julgado" o acórdão de
// OUTRA sigla com o mesmo número (AC1-TC 00120/25 citando o APL-TC 00120/25) e a decisão cujo PROCESSO tem esse número. Agora:
//  - "proprio" (descartado) só no casamento exato: tipo "processo" e mesmo processo; ou acórdão com a mesma sigla e o mesmo número;
//  - a decisão que colide (mesmo número em outra sigla, sigla não informada, ou processo com o número do acórdão) NÃO some: as ocorrências
//    que são o próprio número dela ("AC1-TC 00120/25" no texto do AC1-TC 00120/25; "processo 00120/25" no do processo 00120/25) caem, e o
//    que sobra vai para um bloco à parte, "mesmo número em outra sigla/processo — confira" (ou para a lista, se a sigla antes do número é
//    a informada pelo usuário);
//  - sem nenhuma ocorrência que sobre, conta como próprio julgado (como antes).
const RE_SIGLA_ANTES = /((?:APL|AC[12])R?)[ \t]*-?[ \t]*TC[ \t]*(?:n[º°o.]*[ \t]*)?$/i;
const RE_PROCESSO_ANTES = /(?:processo|proc\.?|autos)[ \t]*(?:n[º°o.]*[ \t]*)?$/i;
/** Sigla escrita logo antes da ocorrência do número em `texto` ("APL-TC"), ou null. */
export function siglaAntes(texto, pos) {
  const m = RE_SIGLA_ANTES.exec(texto.slice(Math.max(0, pos - 30), pos).replace(/[ \t\n\r\f\v]+/g, " "));
  return m ? `${m[1].toUpperCase()}-TC` : null;
}
/** A ocorrência é o número da PRÓPRIA decisão `s` (cabeçalho, autuação), não citação de outro julgado. */
export function ocorrenciaPropria(texto, pos, s, forma) {
  if (forma === L.padronizarNumero(L.texto(s.numero)) && L.texto(s.sigla) && siglaAntes(texto, pos) === L.texto(s.sigla).toUpperCase()) return true;
  return forma === L.padronizarNumero(L.texto(s.processo)) && RE_PROCESSO_ANTES.test(texto.slice(Math.max(0, pos - 30), pos).replace(/[ \t\n\r\f\v]+/g, " "));
}
/** "proprio" | "colisao" | null — relação da decisão `s` com o número procurado (`tipo` "processo" | "acordao" | null; `sigla` só de acórdão). */
export function relacaoComCitado(s, forma, sigla = null, tipo = null) {
  const doProcesso = forma === L.padronizarNumero(L.texto(s.processo));
  const doNumero = forma === L.padronizarNumero(L.texto(s.numero));
  if (!doProcesso && !doNumero) return null;
  const sg = L.texto(sigla).toUpperCase();
  const ss = L.texto(s.sigla).toUpperCase();
  if (tipo === "processo") return doProcesso ? "proprio" : "colisao";
  if (sg && doNumero && ss === sg) return "proprio";
  if (sg && doNumero && ss && ss !== sg && !doProcesso) return null;   // outro acórdão com o mesmo número: o que ele cita entra na lista
  return "colisao";
}
/** Janelas das ocorrências que NÃO são o número da própria decisão; `daSigla` = alguma delas tem a sigla informada logo antes. */
function janelasFiltradas(txt, s, forma, n, aa, sigla, maximo) {
  const sg = L.texto(sigla).toUpperCase();
  let daSigla = false;
  const out = [];
  let ult = -1e9;
  for (const m of txt.matchAll(regexNumeroCitado(n, aa, "g"))) {
    if (ocorrenciaPropria(txt, m.index, s, forma)) continue;
    if (sg && siglaAntes(txt, m.index) === sg) daSigla = true;
    if (m.index - ult < JANELA_DEPOIS) continue;
    ult = m.index;
    out.push([m.index, txt.slice(Math.max(0, m.index - JANELA_ANTES), m.index + m[0].length + JANELA_DEPOIS).replace(RE_ESPACOS_PY, " ").trim()]);
    if (out.length >= maximo) break;
  }
  return [out, daSigla];
}

/** Das decisões que o portal devolveu para a frase, só as que TRAZEM o número no texto. [achados, próprias, semNúmero]; o achado que colide
 * com o número (ver `relacaoComCitado`) vem com `colisao: true` — quem formata o mostra à parte. */
export function citacoesNoPortal(itens, forma, n, aa, sigla = null, tipo = null) {
  const achados = [];
  let proprias = 0;
  let semNumero = 0;
  for (const it of itens) {
    const s = it.source || {};
    const rel = relacaoComCitado(s, forma, sigla, tipo);
    if (rel === "proprio") {
      proprias += 1;
      continue;
    }
    const campos = [
      ["ementa", L.ementaLimpa(s)],
      ["dispositivo (acordaoDescricao)", L.htmlParaTexto(s.acordaoDescricao || "")],
      ["informações adicionais (IA do DEJUR, não citável)", L.htmlParaTexto(s.informacoesAdicionais || "")],
    ];
    const jan = [];
    let daSigla = false;
    for (const [nome, txt] of campos) {
      const [js, ds] = janelasFiltradas(txt || "", s, forma, n, aa, sigla, 1);
      daSigla = daSigla || ds;
      for (const [, w] of js) jan.push([nome, w]);
    }
    if (jan.length) achados.push({ s, janelas: jan, fontes: new Set(["portal"]), colisao: rel === "colisao" && !daSigla });
    else if (rel === "colisao") proprias += 1;
    else semNumero += 1;
  }
  return [achados, proprias, semNumero];
}

/** Mesma busca, SEM REDE, no texto gravado dos recibos (ementa + dispositivo + PDF quando lido). */
export function citacoesNosRecibos(forma, n, aa, pasta = null, sigla = null, tipo = null) {
  const [lista] = listarRecibosTcero(pasta);
  const out = [];
  for (const it of lista) {
    const r = it.r;
    const sr = { numero: r.numero, processo: r.processo, sigla: r.sigla };
    const rel = relacaoComCitado(sr, forma, sigla, tipo);
    if (rel === "proprio") continue;
    const texto = r.texto || "";
    const jan = [];
    const [js, daSigla] = janelasFiltradas(texto, sr, forma, n, aa, sigla, 2);
    for (const [pos, w] of js) {
      let onde = "";
      let pag = "";
      try {
        onde = posicaoTcero(texto, pos);
        pag = L.paginaPdfTcero(texto, pos);
      } catch {
        onde = pag = "";
      }
      const rot = r.texto_pdf_completo !== null && r.texto_pdf_completo !== undefined ? "recibo local (ementa+dispositivo+PDF lido)" : "recibo local (ementa+dispositivo)";
      jan.push([rot + (onde ? `; ${onde}` : "") + (pag ? ` (${pag})` : ""), w]);
    }
    if (jan.length) {
      out.push({
        s: { idDecisao: r.id_documento, sigla: r.sigla, numero: r.numero, processo: r.processo, relator: r.relator, orgaoJulgador: r.orgao_cadastro, dataSessao: r.data_sessao },
        janelas: jan,
        fontes: new Set(["recibo"]),
        colisao: rel === "colisao" && !daSigla,
      });
    }
  }
  return out;
}

const chaveId = (v) => (v === null || v === undefined ? "None" : String(v));

/** Texto final (puro, sem rede). `portal` null = a consulta ao portal não foi feita/falhou (dito na saída). */
export function formatarCitacoes(forma, portal, recibos, limite, info) {
  const porId = new Map();
  for (const h of [...(portal || []), ...recibos]) {
    const k = chaveId(h.s.idDecisao);
    if (porId.has(k)) {
      const e = porId.get(k);
      e.colisao = Boolean(e.colisao && h.colisao);   // basta uma fonte com a sigla informada antes do número para ir à lista
      for (const f of h.fontes) e.fontes.add(f);
      const vistos = new Set(e.janelas.map(([, w]) => w.slice(0, 80)));
      e.janelas.push(...h.janelas.filter(([, w]) => !vistos.has(w.slice(0, 80))));
    } else {
      porId.set(k, { ...h, fontes: new Set(h.fontes), janelas: [...h.janelas] });
    }
  }
  const porData = (a, b) => {
    const x = String(a.s.dataSessao || ""), y = String(b.s.dataSessao || "");
    return x < y ? 1 : x > y ? -1 : 0;
  };
  const todos = [...porId.values()];
  const hits = todos.filter((h) => !h.colisao).sort(porData);
  const colisoes = todos.filter((h) => h.colisao).sort(porData);
  const out = [
    `**Julgados do TCE-RO que citam ${forma}** (processo ou acórdão com esse número) — ${hits.length} achado(s): ` +
      `${hits.filter((h) => h.fontes.has("portal")).length} pelo texto que o portal indexa, ` +
      `${hits.filter((h) => h.fontes.has("recibo")).length} pelos recibos locais (offline).`,
  ];
  if (portal === null || portal === undefined) {
    out.push("⛔ [PESQUISA NÃO REALIZADA no portal] " + (info.erro || "consulta não feita") + " — só os recibos locais foram vistos.");
  } else {
    out.push(
      `Portal: frase "${forma}" no textoLivre devolveu ${L.num(info.total_portal || 0)} decisão(ões); ` +
        `${L.num(info.sem_numero || 0)} sem o número no texto (descartadas) e ${L.num(info.proprias || 0)} do próprio julgado (descartadas).`
    );
  }
  if (colisoes.length) {
    out.push(
      `⚠️ ${colisoes.length} decisão(ões) com o MESMO NÚMERO ${forma} em outra sigla ou como número de processo — podem ser o próprio julgado ` +
        "ou citá-lo; ficam num bloco à parte no fim, não na contagem acima. " +
        (info.sigla ? "" : 'Para separar, informe a sigla no número (ex.: "APL-TC 00037/23") ou tipo="processo".')
    );
  }
  // avisos FIXOS antes da lista: se o teto cortar, o que se perde é resultado, nunca o aviso de que zero/recall/superação não provam nada
  if (!hits.length) {
    out.push(
      (colisoes.length ? "Nenhum julgado achado fora do bloco de mesmo número (no fim). " : "Nenhum julgado achado. ") + "ZERO AQUI NÃO PROVA que ninguém aplicou o julgado: o portal indexa texto (ementa, dispositivo e informações " +
        "adicionais) e o PDF do inteiro teor NÃO é varrido; o recall é baixo."
    );
  }
  out.push(
    "_Leitura assistida, não confirmação. NÃO detecta superação nem distinção: leia a janela e confira o julgado que cita antes de afirmar " +
      "que ele segue o precedente. O recall é baixo: o portal indexa texto e o PDF do inteiro teor NÃO é varrido; citação sem a forma NNNNN/AA " +
      "(por extenso, só o ano, só a sigla) não é achada. Os recibos locais cobrem só o que esta máquina já leu._"
  );
  hits.slice(0, Math.max(1, Math.trunc(limite))).forEach((h, idx) => {
    const s = h.s;
    const src = [h.fontes.has("portal") ? "portal" : "", h.fontes.has("recibo") ? "recibo local" : ""].filter(Boolean).sort().join(" + ");
    const dj = L.dataBr(s.dataSessao || "") || "sessão não informada";
    out.push(
      `\n${idx + 1}. ${s.sigla || "?"} ${s.numero || "?"} · id ${s.idDecisao} · processo ${s.processo || "—"} · ` +
        `${s.orgaoJulgador || "?"} · ${dj} · Rel. ${s.relator || "?"} · fonte: ${src}`
    );
    for (const [nome, w] of h.janelas.slice(0, 2)) out.push(`   [${nome}] > ${L.neutralizarMarkdown(w).slice(0, 620)}`);
  });
  if (colisoes.length) {
    const TETO_COLISOES = 5;
    out.push(`\n**Mesmo número ${forma} em outra sigla ou processo — possivelmente o próprio julgado; confira se o trecho cita o julgado que você procura:**`);
    for (const h of colisoes.slice(0, TETO_COLISOES)) {
      const s = h.s;
      const src = [h.fontes.has("portal") ? "portal" : "", h.fontes.has("recibo") ? "recibo local" : ""].filter(Boolean).sort().join(" + ");
      out.push(`- ${s.sigla || "?"} ${s.numero || "?"} · id ${s.idDecisao} · processo ${s.processo || "—"} · ${L.dataBr(s.dataSessao || "") || "sessão não informada"} · fonte: ${src}`);
      const [nome, w] = h.janelas[0];
      out.push(`   [${nome}] > ${L.neutralizarMarkdown(w).slice(0, 400)}`);
    }
    if (colisoes.length > TETO_COLISOES) out.push(`- (${colisoes.length - TETO_COLISOES} outra(s) decisão(ões) de mesmo número não mostradas)`);
  }
  if (hits.length > limite) out.push(`\n… e mais ${hits.length - limite} achado(s) além do limite pedido (${limite}).`);
  return out.join("\n");
}
