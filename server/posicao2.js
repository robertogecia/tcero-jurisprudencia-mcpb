// POSIÇÃO NO JULGADO (06/10/2026) para TRT14, TCE-RO, TED-OAB/SP e TNU — espelho de _posicao_generica + _posicao_trt14 /
// _posicao_tcero / _posicao_ted / _posicao_tnu dos servidores Python. Arquivo IDÊNTICO nas quatro extensões (como atribuicao13.js);
// a fonte é a do TRT14. Localizador, não juiz: diz onde a frase está; ratio × dictum continua sendo de quem lê.
// Regex sem a flag `u` (\b e \d ASCII, como o re.ASCII do Python). O `^`/`$` multilinha do Python só olha "\n"; o do JS também
// para em "\r" — por isso as âncoras de linha vão explícitas (INI / FIM).
import { norm1 } from "./atribuicao13.js";

const INI = "(?:(?<=\\n)|(?<![\\s\\S]))";
const FIM = "(?=\\n|(?![\\s\\S]))";
const RE_DISPOSITIVO_VOTO = /(?<![a-z0-9])(?:ante o exposto|diante do exposto|pelo exposto|em face do exposto|por todo o exposto|posto isso|posto isto|isso posto|isto posto|por tais razoes|por essas razoes|por todas essas razoes|com essas consideracoes|com tais consideracoes|ex positis|forte nessas razoes)(?![a-z0-9])/g;
const RE_RESULTADO_VOTO = /(?<![a-z0-9])(?:nego|dou|conheco|nao conheco|julgo|rejeito|acolho|mantenho|reformo|provimento|provido|desprovido|improcedente|procedente|prejudicado|homologo|declaro|defiro|indefiro|concedo|denego|extingo|anulo|casso|confirmo|voto (?:pelo|por|no sentido))(?![a-z0-9])/;
const ROTULO = {
  "caso em exame": "ementa › I. CASO EM EXAME — resumo do caso, não tese",
  "questao em discussao": "ementa › II. QUESTÃO EM DISCUSSÃO — a pergunta posta, não a resposta",
  "razoes de decidir": "ementa › III. RAZÕES DE DECIDIR — fundamento que a ementa apresenta como razão de decidir (candidato a ratio; confira no voto se o resultado dependeu dele)",
  "dispositivo e tese": "ementa › IV. DISPOSITIVO E TESE — resultado e tese enunciada",
  "dispositivo": "ementa › IV. DISPOSITIVO — resultado do julgamento",
  "entendimento": "ementa › III. ENTENDIMENTO — a tese que o Tribunal de Contas firmou (candidato a ratio; confira no voto)",
  "fundamento": "ementa › IV. FUNDAMENTO — base normativa e precedentes citados, não tese",
  "cauda": "ementa › parte final (dispositivos e jurisprudência citados, resumo) — referência, não tese",
};
const SECAO_CNJ = "caso em exame|quest(?:ao|oes) em discussao|razoes de decidir|dispositivos? e teses?|dispositivo";
const SECAO_TC = "|contexto fatico|questao (?:tecnica e/ou juridica|tecnica|juridica)|entendimento|fundamentos?";
const RE_CAUDA_EMENTA = /\b(?:Dispositivos? relevantes? citados?|Jurisprud[êe]ncia relevante citada|Legisla[çc][ãa]o relevante citada|Resumo em linguagem simples|RESUMO[ \t]*:)/;

/** Seções da ementa do CNJ (e, com tce=true, o modelo do TCE-RO: Contexto fático · Questão técnica e/ou jurídica · Entendimento ·
 * Fundamento) em [ini, fim). Busca sobre norm1 (1:1); a linha confere no bruto. */
export function secoesDaEmenta(texto, ini, fim, tce = false) {
  const seg = texto.slice(ini, fim), nt = norm1(seg);
  const re = new RegExp(`(?<![a-z0-9])(?:(i{1,3}|iv|v)[ \\t\\n\\r\\f\\v]*[.)-]?[ \\t\\n\\r\\f\\v]*)?(${SECAO_CNJ}${tce ? SECAO_TC : ""})(?![a-z0-9])`, "g");
  const marcas = [];
  for (const m of nt.matchAll(re)) {
    const i2 = m.index + m[0].length - m[2].length;
    if (!m[1]) {
      const antes = seg.slice(0, i2).replace(/[ \t]+$/, "");
      const depois = seg.slice(i2 + m[2].length, i2 + m[2].length + 4).replace(/^[ \t]+/, "");
      const c = depois.slice(0, 1);
      if (!(antes === "" || antes.endsWith("\n")) || !(c === "." || c === ":" || c === "\n" || (c !== "" && "0123456789".includes(c)))) continue;
    }
    let nome = m[2].replace(/^quest(?:ao|oes) em discussao$/, "questao em discussao").replace(/^dispositivos? e teses?$/, "dispositivo e tese");
    if (tce) nome = { "contexto fatico": "caso em exame", fundamentos: "fundamento" }[nome] || (nome.startsWith("questao ") ? "questao em discussao" : nome);
    if (marcas.length && marcas[marcas.length - 1].nome === nome && ini + m.index - marcas[marcas.length - 1].a < 40) continue;
    marcas.push({ nome, a: ini + m.index });
  }
  if (!marcas.length) return [];
  const cauda = seg.search(RE_CAUDA_EMENTA);
  const out = marcas.map((mk, i) => ({ nome: mk.nome, a: mk.a, b: i + 1 < marcas.length ? marcas[i + 1].a : (cauda >= 0 && ini + cauda > mk.a ? ini + cauda : fim) }));
  if (cauda >= 0 && ini + cauda > out[out.length - 1].a) out.push({ nome: "cauda", a: ini + cauda, b: fim });
  return out;
}

export function posicaoGenerica(texto, meio, { ementa = null, relatorio = null, votos = [], outros = [], fecho = null, cabecalho = null, certidao = null, dispIni = null, tce = false } = {}) {
  const dentro = (r) => r !== null && r[0] <= meio && meio < r[1];
  if (dentro(cabecalho)) return "cabeçalho da peça (autuação)";
  if (dentro(ementa)) {
    const s = secoesDaEmenta(texto, ementa[0], ementa[1], tce).find((x) => x.a <= meio && meio < x.b);
    return s ? ROTULO[s.nome] || s.nome : "ementa (modelo antigo, sem seções) — síntese do julgado";
  }
  if (dentro(fecho)) return "acórdão/fecho (o que o colegiado proclamou)";
  if (dentro(certidao)) return "certidão de julgamento (quem votou e como; não é fundamentação)";
  if (dentro(relatorio)) return "RELATÓRIO — narração do processo e das teses das partes, não decisão";
  for (const [a, b, rot] of outros) if (a <= meio && meio < b) return `${rot} — não é o voto condutor (vencido, vista, vogal ou ementa proposta em outro voto); veja quem venceu`;
  for (const [a, b] of votos) {
    if (!(a <= meio && meio < b)) continue;
    let disp = dispIni !== null && a <= dispIni && dispIni < b ? dispIni : -1;
    if (disp < 0 && dispIni !== -1) {   // -1 = o chamador já procurou e não há dispositivo localizável
      const tn = norm1(texto.slice(a, b));
      for (const m of tn.matchAll(RE_DISPOSITIVO_VOTO)) if (RE_RESULTADO_VOTO.test(tn.slice(m.index, m.index + 300))) disp = a + m.index;
    }
    if (disp >= 0 && meio >= disp) return "DISPOSITIVO do voto — é o que foi decidido, não a razão de decidir";
    if (disp >= 0) return `fundamentação do voto condutor, antes do dispositivo (o dispositivo começa ${[...texto.slice(meio, disp)].length} caracteres adiante, em «${texto.slice(disp, disp + 60).replace(/[ \t\n\r\f\v]+/g, " ")}…»)`;
    return "fundamentação do voto condutor (dispositivo não localizado por fórmula)";
  }
  return "";
}

const proximo = (lista, depois, padrao) => { for (const x of lista) if (x > depois) return x; return padrao; };
const stripPy = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
const WS_PY = " \t\n\r\f\v";

// ---------------------------------------------------------------- TRT14
const RE_CAB_TRT = new RegExp(`${INI}[ \\t]*(IDENTIFICA[ÇC][ÃA]O|EMENTA|FUNDAMENTA[ÇC][ÃA]O|ASSINATURA|VOTOS|AC[ÓO]RD[ÃA]O|DECIS[ÃA]O|RELAT[ÓO]RIO|FUNDAMENTOS|CONCLUS[ÃA]O`
  + `|(\\d+)(?:\\.(\\d+))*\\.?[ \\t]+([^\\n]{2,80}?))[ \\t]*:?[ \\t]*${FIM}`, "g");
/** _posicao_trt14: IDENTIFICAÇÃO → EMENTA → FUNDAMENTAÇÃO → "1 RELATÓRIO" → "2 FUNDAMENTOS" ("2.x CONCLUSÃO" = dispositivo) →
 * "3 DECISÃO"/"ACÓRDÃO" → ASSINATURA → VOTOS. */
export function posicaoTrt14(bruto, meio) {
  const n = bruto.length;
  let ident = -1, ementa = -1, fund = -1, rel = -1, fundamentos = -1, conclusao = -1, decisao = -1, assin = -1, votosIni = -1;
  for (const m of bruto.matchAll(RE_CAB_TRT)) {
    const g = stripPy(norm1(m[1]), WS_PY);
    const topo = m[2], sub = m[3], nome = stripPy(norm1(m[4] || ""), " .:");
    if (g.startsWith("identifica") && ident < 0) ident = m.index;
    else if (g === "ementa" && ementa < 0) ementa = m.index;
    else if (g.startsWith("fundamentacao") && !topo && fund < 0) fund = m.index;
    else if (rel < 0 && ((topo === "1" && !sub && nome.startsWith("relatorio")) || (!topo && g === "relatorio" && fund >= 0))) rel = m.index;
    else if (fundamentos < 0 && rel >= 0 && ((topo === "2" && !sub) || (!topo && g === "fundamentos"))) fundamentos = m.index;
    else if (fundamentos >= 0 && decisao < 0 && ((topo === "2" && sub && nome.startsWith("conclus")) || (!topo && g === "conclusao"))) conclusao = m.index;
    else if (fundamentos >= 0 && decisao < 0 && ((topo === "3" && !sub && (nome.startsWith("decis") || nome.startsWith("acord")))
      || (!topo && (g.startsWith("decis") || g.startsWith("acord"))
        && /(?<![a-z0-9])acordam(?![a-z0-9])/.test(norm1(bruto.slice(m.index + m[0].length, m.index + m[0].length + 600)))))) decisao = m.index;
    else if (g === "assinatura" && assin < 0 && m.index > Math.max(rel, fundamentos)) assin = m.index;
    else if (g === "votos" && votosIni < 0 && m.index > Math.max(rel, fundamentos, assin)) votosIni = m.index;
  }
  const relIni = 0 <= fund && fund < rel && rel - fund < 120 ? fund : rel;
  const fimVoto = proximo([decisao, assin, votosIni, n], fundamentos, n);
  let disp = conclusao;
  if (disp < 0 && fundamentos >= 0) {
    // espelho do Python: sem CONCLUSÃO, só fórmula com resultado no último terço do voto
    const tn = norm1(bruto).slice(0, fimVoto), corte = fundamentos + Math.floor(((fimVoto - fundamentos) * 2) / 3);
    const re = new RegExp(RE_DISPOSITIVO_VOTO.source, "g"); re.lastIndex = corte; const forms = [];
    for (let x; (x = re.exec(tn)) !== null;) if (RE_RESULTADO_VOTO.test(norm1(bruto).slice(x.index, x.index + 300))) forms.push(x.index);
    disp = forms.length ? forms[forms.length - 1] : -1;
  }
  const iniCorpo = [ementa, fund, rel].find((x) => x >= 0) ?? -1;
  return posicaoGenerica(bruto, meio, {
    cabecalho: iniCorpo > 0 ? [0, iniCorpo] : null,
    ementa: ementa >= 0 ? [ementa, proximo([fund, rel, n], ementa, n)] : null,
    relatorio: rel >= 0 ? [relIni, proximo([fundamentos, decisao, n], rel, n)] : null,
    votos: fundamentos >= 0 ? [[fundamentos, fimVoto]] : [],
    fecho: decisao >= 0 ? [decisao, proximo([assin, votosIni, n], decisao, n)] : null,
    certidao: assin >= 0 ? [assin, votosIni > assin ? votosIni : n] : null,
    outros: votosIni >= 0 ? [[votosIni, n, "VOTOS de outros magistrados"]] : [],
    dispIni: disp,
  });
}

// ---------------------------------------------------------------- TCE-RO
const RE_CAB_TC = new RegExp(`${INI}[ \\t]*(?:[IVX]{1,4}[ \\t]*[–.-]+[ \\t]*)?(?:D[OA][ \\t]+)?(EMENTA|AC[ÓO]RD[ÃA]O|RELAT[ÓO]RIO|VOTO|PROPOSTA DE DECIS[ÃA]O`
  + `|FUNDAMENTA[ÇC][ÃA]O|FUNDAMENTOS|DISPOSITIVO)\\b([^\\n]{0,70})${FIM}`, "g");
const RE_AUTUACAO_TC = new RegExp(`${INI}[ \\t]*(?:PROCESSO|ASSUNTO|JURISDICIONAD|INTERESSAD|RESPONS[ÁA]VE|ADVOGAD|UNIDADE|RELATOR|SESS[ÃA]O|GRUPO`
  + `|EMBARGANTE|EMBARGAD|RECORRENTE|RECORRID|REQUERENTE|CATEGORIA|SUBCATEGORIA|EXERC[ÍI]CIO|PROCURADOR|IMPETRANTE|REPRESENTANTE`
  + `|REPRESENTAD|ORIGEM|NATUREZA)\\b[^\\n]*${FIM}`, "g");
const RE_PAGINA_TC = /TRIBUNAL DE CONTAS DO ESTADO DE ROND[ÔO]NIA[ \t]*\n(?:[^\n]*\n){0,9}?[^\n]*(?:Proc\.?[ \t]*:[^\n]*|\d+[ \t]+de[ \t]+\d+[ \t]*)\n|TRIBUNAL DE CONTAS DO ESTADO DE ROND[ÔO]NIA[ \t]*\n[^\n]*\n?[ \t]*D[^\n]{0,6}-SPJ[^\n]*\n(?:[^\n]*Ac[óo]rd[ãa]o[^\n]*\n)?/g;
const RE_RESULTADO_TC = /(?<![a-z0-9])(?:convergindo|acolh\w*|submeto|proponho|propoe-se|decido|voto (?:no sentido|pelo|por)|e como voto|considerar (?:legal|ilegal|regular|irregular|cumprid)|julgar (?:regular|irregular|legal|ilegal)|determinar)/;
const NAO_NOME_TC = new Set(["conselheiro", "conselheira", "substituto", "substituta", "relator", "relatora", "vista", "voto", "retificado", "proposta", "decisao", "de", "da", "do", "dos", "das"]);
const sobrenTc = (x) => (norm1(x).match(/[a-z]{3,}/g) || []).filter((w) => !NAO_NOME_TC.has(w));

/** _posicao_tcero: autuação → ementa → ACÓRDÃO → autuação repetida → RELATÓRIO → VOTO/PROPOSTA DE DECISÃO → DISPOSITIVO; votos
 * de outros conselheiros pelo nome no título; o recibo começa pela ementa do cadastro. */
export function posicaoTcero(bruto, meio) {
  const n = bruto.length;
  {  // espelho de finditer(bruto, meio - 400, meio + 400): a busca começa em meio - 400 e o casamento termina até meio + 400
    const jan = bruto.slice(0, Math.min(n, meio + 400)), re = new RegExp(RE_PAGINA_TC.source, "g");
    re.lastIndex = Math.max(0, meio - 400);
    for (let m; (m = re.exec(jan)) !== null;) {
      if (m.index <= meio && meio < m.index + m[0].length) return "cabeçalho de página do PDF (repetido em toda folha) — não é texto decisório";
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  const marcas = [];
  for (const m of bruto.matchAll(RE_CAB_TC)) {
    const k = norm1(m[1]), resto = stripPy(norm1(m[2] || ""), " :.-–");
    if (k === "dispositivo" && resto.startsWith("e tese")) continue;
    if (["acordao", "relatorio", "dispositivo", "ementa"].includes(k) && resto.length > 25) continue;
    marcas.push([m.index, k, resto]);
  }
  let blocos = [];
  for (const m of bruto.matchAll(RE_AUTUACAO_TC)) {
    const fimM = m.index + m[0].length;
    if (blocos.length && m.index - blocos[blocos.length - 1][1] <= 900) { blocos[blocos.length - 1][1] = fimM; blocos[blocos.length - 1][2] += 1; }
    else blocos.push([m.index, fimM, 1]);
  }
  const tresLinhas = (p) => { for (let i = 0; i < 3; i++) { const k = bruto.indexOf("\n", p + 1); if (k < 0) return n; p = k; } return p; };
  blocos = blocos.filter((b) => b[2] >= 3).map(([a, b]) => [a, tresLinhas(b)]);
  const pos = (k, depois = 0) => { for (const [p, kk] of marcas) if (kk === k && p >= depois) return p; return -1; };
  const acordao = pos("acordao");
  const mRel = /RELATOR[A]?[ \t]*:?[ \t]*\n?[ \t]*([^\n]{3,90})/.exec(bruto);
  const relator = mRel ? sobrenTc(mRel[1]) : [];
  const segs = []; let donoAnt = null;
  const corpo = marcas.filter(([, k]) => ["relatorio", "voto", "proposta de decisao", "fundamentacao", "fundamentos"].includes(k));
  corpo.forEach(([p, k, r], i) => {
    const f = i + 1 < corpo.length ? corpo[i + 1][0] : n;
    if (k === "relatorio") { segs.push([p, f, "relatorio"]); donoAnt = "relator"; return; }
    const nomes = sobrenTc(r);
    let dono;
    if (nomes.length) dono = relator.length && (relator.includes(nomes[nomes.length - 1]) || nomes.includes(relator[relator.length - 1])) ? "relator" : "outro";
    else dono = donoAnt || "relator";
    segs.push([p, f, dono]); donoAnt = dono;
  });
  const relSeg = (segs.find(([a, b, d]) => d === "relatorio" && a <= meio && meio < b) || segs.find(([, , d]) => d === "relatorio") || null);
  const rs = relSeg ? [relSeg[0], relSeg[1]] : null;
  const votos = segs.filter(([, , d]) => d === "relator").map(([a, b]) => [a, b]);
  const outros = segs.filter(([, , d]) => d === "outro").map(([a, b]) => [a, b, "VOTO de outro conselheiro"]);
  const rel = rs ? rs[0] : -1;
  const voto = votos.length ? votos[0][0] : -1;
  const tnAll = norm1(bruto);
  const vMeio = votos.find(([a, b]) => a <= meio && meio < b) || null;
  let disp = -1;
  if (vMeio) {
    const tit = marcas.filter(([p, k]) => k === "dispositivo" && vMeio[0] <= p && p < vMeio[1]).map(([p]) => p);
    const form = [];
    const seg = tnAll.slice(vMeio[0], vMeio[1]);
    for (const m of seg.matchAll(RE_DISPOSITIVO_VOTO)) {
      const x = vMeio[0] + m.index;
      // o Python busca a fórmula só em [a, b) mas olha o resultado até 400/600 adiante, inclusive além de b
      if (RE_RESULTADO_VOTO.test(tnAll.slice(x, x + 400)) || RE_RESULTADO_TC.test(tnAll.slice(x, x + 600))) form.push(x);
    }
    if (tit.length && (!form.length || tit[tit.length - 1] >= form[form.length - 1] - 3000)) disp = tit[tit.length - 1];
    else if (form.length) disp = form[form.length - 1];
  }
  const cab = blocos.find(([a, b]) => a <= meio && meio < b) || null;
  const pdf0 = Math.min(...[...bruto.matchAll(RE_PAGINA_TC)].map((m) => m.index), ...blocos.map((b) => b[0]), n);
  if (meio < pdf0 && pdf0 < n) return posicaoGenerica(bruto, meio, { ementa: [0, pdf0], tce: true }).replace("ementa", "ementa do cadastro");
  let ementa = null;
  if (blocos.length && acordao > blocos[0][1]) {
    const pe = pos("ementa");
    ementa = [0 <= pe && pe < acordao ? pe : blocos[0][1], acordao];
  }
  let fecho = null;
  if (acordao >= 0) fecho = [acordao, proximo([...blocos.map((b) => b[0]), rel, voto, n].sort((x, y) => x - y), acordao, n)];
  return posicaoGenerica(bruto, meio, { cabecalho: cab, ementa, fecho, relatorio: rs, votos, outros, dispIni: disp >= 0 ? disp : null, tce: true });
}

// ---------------------------------------------------------------- TED-OAB/SP
const RE_FECHO_TED = /Proc(?:esso|\.)?[ \t]*(?:n[º°.]?[ \t]*)?[\dE][\d.\-/E ]{3,40}?[ \t]*[-–,][ \t]*v\.[ \t]*[um]\.[^\n]*/i;
const RE_CAB_TED = new RegExp(`${INI}[ \\t]*(?:[IVX]{1,4}[ \\t]*[.–-][ \\t]*|\\d{1,2}[ \\t]*[.–-][ \\t]*)?(RELAT[ÓO]RIO(?:[ \\t]+E[ \\t]+(?:PARECER|VOTO))?|CONSULTA(?:[ \\t]+E[ \\t]+RELAT[ÓO]RIO)?|PARECER(?:[ \\t]+E[ \\t]+VOTO)?(?:[ \\t]+VENCEDOR)?`
  + `|CONCLUS[ÃA]O(?:[ \\t]+E[ \\t]+VOTO)?|VOTO(?:[ \\t]+(?:DIVERGENTE|CONVERGENTE|VENCIDO|VENCEDOR|DO[ \\t]+REVISOR|DO[ \\t]+RELATOR))?`
  + `|DECLARA[ÇC][ÃA]O[ \\t]+DE[ \\t]+VOTO[^\\n]{0,30})[ \\t]*(?:[-–:.][ \\t]*(?:(?:[A-ZÀ-Ú][a-zà-ú]|[A-ZÀ-Ú][ \\t]+[a-zà-ú]|[1-9“"(])[^\\n]*)?)?${FIM}`, "g");
/** _posicao_ted: ementa → linha do julgamento ("Proc. … – v.u.") → RELATÓRIO/CONSULTA → PARECER/VOTO (CONCLUSÃO = dispositivo) →
 * VOTO DIVERGENTE / declaração de voto. */
export function posicaoTed(texto, meio) {
  const n = texto.length;
  const marcas = [...texto.matchAll(RE_CAB_TED)].map((m) => [m.index, stripPy(norm1(m[1]), WS_PY)]);
  const corpo0 = marcas.length ? marcas[0][0] : n;
  const fm = RE_FECHO_TED.exec(texto.slice(0, corpo0));
  let fecho = null;
  if (fm) {
    const fEnd = fm.index + fm[0].length;
    const fe = texto.indexOf("\n\n", fEnd);
    fecho = [fm.index, 0 <= fe && fe < corpo0 + 1 ? fe : Math.max(fEnd, Math.min(corpo0, n))];
  }
  const ementa = fm ? [0, fm.index] : (corpo0 < n ? [0, corpo0] : null);
  let rel = null, votos = [], outros = [], conclusao = null;
  marcas.forEach(([p, k], i) => {
    const f = i + 1 < marcas.length ? marcas[i + 1][0] : n;
    if (k.startsWith("relatorio") || k.startsWith("consulta")) {
      if (k.includes(" e ") && !k.startsWith("consulta e")) {
        const er = /(?<![a-z0-9])e o (?:breve )?relatorio(?![a-z0-9])/.exec(norm1(texto.slice(p, f)));
        if (er) { rel = rel || [p, p + er.index + er[0].length]; votos.push([p + er.index + er[0].length, f]); return; }
      }
      rel = rel || [p, f];
    } else if (k.includes("divergente") || k.includes("convergente") || k.includes("vencido") || k.startsWith("declaracao") || k.includes("revisor")) {
      outros.push([p, f, "VOTO DIVERGENTE ou CONVERGENTE, ou declaração de voto"]);
    } else if (k.startsWith("conclus") && votos.length) {
      votos[votos.length - 1] = [votos[votos.length - 1][0], f]; if (conclusao === null) conclusao = p;
    } else votos.push([p, f]);
  });
  if (fecho && marcas.length && marcas[0][0] > fecho[1] + 40) votos.unshift([fecho[1], marcas[0][0]]);
  if (!votos.length && rel === null && fecho && fecho[1] < n) votos = [[fecho[1], n]];
  const RE_FIM_REL = /(?<![a-z0-9])(?:e o (?:breve )?relatorio|e o que basta relatar|passo ao parecer|passo a opinar|passo a responder)(?![a-z0-9])/;
  if (rel !== null && !votos.length) {
    const er = RE_FIM_REL.exec(norm1(texto.slice(rel[0], rel[1])));
    if (er) { votos.push([rel[0] + er.index + er[0].length, rel[1]]); rel = [rel[0], rel[0] + er.index + er[0].length]; }
  }
  if (rel === null && votos.length) {
    const [a0, b0] = votos[0];
    const er = /(?<![a-z0-9])(?:e o (?:breve )?relatorio|e o que basta relatar|passo ao parecer|passo a opinar|passo a responder)(?![a-z0-9])/.exec(norm1(texto.slice(a0, b0)));
    if (er) { rel = [a0, a0 + er.index + er[0].length]; votos[0] = [a0 + er.index + er[0].length, b0]; }
  }
  if (fecho && /ementa d[oa] rev\.|vencid[oa] [oa] relator|voto vencedor/.test(norm1(texto.slice(fecho[0], fecho[1]))) && outros.length
    && !marcas.some(([, k]) => k.includes("vencido"))) {
    const v = votos;
    votos = outros.map(([a, b]) => [a, b]); outros = v.map(([a, b]) => [a, b, "parecer do RELATOR VENCIDO"]);
  }
  if (conclusao === null) {
    const v = votos.find(([a, b]) => a <= meio && meio < b) || null;
    if (v) {   // espelho do Python: fórmula com resultado só no último terço do parecer
      const tnAll = norm1(texto), tn = tnAll.slice(0, v[1]), corte = v[0] + Math.floor(((v[1] - v[0]) * 2) / 3);
      const re = new RegExp(RE_DISPOSITIVO_VOTO.source, "g"); re.lastIndex = corte; const forms = [];
      for (let x; (x = re.exec(tn)) !== null;) if (RE_RESULTADO_VOTO.test(tnAll.slice(x.index, x.index + 300))) forms.push(x.index);
      conclusao = forms.length ? forms[forms.length - 1] : -1;
    }
  }
  return posicaoGenerica(texto, meio, { ementa, fecho, relatorio: rel, votos, outros, dispIni: conclusao });
}

// ---------------------------------------------------------------- TNU
const RE_DOC_TNU = new RegExp(`${INI}[ \\t]*(?:Documento:[ \\t]*\\d+|Extrato de Ata)[ \\t]*${FIM}`, "g");
const RE_CAB_TNU_SRC = `${INI}[ \\t]*(RELAT[ÓO]RIO|EMENTA|AC[ÓO]RD[ÃA]O|EXTRATO DE ATA[^\\n]*|VOTO(?:[ \\t-]+[A-ZÀ-Ú]+){0,3})[ \\t]*${FIM}`;
const RE_CAB_TNU = new RegExp(RE_CAB_TNU_SRC, "g");
/** _posicao_tnu: documentos do eproc ("Documento:NNN" + timbre até "RELATOR :"): RELATÓRIO + VOTO; EMENTA + ACÓRDÃO; votos de
 * outros juízes; "Extrato de Ata" (certidão). */
export function posicaoTnu(texto, meio) {
  const n = texto.length;
  const mRel = /RELATOR[A]?[ \t]*:[ \t]*([^\n]+)/.exec(texto);
  const relator = mRel ? (norm1(mRel[1]).match(/[a-z]{3,}/g) || []).filter((w) => !["juiz", "juiza", "federal"].includes(w)) : [];
  const docs = [...texto.matchAll(RE_DOC_TNU)].map((m) => m.index);   // sem "Documento:NNN" não há cabeçalho presumido
  const cabs = [];
  for (const d of docs) {
    const lim = Math.min(n, d + 1500), janela = texto.slice(0, lim);
    const rr = /RELATOR[A]?[ \t]*:[^\n]*\n/g; rr.lastIndex = d; const mr = rr.exec(janela);
    const rc = new RegExp(RE_CAB_TNU_SRC, "g"); rc.lastIndex = d; const mc = rc.exec(janela);
    const fim = Math.min(mr ? mr.index + mr[0].length : n, mc ? mc.index : n, n);
    if (norm1(texto.slice(d, d + 40)).includes("extrato de ata")) continue;
    cabs.push([d, fim]);
  }
  for (const [a, b] of cabs) if (a <= meio && meio < b) return "cabeçalho do documento (timbre do CJF, número, relator) — não é texto decisório";
  const marcas = [...texto.matchAll(RE_CAB_TNU)].map((m) => [m.index, stripPy(norm1(m[1]), WS_PY)]);
  const limites = [...new Set([...cabs.map(([a]) => a), ...marcas.map(([p]) => p), n])].sort((x, y) => x - y);
  const prox = (p) => proximo(limites, p, n);
  // quem venceu: "assinado por FULANO, Relator do Acórdão" ou "nos termos do voto do Juiz Federal FULANO, que lavrará o acórdão"
  const sob = (x) => (norm1(x || "").match(/[a-z]{3,}/g) || []).filter((w) => !["juiz", "juiza", "federal", "relator", "relatora"].includes(w));
  const mVen = /assinado por ([^,\n]{5,90}),[ \t]*Relator[a]? do Ac[óo]rd[ãa]o/.exec(texto)
    || /nos termos do voto d[oa] (?:Ju[íi]z[a]? Federal )?([^,\n]{5,90}),? que lavrar[áa] o ac[óo]rd[ãa]o/i.exec(texto);
  const vencedor = mVen ? sob(mVen[1]) : relator;
  const blocos = docs.length ? docs.map((d, i) => [d, i + 1 < docs.length ? docs[i + 1] : n]) : [[0, n]];
  const autor = (p) => {
    const [a0, b0] = blocos.find(([a, b]) => a <= p && p < b) || [0, n];
    let sig = null;
    for (const m of texto.slice(a0, b0).matchAll(/assinado por ([^,\n]{5,90}),/g)) sig = m;
    return sig ? sob(sig[1]) : [];
  };
  const mesmo = (x, y) => Boolean(x.length && y.length && (x[x.length - 1] === y[y.length - 1] || x.filter((w) => y.includes(w)).length >= 2));
  let ementa = null, fecho = null, rel = null, cert = null;
  const votos = [], outros = [];
  const dentro = (r) => r[0] <= meio && meio < r[1];
  const OUTRO = "VOTO de outro juiz (vista, divergente ou vogal) que não lavrou o acórdão";
  for (const [p, k] of marcas) {
    const r = [p, prox(p)];
    if (k.startsWith("extrato")) cert = cert || [p, n];
    else if (k === "ementa") ementa = ementa && !dentro(r) ? ementa : r;
    else if (k.startsWith("acord")) fecho = fecho && !dentro(r) ? fecho : r;
    else if (k.startsWith("relat")) rel = rel && !dentro(r) ? rel : r;
    else {
      const au = autor(p);
      if (au.length) {
        if (mesmo(au, vencedor)) votos.push(r);
        else if (mesmo(au, relator)) outros.push([r[0], r[1], "VOTO do relator VENCIDO (outro juiz lavrou o acórdão)"]);
        else outros.push([r[0], r[1], OUTRO]);
      } else {
        const ini = norm1(texto.slice(p, p + 200));
        const outro = ["vista", "divergente", "vencido", "vogal"].some((x) => k.includes(x))
          || (relator.length && /juiz[a]? federal/.test(ini) && !ini.includes(relator[relator.length - 1]));
        if (outro) outros.push([r[0], r[1], OUTRO]); else votos.push(r);
      }
    }
  }
  return posicaoGenerica(texto, meio, { ementa, fecho, relatorio: rel, votos, outros, certidao: cert });
}
