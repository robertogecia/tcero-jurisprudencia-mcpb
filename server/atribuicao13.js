// Porte das regras do TJRO v1.13.0 (05/10/2026) — espelho do bloco "porte das regras do TJRO" de servidor_trt14.py:
// ENTRE ASPAS por pareamento (aspa reta orientada, mesma pilha das curvas), NEGAÇÃO por alcance, ALEGAÇÃO DA PARTE por frase.
// As regex do Python são compiladas com re.ASCII; aqui ficam SEM a flag `u`, que no JS dá o mesmo \b e \w ASCII. Onde o
// Python usa \s sobre o texto bruto, vai a classe ASCII explícita (o \s do JS também casaria U+00A0).
// Tudo opera sobre norm1(bruto), que preserva o comprimento: posição i no normalizado = posição i no bruto.

const JS_WS = new Set([..."\t\n\v\f\r       　﻿"]);
for (let c = 0x2000; c < 0x200b; c++) JS_WS.add(String.fromCharCode(c));
const ASPAS_NORM1 = new Set([..."“”‘’\"`´«»"]);
const _cache = new Map();

/** _norm1 */
export function norm1(s) {
  let o = "";
  for (const c of s || "") {
    let d = _cache.get(c);
    if (d === undefined) {
      if (JS_WS.has(c)) d = " ";
      else if (ASPAS_NORM1.has(c)) d = "'";
      else if (c === "–" || c === "—") d = "-";
      else {
        const x = c.normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();
        d = x.length === 1 ? x : x.length ? [...x][0] : " ";
        if (d.length !== c.length) d = d.length > c.length ? " ".repeat(c.length) : d.padEnd(c.length, " ");
      }
      _cache.set(c, d);
    }
    o += d;
  }
  return o;
}

const RE_VERBO_RELATO = new RegExp(
  "(?<![a-z0-9])(?:sustent(?:a|am|ou|aram|ando)|alega(?:m|ram|ndo)?|alegou|aduz(?:em|iu|indo)?|defende(?:m|u|ram|ndo)?|afirma(?:m|ram|ndo)?|afirmou" +
  "|argument(?:a|am|ou|ando)|requer(?:em|eu|eram|endo)?|pleite(?:ia|iam|ou|aram|ando)|pugn(?:a|am|ou|ando)|invoc(?:a|am|ou|ando)" +
  "|insist(?:e|em|iu|indo)|impugn(?:a|am|ou|ando)|assever(?:a|am|ou|ando)|ressalt(?:a|am|ou)|enfatiz(?:a|am|ou)|reiter(?:a|am|ou)" +
  "|postul(?:a|am|ou)|narr(?:a|am|ou)|inform(?:a|am|ou)|disse|suscit(?:a|am|ou)|apont(?:a|am|ou)" +
  "|alegue|alegu?em|sustente|sustentem|defenda|defendam|afirme|argumente|pretend(?:a|e|em|eu)|pretendam|ped(?:e|em|iu|iram|indo)|propugn(?:a|am|ou|ando)|acrescent(?:a|am|ou|ando)|destac(?:a|am|ou|ando)|pondera(?:m|ram|ndo)?|ponderou|anota(?:m|ram|ndo)?|anotou|diz)(?![a-z0-9])", "g");
const RE_PARTE_NO_TEXTO_P = new RegExp(
  "(?<![a-z0-9])(?:apelantes?|apelad[oa]s?|agravantes?|agravad[oa]s?|recorrentes?|recorrid[oa]s?|embargantes?|embargad[oa]s?|autor(?:a|es|as)?|reus?|re|requerentes?|requerid[oa]s?|impetrantes?|impetrad[oa]s?|exequentes?|executad[oa]s?|partes?|banco|instituicao financeira|estado|municipio|uniao|ministerio publico|parquet|defensoria|procuradoria|arguentes?|arguid[oa]s?|reclamantes?|reclamad[oa]s?|seguradora|fundo|cessionari[oa]|devedor[a]?|credor[a]?|locatari[oa]|locador[a]?|consumidor[a]?" +
  "|obreir[oa]s?|empregador(?:a|es|as)?|trabalhador(?:a|es|as)?|sindicato|litisconsortes?|demandad[oa]s?|demandantes?|ente publico|suscitantes?|suscitad[oa]s?|paciente|defesa|fazenda)(?![a-z0-9])");
const RE_SUJEITO_EM_RAZOES = /(?<![a-z0-9])(?:(?:em|nas|suas) (?:suas )?razoes|contrarrazoes)(?![a-z0-9])/;
const RE_VOZ_PROPRIA_P = /\b(?:nesse sentido|neste sentido|com efeito|no caso dos autos|no caso em tela|no caso concreto|in casu|na hipotese dos autos|na especie|entendo|ante o exposto|diante do exposto|pelo exposto|isso posto|e como voto|e o voto|voto por|voto pelo|passo a|compulsando|assim sendo|dessa forma|desta forma|rejeito|nao vejo|submeto aos pares|como se sabe|como foi narrado|nesse contexto)\b|\b[ivx]{1,4}[ \t\n\r\f\v]*[-.)][ \t\n\r\f\v]*d[aeo]s?[ \t\n\r\f\v]+(?:merito|preliminar|recurso|apelacao|dano|pedido)/;
export const RE_VOZ_DO_TRIBUNAL_P = new RegExp(
  "(?<![a-z0-9])(?:contudo|todavia|entretanto|no entanto|ocorre que|porem|de fato|com efeito|sem razao|nao assiste|nao merece|nao prospera|improcede|conheco|constato|constatei|verifico|verifiquei|observo|observei|analisei|tenho que|consigno|cumpre|importante destacar|e importante|e certo|e sabido|como e sabido|ora,|logo,|assim,|portanto|dessa forma|neste caso|nesse caso|nesse cenario|nessa hipotese|no caso|a meu ver|na verdade|diante disso|nessa linha|revela|homologo|condeno|julgo|determino|arbitro|fixo|defiro|indefiro|nego|dou provimento|acolho|rejeito|declaro|reconheco|entendo|concluo|decido|passo a" +
  "|tem-se|tem se|infere-se|conclui-se|depreende-se|extrai-se|verifica- ?se|constata- ?se|nota-se|observa- ?se|percebe-se|denota-se|ve-se|evidencia-se|trata-se" +
  "|nao ha duvidas?|nao resta duvida|nao restam duvidas|compete ao|compete a|cabe ao|cabia ao|incumbe|incumbia|com razao|razao assiste|assiste razao)(?![a-z0-9])");
export const ALEGACAO_CABECA = 0.4;
const ALEGACAO_DIST_MAX = 600, ALEGACAO_SUJEITO_JANELA = 200;
const RE_ABREV = /(?:^|[^a-z0-9])(?:art|arts|n|no|nos|fl|fls|id|ids|des|desa|dr|dra|sr|sra|min|rel|inc|p|pp|pag|proc|cf|num|ex|exmo|exma|res|sum|ed|v|vol|cap|al|rr|c\/c|ss)$/;
const RE_ADVERSATIVA = /(?<![a-z0-9])(?:contudo|todavia|entretanto|no entanto|porem|mas(?! tambem))(?![a-z0-9])/;
const RE_CONCESSIVA = /(?<![a-z0-9])(?:embora|conquanto|ainda que|apesar de|em que pese|nao obstante|a despeito de|malgrado|se bem que)(?![a-z0-9])[^,.;]{0,90}$/;
const RE_ATRIB_EXPLICITA = /(?<![a-z0-9])(?:segundo|conforme|de acordo com|na visao d[eoa]|para)[ \t\n\r\f\v]+(?:[oa]s?[ \t\n\r\f\v]+)?(?:parte[ \t\n\r\f\v]+)?(?:apelantes?|apelad[oa]s?|agravantes?|agravad[oa]s?|recorrentes?|recorrid[oa]s?|embargantes?|embargad[oa]s?|autor(?:a|es|as)?|reus?|requerentes?|requerid[oa]s?|reclamantes?|reclamad[oa]s?|banco|inicial|contestacao)(?![a-z0-9])/;
const RE_QUEBRA_FRASE = /[.;!?]["”’»)\]]?[ \t\n\r\f\v]+(?=["“‘«(\[]?[A-ZÀ-Ý0-9])/g;
const RE_VERBO_NEGADO = /(?:^|[^a-z0-9])(?:nao|nem|jamais|nunca)[ \t\n\r\f\v]+(?:se[ \t\n\r\f\v]+)?$/;
const RE_VERBO_NO_INICIO = /^(?:[ \t\n\r\f\v]*(?:[a-z]+(?: [a-z]+){0,4},[ \t\n\r\f\v]+){0,2}(?:[a-z]+[ \t\n\r\f\v]+){0,2})$/;
const RE_NAO_ANTES = /(?<![a-z0-9])nao(?![a-z0-9])[^.;]{0,70}$/;
const RE_CORTE_SUJEITO = /[,.;]| que /;
const RE_AO_CONTRARIO = /(?:ao contrario|diferentemente|diversamente|contrariamente)[ \t\n\r\f\v]+(?:do|ao)[ \t\n\r\f\v]+que[ \t\n\r\f\v]+(?:[a-z]+[ \t\n\r\f\v]+){0,2}$/;

/** _inicio_da_frase */
export function inicioDaFrase(bruto, tn, piso, p) {
  let ini = piso;
  const seg = bruto.slice(piso, p);
  RE_QUEBRA_FRASE.lastIndex = 0;
  for (let m; (m = RE_QUEBRA_FRASE.exec(seg)); ) {
    if (m[0] === "") { RE_QUEBRA_FRASE.lastIndex++; continue; }
    if (m[0][0] === "." && RE_ABREV.test(tn.slice(Math.max(piso, piso + m.index - 8), piso + m.index))) continue;
    ini = piso + m.index + m[0].length;
  }
  return ini;
}

/** _alegacao_da_parte */
export function alegacaoDaParte(tn, ini0, fim = null, bruto = null) {
  if (fim === null) fim = ini0 + 80;
  const cabeca = ini0 + Math.trunc((fim - ini0) * ALEGACAO_CABECA);
  const piso = Math.max(0, ini0 - ALEGACAO_DIST_MAX);
  const frase0 = inicioDaFrase(bruto || tn, tn, piso, cabeca);
  const ate = frase0 > ini0 ? fim : cabeca;
  const frase = tn.slice(frase0, ate);
  if (RE_ATRIB_EXPLICITA.test(tn.slice(ini0, fim))) return false;
  let fimVerbo = -1, explicitoNoTrecho = false;
  RE_VERBO_RELATO.lastIndex = 0;
  for (let m; (m = RE_VERBO_RELATO.exec(frase)); ) {
    const pos = frase0 + m.index;
    const depois = tn.slice(pos + m[0].length, pos + m[0].length + 45);
    if (depois.startsWith("-se")) continue;
    if (RE_VERBO_NEGADO.test(tn.slice(Math.max(frase0, pos - 12), pos))) continue;
    if (RE_AO_CONTRARIO.test(tn.slice(Math.max(frase0, pos - 30), pos))) continue;
    const antes = tn.slice(Math.max(frase0, pos - ALEGACAO_SUJEITO_JANELA), pos);
    const noInicio = RE_VERBO_NO_INICIO.test(tn.slice(frase0, pos));
    const sujeito = RE_PARTE_NO_TEXTO_P.test(antes) || RE_SUJEITO_EM_RAZOES.test(antes) ||
      RE_PARTE_NO_TEXTO_P.test(depois.slice(0, 40).split(RE_CORTE_SUJEITO)[0]);
    if (m[0] === "diz" ? !noInicio : (!sujeito && !noInicio)) continue;
    fimVerbo = pos + m[0].length;
    explicitoNoTrecho = pos >= ini0 && RE_PARTE_NO_TEXTO_P.test(tn.slice(ini0, pos));
  }
  if (fimVerbo < 0 || explicitoNoTrecho) return false;
  const entre = tn.slice(fimVerbo, Math.max(fimVerbo, cabeca));
  if (RE_VOZ_PROPRIA_P.test(entre) || RE_VOZ_DO_TRIBUNAL_P.test(entre)) return false;
  const adv = RE_ADVERSATIVA.exec(entre);
  if (adv && !(adv[0] === "mas" && RE_NAO_ANTES.test(entre.slice(0, adv.index)))) return false;
  if (RE_CONCESSIVA.test(tn.slice(frase0, fimVerbo)) && tn.slice(fimVerbo, ini0).includes(",")) return false;
  return true;
}

const RE_NEG_OPERADOR = /(?<![a-z0-9])(?:nao|jamais|nunca|nem|descabe|descabid[oa]s?|incabive(?:l|is)|afasta-se|afasto|afastad[oa]s?|rejeita-se|rejeito|rejeitad[oa]s?|nego|negou|negar|nega-se|negam|improcede|julg(?:ou|o|ar|aram|ada|ado|ados|adas)[ \t\n\r\f\v]+improcedentes?|inexist(?:e|em|ir|iu|indo)|carece|carecem|impossibilidade de|sem razao|sem razoes)(?![a-z0-9])/g;
const RE_NEG_FALSA = /^[ \t\n\r\f\v]*(?:obstante|so\b|apenas|somente|se[ \t\n\r\f\v]+confunde|fosse\b|(?:havendo|ha|houve|resta|restam|restando|pairam?)[ \t\n\r\f\v]+(?:qualquer[ \t\n\r\f\v]+|mais[ \t\n\r\f\v]+)?duvidas?)/;
const RE_QUEBRA_ORACAO = /[.;:]|,[ \t\n\r\f\v]*(?:mas|e|ou|que|o que|de forma|de modo|sendo|alem|conforme|porque|pois|porquanto|embora|ainda|razao pela|motivo pelo|[a-z]+ndo)(?![a-z0-9])|[ \t\n\r\f\v]mas[ \t\n\r\f\v]/;
const NEGACAO_JANELA = 80, NEGACAO_ALCANCE_MIN = 3;
const tiraEspacos = (s) => s.replace(/^ +| +$/g, "");

/** _negacao_escopo */
export function negacaoEscopo(tn, ini0, fim, bruto = null) {
  const jan = tn.slice(Math.max(0, ini0 - NEGACAO_JANELA), ini0);
  let op = null;
  RE_NEG_OPERADOR.lastIndex = 0;
  for (let m; (m = RE_NEG_OPERADOR.exec(jan)); ) {
    if (m[0] === "nao" && RE_NEG_FALSA.test(jan.slice(m.index + 3))) continue;
    op = m;
  }
  if (op === null) return false;
  const ponte = jan.slice(op.index + op[0].length);
  if (/[.;:]/.test(ponte)) return false;
  if (ponte.includes(",") && tiraEspacos(ponte).length > 15) return false;
  const tr = tn.slice(ini0, fim);
  if (/^[ \t\n\r\f\v]*[eE][ \t\n\r\f\v,]/.test(bruto !== null ? bruto.slice(ini0, fim) : tr)) return false;
  const q = RE_QUEBRA_ORACAO.exec(tr);
  const seg = q === null ? tr : tr.slice(0, q.index);
  return tiraEspacos(seg).split(" ").filter(Boolean).length >= NEGACAO_ALCANCE_MIN;
}

const ASPAS_SPAN_MAX = 6000;
const ABRE_RETA = new Set([..." \t\n\r ([{—–-:/"]);
const FECHA_RETA = new Set([..." \t\n\r .,;:)]}!?—–-/"]);

/** _trechos_citados — posições em unidades UTF-16, as mesmas de norm1(bruto) (aspas são todas do plano básico) */
export function trechosCitados(bruto) {
  const cs = bruto;
  const out = [], duplas = [], simples = [], angulares = [];
  const n = cs.length;
  const fecha = (pilha, i) => {
    if (pilha.length && i - pilha[pilha.length - 1] > ASPAS_SPAN_MAX) pilha.length = 0;
    if (pilha.length) out.push([pilha.pop(), i + 1]);
  };
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    if (c === "“") duplas.push(i);
    else if (c === "”") fecha(duplas, i);
    else if (c === '"') {
      const ant = i ? cs[i - 1] : " ";
      const prox = i + 1 < n ? cs[i + 1] : " ";
      const abre = ABRE_RETA.has(ant) && !FECHA_RETA.has(prox);
      const fech = !ABRE_RETA.has(ant) && FECHA_RETA.has(prox);
      if (abre || (!fech && !duplas.length)) duplas.push(i);
      else if (duplas.length) fecha(duplas, i);
    } else if (c === "‘") simples.push(i);
    else if (c === "’") { if (simples.length) fecha(simples, i); }
    else if (c === "«") angulares.push(i);
    else if (c === "»") fecha(angulares, i);
  }
  return out;
}

/** _cobertura_citada */
export function coberturaCitada(cit, ini, fim) {
  const pedacos = cit.filter(([x, y]) => Math.min(y, fim) > Math.max(x, ini)).map(([x, y]) => [Math.max(x, ini), Math.min(y, fim)])
    .sort((a, b) => a[0] - b[0]);
  let total = 0, ate = ini;
  for (const [x, y] of pedacos) {
    if (y <= ate) continue;
    total += y - Math.max(x, ate);
    ate = y;
  }
  return total;
}

const RE_TESE_PROPRIA = /\btese[ \t\n\r\f\v]+(?:juridica[ \t\n\r\f\v]+)?(?:fixada|firmada|proposta)\b|\bfixando a seguinte tese\b|\bseguinte tese\b/;

/** _entre_aspas */
export function entreAspas(bruto, tn, ini0, fim, cit = null) {
  cit = cit === null ? trechosCitados(bruto) : cit;
  const dentro = coberturaCitada(cit, ini0, fim);
  const abre = cit.find((c) => c[0] <= ini0 + (fim - ini0) / 2 && c[1] >= ini0);
  return dentro * 2 > fim - ini0 && !(abre && RE_TESE_PROPRIA.test(tn.slice(Math.max(0, abre[0] - 80), abre[0])));
}

// OBITER DICTUM? (espelho do TJRO 1.15.0 / _obiter_antes): marca contrafactual ou de fundamento alternativo na MESMA frase do trecho
export const RE_OBITER = /(?<![a-z0-9])(?:ainda que assim nao fosse|se assim nao fosse|(?:ainda|mesmo) que (?:se )?(?:admitisse(?:mos)?|superad[ao]s?|ultrapassad[ao]s?|afastad[ao]s?|entendesse(?:mos)?|considerasse(?:mos)?|fosse|houvesse|pudesse)|a titulo de (?:argumentacao|reforco|ilustracao|obiter dictum)|(?:apenas|somente|so) para argumentar|ad argumentandum(?: tantum)?|por amor ao debate|obiter dictum|caso se entendesse)(?![a-z0-9])/g;
export const OBITER_JANELA = 400, OBITER_CABECA = 0.4;
export function obiterAntes(tn, ini0, fim, bruto) {
  const cabeca = ini0 + Math.trunc((fim - ini0) * OBITER_CABECA);
  const piso = Math.max(0, ini0 - OBITER_JANELA);
  const frase0 = inicioDaFrase(bruto, tn, piso, cabeca);
  let m = null;
  for (const x of tn.slice(frase0, cabeca).matchAll(RE_OBITER)) m = x;
  return m ? m[0] : null;
}

/** _trechos_obiter (recibo, 06/10/2026): da marca de obiter ao fim da frase, em BRUTO, fora de citação entre aspas. */
export function trechosObiter(texto, ini = 0, fim = null) {
  fim = fim === null ? texto.length : fim;
  const nt = norm1(texto);
  const cit = trechosCitados(texto).filter(([a, b]) => b > ini && a < fim);
  const out = [];
  let ate = -1;
  const re = new RegExp(RE_OBITER.source, "g");
  re.lastIndex = ini;
  for (let m; (m = re.exec(nt)) && m.index < fim;) {
    if (m.index < ate || cit.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const fimM = m.index + m[0].length;
    let b = Math.min(fim, m.index + 600);
    const rf = /[.;!?]["”’)\]]?[ \t\n\r\f\v]+(?=["“‘(\[]?[A-ZÀ-Ý0-9])/g;
    const seg = texto.slice(fimM, b);
    for (let f; (f = rf.exec(seg));) {
      const p = fimM + f.index;
      if (f[0][0] === "." && /(?:^|[^a-z0-9])(?:art|arts|n|no|nos|fl|fls|id|ids|des|dr|min|rel|inc|p|pp|proc|cf|res|sum|v|vol|al|ss)$/.test(nt.slice(Math.max(0, p - 8), p))) continue;
      b = p + 1; break;
    }
    out.push(texto.slice(m.index, b));
    ate = b;
  }
  return out;
}
