// v1.7.0 (15/10/2026) — porte do servidor_tcero.py v1.7.0 (commit 785c88a): julgados_que_citam_tcero. Funções puras (texto → texto), sem rede;
// a consulta ao portal fica em index.js (`julgadosQueCitam`). Mesmas frases do Python.
import * as L from "./lib.js";
import { listarRecibosTcero } from "./v160.js";
import { posicaoTcero } from "./posicao2.js";

const RE_NUMERO_CITADO = /^[ \t\n\r\f\v]*0*([0-9]{1,5})[ \t\n\r\f\v]*\/[ \t\n\r\f\v]*([0-9]{2})[ \t\n\r\f\v]*$/;
const RE_ESPACOS_PY = /[ \t\n\r\f\v]+/g;
export const JANELA_ANTES = 350;
export const JANELA_DEPOIS = 250;
export const JANELAS_MAX = 3;
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** (forma de 8 caracteres "NNNNN/AA", dígitos sem zeros à esquerda, ano) ou null. Só o formato do portal. */
export function numeroCitado(v) {
  const m = RE_NUMERO_CITADO.exec(L.texto(v));
  if (!m) return null;
  const n = m[1].replace(/^0+/, "") || "0";
  const aa = m[2];
  return [`${n.padStart(5, "0")}/${aa}`, n, aa];
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

/** Das decisões que o portal devolveu para a frase, só as que TRAZEM o número no texto. [achados, próprias, semNúmero]. */
export function citacoesNoPortal(itens, forma, n, aa, sigla = null) {
  const achados = [];
  let proprias = 0;
  let semNumero = 0;
  for (const it of itens) {
    const s = it.source || {};
    if (ehOProprio(s, forma, sigla)) {
      proprias += 1;
      continue;
    }
    const campos = [
      ["ementa", L.ementaLimpa(s)],
      ["dispositivo (acordaoDescricao)", L.htmlParaTexto(s.acordaoDescricao || "")],
      ["informações adicionais (IA do DEJUR, não citável)", L.htmlParaTexto(s.informacoesAdicionais || "")],
    ];
    const jan = [];
    for (const [nome, txt] of campos) for (const [, w] of janelasDeCitacaoTcero(txt, n, aa, JANELA_ANTES, JANELA_DEPOIS, 1)) jan.push([nome, w]);
    if (jan.length) achados.push({ s, janelas: jan, fontes: new Set(["portal"]) });
    else semNumero += 1;
  }
  return [achados, proprias, semNumero];
}

/** Mesma busca, SEM REDE, no texto gravado dos recibos (ementa + dispositivo + PDF quando lido). */
export function citacoesNosRecibos(forma, n, aa, pasta = null, sigla = null) {
  const [lista] = listarRecibosTcero(pasta);
  const out = [];
  for (const it of lista) {
    const r = it.r;
    if (ehOProprio({ numero: r.numero, processo: r.processo, sigla: r.sigla }, forma, sigla)) continue;
    const texto = r.texto || "";
    const jan = [];
    for (const [pos, w] of janelasDeCitacaoTcero(texto, n, aa, JANELA_ANTES, JANELA_DEPOIS, 2)) {
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
      for (const f of h.fontes) e.fontes.add(f);
      const vistos = new Set(e.janelas.map(([, w]) => w.slice(0, 80)));
      e.janelas.push(...h.janelas.filter(([, w]) => !vistos.has(w.slice(0, 80))));
    } else {
      porId.set(k, h);
    }
  }
  const hits = [...porId.values()];
  hits.sort((a, b) => {
    const x = String(a.s.dataSessao || ""), y = String(b.s.dataSessao || "");
    return x < y ? 1 : x > y ? -1 : 0;
  });
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
  // avisos FIXOS antes da lista: se o teto cortar, o que se perde é resultado, nunca o aviso de que zero/recall/superação não provam nada
  if (!hits.length) {
    out.push(
      "Nenhum julgado achado. ZERO AQUI NÃO PROVA que ninguém aplicou o julgado: o portal indexa texto (ementa, dispositivo e informações " +
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
  if (hits.length > limite) out.push(`\n… e mais ${hits.length - limite} achado(s) além do limite pedido (${limite}).`);
  return out.join("\n");
}
