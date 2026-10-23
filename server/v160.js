// v1.6.0 (15/10/2026) — porte Node das ideias do TJRO v1.25-v1.34 que o servidor Python (servidor_tcero.py, v1.6.0,
// commit 4f8fbf7) trouxe para o TCE-RO: buscar_recibos_tcero · diário de erros + diagnostico_erros_tcero ·
// linha_do_tempo_tcero · sugerir_termos_tcero · modo triagem de obter_acordao_tcero.
//
// Só funções PURAS (texto → texto) e as que tocam disco local (recibos, diário). Nada aqui faz rede: a rede
// (consulta ao portal, download de PDF) fica em index.js. As FRASES de saída são as do Python, uma a uma:
// mudar uma aqui é mudar lá (test/paridade.py compara).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.js";
import { norm1, inicioDaFrase, RE_OBITER, OBITER_JANELA } from "./atribuicao13.js";
import { posicaoTcero, RE_CAB_TC, RE_PAGINA_TC, linhasConselheiroTc } from "./posicao2.js";

const RE_ESPACOS_PY = /[ \t\n\r\f\v]+/g;
const colapsa = (t) => String(t).replace(RE_ESPACOS_PY, " ");
const stripPy = (s, chars) => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** json.dumps(obj, ensure_ascii=False) do Python: separadores ", " e ": " (só para a saída de texto; o arquivo usa JSON.stringify). */
export function jsonPy(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(jsonPy).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + jsonPy(x)).join(", ") + "}";
  return JSON.stringify(v);
}

// --------------------------------------------------------------------------- //
// Diário de erros                                                              //
// --------------------------------------------------------------------------- //
export const MAX_LINHAS_ERROS = 500;
export const MAX_BYTES_ERROS = 400_000;

/** Pasta de estado do usuário: `TCERO_MCP_DIR_ESTADO` se existir; senão `~/.tcero-jurisprudencia`. */
export const dirEstado = () => process.env.TCERO_MCP_DIR_ESTADO || path.join(os.homedir(), ".tcero-jurisprudencia");
export const arquivoErros = () => path.join(dirEstado(), "erros.jsonl");

const RE_SEGREDO_ROTULO_ERRO = /\b(bearer|token|authorization|api[_-]?key|senha|password)\b[\s:=]+\S+/gi;
const RE_SEGREDO_TOKEN_ERRO = /\b(?:ghp|gho|ghs|github_pat|sk|xox[bp])[-_][A-Za-z0-9_-]{10,}/g;
const RE_DOC_ERRO = /\b\d[\d.\-/]{6,}\d\b/g; // CNJ, CPF, CNPJ (e datas: preço aceito)
const RE_ENUM_ERRO = /^[a-z_]{1,20}$/;
const RE_URL_ERRO = /https?:\/\/[^\s)"'<>]+/g;
const RE_ASPAS_ERRO = /["“”«»][^"“”«»]{3,}["“”«»]|'[^']{3,}'/g;
const RE_NUM_BARRA_ERRO = /\b\d{1,9}\/\d{2,4}\b/g;
const RE_NUM_LONGO_ERRO = /\b\d{5,}\b/g;
const RE_EMAIL_ERRO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** URL sem consulta nem fragmento e sem segmento longo de caminho (o hash de AbrirPdfConvidado identifica o acórdão lido). */
function urlParaErro(m) {
  const u = m.split("?")[0].split("#")[0].replace(/^(https?:\/\/)[^/@\s]*@/, "$1");
  return u.split("/").map((p, i) => (i >= 3 && p.length >= 16 ? "<id>" : p)).join("/");
}

/** Mensagem curta SEM dado do caso: URL só com origem e caminho curto; trecho entre aspas vira «…»; número de
 * processo/acórdão (NNNNN/AA), ids longos e e-mails somem. O texto da busca do usuário nunca é argumento. */
export function sanitizarErro(texto, maximo = 300) {
  let t = String(texto !== null && texto !== undefined ? texto : "");
  t = t.replace(RE_SEGREDO_ROTULO_ERRO, (_m, r) => `${r} <segredo>`);
  t = t.replace(RE_SEGREDO_TOKEN_ERRO, "<segredo>");
  t = t.replace(RE_URL_ERRO, urlParaErro);
  t = t.replace(RE_ASPAS_ERRO, "«…»");
  t = t.replace(RE_EMAIL_ERRO, "<email>");
  t = t.replace(RE_DOC_ERRO, "<nº>");
  t = t.replace(RE_NUM_BARRA_ERRO, "<nº>");
  t = t.replace(RE_NUM_LONGO_ERRO, "<nº>");
  return colapsa(t).trim().slice(0, maximo);
}

const ARGS_SEGUROS_ERRO = new Set(["modo", "ordenar", "pagina", "por_pagina", "limite", "ano_inicio", "ano_fim", "ler_inteiro_teor", "detalhar", "dias", "relatorio"]);

function nomeTipoPy(v) {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** Parâmetros SEM conteúdo: presença/tamanho; valor só para enumerações e números seguros. */
export function descreverArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (ARGS_SEGUROS_ERRO.has(k) && (typeof v === "boolean" || typeof v === "number")) out[k] = v;
    else if (ARGS_SEGUROS_ERRO.has(k) && typeof v === "string") out[k] = RE_ENUM_ERRO.test(v) ? v : `<texto: ${[...v].length} car.>`;
    else if (Array.isArray(v)) {
      out[k] = Array.isArray(v[0])
        ? `${v.length} grupo(s), ${v.filter((g) => Array.isArray(g)).reduce((a, g) => a + g.length, 0)} termo(s)`
        : `${v.length} item(ns)`;
    } else if (typeof v === "string") out[k] = `<texto: ${[...v].length} car.>`;
    else out[k] = nomeTipoPy(v);
  }
  return out;
}

/** Tipo do erro para o diário: os de PDF e de formato primeiro, depois os de rede/portal que a extensão já classificava. */
export function tipoDoErroDiario(mensagem) {
  const m = String(mensagem || "");
  if (/PDF sem texto extra[ií]vel/.test(m)) return "pdf_sem_texto";
  if (/EXTRA[ÇC][ÃA]O PARCIAL/.test(m)) return "pdf_parcial";
  if (/LEITURA DE PDF N[ÃA]O REALIZADA/.test(m)) return "pdf_falha";
  if (/formato inesperado|n[ãa]o [eé] JSON v[aá]lido|n[ãa]o devolveu uma lista|mudado de layout/i.test(m)) return "formato_inesperado";
  if (/n[ãa]o instalado/.test(m)) return "dependencia_ausente";
  if (/\b(?:ReadTimeout|WriteTimeout|PoolTimeout|TimeoutError)\b/.test(m)) return "timeout";
  return L.tipoDoErro(m);
}

const RE_FALHA_NA_SAIDA = /\[(?:LEITURA DE PDF|PESQUISA|BUSCA LOCAL) N[ÃA]O REALIZADA|\[PESQUISA INCOMPLETA/;
const RE_PARCIAL_NA_SAIDA = /\[VERIFICA[ÇC][ÃA]O N[ÃA]O REALIZADA\]|\[EXTRA[ÇC][ÃA]O PARCIAL|PDF sem texto extra[ií]vel/;

/** Reconhece, no TEXTO que a ferramenta devolveu, uma falha ("falha") ou uma limitação parcial ("parcial"). Erro de validação de
 * entrada do usuário (sem rodapé de portal) não é falha de ferramenta. */
export function falhaNaSaida(texto) {
  const t = String(texto || "");
  if (RE_FALHA_NA_SAIDA.test(t)) return "falha";
  if (t.startsWith("Erro ") && (t.includes("\nVersão: ") || t.startsWith("Erro ao consultar o portal do TCE-RO ("))) return "falha";
  if (RE_PARCIAL_NA_SAIDA.test(t)) return "parcial";
  return null;
}

/** A linha curta que descreve a falha dentro de uma saída maior (sem o rodapé de versão/relato). */
export function linhaDaFalha(texto) {
  const t = String(texto || "").split("\n\nVersão:")[0];
  for (const padrao of [RE_FALHA_NA_SAIDA, RE_PARCIAL_NA_SAIDA]) {
    const m = padrao.exec(t);
    if (m) {
      const ini = t.lastIndexOf("\n", m.index - 1) + 1;
      const fim = t.indexOf("\n", m.index);
      return t.slice(ini, fim >= 0 ? fim : t.length);
    }
  }
  return t.split("\n")[0];
}

const isoSegundosUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** Anota UMA linha em `erros.jsonl` — só dado técnico. NUNCA o texto da busca nem trecho citado. Jamais lança. `agora` em ms. */
export function registrarErro(ferramenta, { erro = null, texto = null, args = null, ms = null, parcial = false, agora = null } = {}) {
  try {
    const msg = erro !== null && erro !== undefined ? `${erro?.constructor?.name || "Error"}: ${erro?.message ?? erro}` : linhaDaFalha(texto || "");
    const tipo = tipoDoErroDiario(msg);
    if (L.SEM_RELATO_TIPOS.has(tipo)) return null; // limitador auto-imposto: o usuário resolve esperando
    agora = agora === null ? Date.now() : agora;
    let limitador;
    try {
      limitador = L.estadoLimitadorResumo(agora);
    } catch {
      limitador = "indisponível";
    }
    const mh = /.*?\bHTTP (\d{3})\b/s.exec(msg);
    const entrada = {
      quando: isoSegundosUtc(agora),
      versao: L.VERSAO,
      sistema: `${os.type()} ${os.release()} node ${process.versions.node}`,
      ferramenta,
      tipo,
      http: mh ? mh[1] : null,
      parcial: Boolean(parcial),
      ms,
      args: descreverArgs(args),
      limitador,
      mensagem: sanitizarErro(msg),
    };
    const caminho = arquivoErros();
    fs.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(caminho, "a", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(entrada) + "\n");
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.statSync(caminho).size > MAX_BYTES_ERROS) {
        const linhas = fs.readFileSync(caminho, "utf-8").split("\n").filter(Boolean);
        const tmp = `${caminho}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, linhas.slice(-MAX_LINHAS_ERROS).join("\n") + "\n", { mode: 0o600 });
        fs.renameSync(tmp, caminho);
      }
    } catch {
      /* poda é só conforto */
    }
    return entrada;
  } catch {
    return null;
  }
}

/** Aguarda a ferramenta (`fn` devolve uma Promise); anota exceção ou marcador de falha/parcial na saída. Nunca altera o resultado. */
export async function comDiario(ferramenta, args, fn) {
  const t0 = Date.now();
  let r;
  try {
    r = await fn();
  } catch (e) {
    registrarErro(ferramenta, { erro: e, args, ms: Date.now() - t0 });
    throw e;
  }
  try {
    const marca = falhaNaSaida(r);
    if (marca) registrarErro(ferramenta, { texto: r, args, ms: Date.now() - t0, parcial: marca === "parcial" });
  } catch {
    /* o diário não quebra a ferramenta */
  }
  return r;
}

export function lerErros(dias = 30, agora = null) {
  agora = agora === null ? Date.now() : agora;
  const corte = agora - Math.max(1, Math.trunc(Number(dias))) * 86400_000;
  const saida = [];
  let bruto;
  try {
    bruto = fs.readFileSync(arquivoErros(), "utf-8");
  } catch {
    return [];
  }
  for (let ln of bruto.split("\n")) {
    ln = ln.trim();
    if (!ln) continue;
    try {
      const e = JSON.parse(ln);
      if (Date.parse(e.quando) >= corte) saida.push(e);
    } catch {
      continue;
    }
  }
  return saida;
}

// causa provável, ação e quem corrige ("autor" = só o desenvolvedor; "usuario" = esperar/ajustar; "portal" = fora do controle)
const CAUSAS_ERRO = {
  timeout: ["O portal ou o host do PDF demorou mais que o tempo limite (resposta de até ~20 MB).",
    "Repita com filtros mais estreitos (relator, órgão, número) ou mais tarde.", "portal"],
  rede_ou_certificado: ["Falha de rede, DNS ou certificado.",
    "Confira a conexão/VPN/proxy. Se só esta extensão falha, relate.", "usuario"],
  pdf_falha: ["O PDF do inteiro teor não pôde ser baixado ou lido.",
    "Abra o link do PDF no navegador; repita mais tarde. Se repetir com vários acórdãos, relate.", "portal"],
  pdf_sem_texto: ["PDF digitalizado (sem camada de texto); a extensão não faz OCR.",
    "Leia o PDF no navegador. Não é defeito da extensão.", "portal"],
  pdf_parcial: ["Extração do PDF parou num teto (páginas/tempo) ou o PDF é misto.",
    "O texto lido é citável, mas não prova que algo NÃO consta do acórdão; abra o PDF.", "portal"],
  formato_inesperado: ["O portal devolveu uma resposta em formato que a extensão não conhece.",
    "Provável mudança no portal: relate com o relatório abaixo.", "autor"],
  dependencia_ausente: ["Pacote Python necessário não está instalado.",
    "Reinstale as dependências (README, seção do Python).", "usuario"],
  outro: ["Erro não classificado.", "É o mais útil para o autor: envie o relatório abaixo.", "autor"],
};

export function causaDe(tipo) {
  if (Object.hasOwn(CAUSAS_ERRO, tipo)) return CAUSAS_ERRO[tipo];
  if (tipo.startsWith("http_5"))
    return ["O portal respondeu erro de servidor.", "Repita depois; se só acontece com certos filtros, pode ser consulta mal formada (relate).", "portal"];
  if (tipo === "http_403" || tipo === "http_429")
    return ["O portal recusou ou limitou a requisição.", "Espere; veja diagnostico_ritmo_tcero. Nunca contorne pelo navegador.", "portal"];
  if (tipo.startsWith("http_4")) return ["O portal recusou a requisição (4xx).", "Provável consulta mal formada: relate.", "autor"];
  return CAUSAS_ERRO.outro;
}

const pad2 = (n) => String(n).padStart(2, "0");
export function fmtDataErro(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Resumo por tipo e ferramenta, com período, versões, causa provável e o link de issue pré-preenchido (só dado técnico). */
export function resumirErros(entradas, dias = 30, relatorio = false, limite = 15) {
  if (!entradas.length) {
    return (
      `Nenhum erro registrado nos últimos ${dias} dia(s). O diário só anota falhas das ferramentas ` +
      "(rede, portal, PDF, formato), com dado técnico; nunca o que foi pesquisado nem trecho citado. " +
      `Arquivo: ${arquivoErros()}`
    );
  }
  const grupos = new Map();
  for (const e of entradas) {
    const k = [e.tipo || "outro", e.ferramenta || "?"];
    const chave = JSON.stringify(k);
    if (!grupos.has(chave)) grupos.set(chave, { tipo: k[0], ferramenta: k[1], n: 0, parciais: 0, primeiro: e.quando, ultimo: e.quando, versoes: new Set(), amostra: e });
    const g = grupos.get(chave);
    g.n += 1;
    g.parciais += e.parcial ? 1 : 0;
    if (e.quando < g.primeiro) g.primeiro = e.quando;
    if (e.quando >= g.ultimo) {
      g.ultimo = e.quando;
      g.amostra = e;
    }
    g.versoes.add(e.versao || "?");
  }
  const lista = [...grupos.values()].sort((a, b) => b.n - a.n || cmpStr(a.tipo, b.tipo) || cmpStr(a.ferramenta, b.ferramenta));
  const quandos = entradas.map((e) => e.quando);
  const minQ = quandos.reduce((a, b) => (b < a ? b : a));
  const maxQ = quandos.reduce((a, b) => (b > a ? b : a));
  const out = [
    `**Diário de erros** — ${entradas.length} registro(s) em ${lista.length} padrão(ões), últimos ${dias} dia(s), ` +
      `de ${fmtDataErro(minQ)} a ${fmtDataErro(maxQ)}. Arquivo: ${arquivoErros()}`,
    "",
  ];
  for (const g of lista.slice(0, Math.max(1, limite))) {
    const [causa, acao, quem] = causaDe(g.tipo);
    const a = g.amostra;
    out.push(
      `- **${g.tipo}** em \`${g.ferramenta}\` · ${g.n}× (${g.parciais} parcial) · de ${fmtDataErro(g.primeiro)} ` +
        `a ${fmtDataErro(g.ultimo)} · v${[...g.versoes].sort(cmpStr).join(", v")}\n` +
        `  Causa provável: ${causa} Ação: ${acao} _(quem corrige: ${quem})_\n` +
        `  Última mensagem: ${a.mensagem}` + (a.http ? ` (HTTP ${a.http})` : "") +
        ` · parâmetros: ${jsonPy(a.args || {})}`
    );
  }
  const autor = lista.filter((g) => causaDe(g.tipo)[2] === "autor").reduce((acc, g) => acc + g.n, 0);
  out.push("");
  out.push(
    autor
      ? `⚠️ ${autor} registro(s) são de causa que o AUTOR pode corrigir: rode \`diagnostico_erros_tcero(relatorio=true)\` e entregue o relatório.`
      : "Nenhum registro de causa corrigível pelo autor neste período (o resto vem do portal, da rede ou do ritmo)."
  );
  const alvo = lista.find((g) => !L.SEM_RELATO_TIPOS.has(g.tipo));
  if (alvo) {
    out.push(`Relatar o problema (formulário já preenchido só com versão, sistema, tipo e estado do limitador; revise antes de enviar): ${L.linkRelato(alvo.tipo)}`);
  }
  if (relatorio) {
    const ult = entradas.slice(-20);
    out.push("");
    out.push("**Relatório técnico para análise** (sem texto de busca, números, segredos, URLs e trechos entre aspas mascarados; nomes soltos na mensagem não são detectados, confira antes de colar em issue pública)");
    out.push(`- Versão: ${L.VERSAO} · Sistema: ${os.type()} ${os.release()} · Node ${process.versions.node}`);
    out.push(`- Registros: ${entradas.length} (últimos ${ult.length} abaixo)`);
    out.push("");
    out.push("| Quando | Ferramenta | Tipo | ms | Limitador | Mensagem | Parâmetros |");
    out.push("|---|---|---|---|---|---|---|");
    for (const e of ult) {
      out.push(
        "| " +
          [
            fmtDataErro(e.quando || ""),
            String(e.ferramenta),
            `${e.tipo}${e.http ? " (" + e.http + ")" : ""}${e.parcial ? " parcial" : ""}`,
            String(e.ms !== null && e.ms !== undefined ? e.ms : ""),
            String(e.limitador || ""),
            String(e.mensagem || "").replaceAll("|", "/"),
            jsonPy(e.args || {}).replaceAll("|", "/"),
          ].join(" | ") +
          " |"
      );
    }
    out.push(`\nAbrir issue: ${L.ISSUES_NOVA}`);
  }
  return out.join("\n");
}

export function diagnosticoErros(dias = 30, relatorio = false, agora = null) {
  const invalido = "dias inválido: informe um número inteiro de 1 a 365.";
  let n;
  if (typeof dias === "number" && Number.isFinite(dias)) n = Math.trunc(dias);
  else if (typeof dias === "string" && /^\s*[+-]?\d+\s*$/.test(dias)) n = parseInt(dias, 10);
  else return invalido;
  if (!(n >= 1 && n <= 365)) return invalido;
  return resumirErros(lerErros(n, agora), n, Boolean(relatorio));
}

// --------------------------------------------------------------------------- //
// buscar_recibos_tcero: busca SEM REDE nos recibos locais                       //
// --------------------------------------------------------------------------- //
export const RECIBOS_LIMITE_MAX = 20;
const MEMO_RECIBOS = new Map();
export const limparMemoRecibos = () => MEMO_RECIBOS.clear();

/** Mesma conferência de `lerReciboTcero` (sha256 do `texto` e, se existir, `sha256_campos`), mas sobre um objeto já lido. */
export function reciboIntegro(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados) || typeof dados.texto !== "string" || !dados.texto) return false;
  if (!L.RE_ID_DECISAO_SEGURO.test(String(dados.id_documento || ""))) return false;
  if (dados.sha256 !== L.sha256Texto(dados.texto)) return false;
  if ("sha256_campos" in dados && dados.sha256_campos !== L.sha256CamposRecibo(dados)) return false;
  return true;
}

/** Todos os recibos íntegros da pasta, com o texto já normalizado como o verificador normaliza, e quantos arquivos foram ignorados. */
export function listarRecibosTcero(pasta = null) {
  pasta = pasta || L.DIR_RECIBOS;
  let nomes;
  try {
    nomes = fs.readdirSync(pasta).filter((n) => /^\d+\.json$/.test(n)).sort();
  } catch {
    return [[], 0];
  }
  const out = [];
  let ignorados = 0;
  for (const n of nomes) {
    const cam = path.join(pasta, n);
    let mt;
    try {
      mt = fs.statSync(cam).mtimeMs;
    } catch {
      continue;
    }
    let memo = MEMO_RECIBOS.get(cam);
    if (!memo || memo[0] !== mt) {
      const dados = L.lerJsonGenerico(cam);
      const item = reciboIntegro(dados) ? { r: dados, tn: L.normalizarCasamento(dados.texto) } : null;
      memo = [mt, item];
      MEMO_RECIBOS.set(cam, memo);
    }
    if (memo[1] === null) ignorados += 1;
    else out.push(memo[1]);
  }
  out.sort((a, b) => cmpStr(String(b.r.data_sessao || ""), String(a.r.data_sessao || "")));
  return [out, ignorados];
}

const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex de PALAVRA INTEIRA sobre texto de `normalizarCasamento`: o termo passa pela mesma normalização do verificador; espaço = frase
 * em ordem; `*` no fim = prefixo ("multa*" pega "multas"). Sem a flag `g` (use `contar` para contar). */
export function regexTermoRecibo(termo) {
  const t = String(termo || "");
  const prefixo = t.trim().endsWith("*");
  const palavras = L.normalizarCasamento(t.replaceAll("*", " ")).split(/[\s']+/).filter(Boolean);
  if (!palavras.length) return null;
  const corpo = palavras.map(escRe).join("[\\s']+");
  return new RegExp("(?<![\\p{L}\\p{N}_])'?" + corpo + (prefixo ? "[\\p{L}\\p{N}_]*" : "") + "(?![\\p{L}\\p{N}_])", "u");
}
const contar = (re, tn) => [...tn.matchAll(new RegExp(re.source, re.flags + "g"))].length;

const RE_PONTA_NAO_PALAVRA_U = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;

/** `"frase exata"` vira um termo; palavras soltas viram um termo cada (todas exigidas), sem palavras vazias (de, do, a...). */
export function termosDaConsultaRecibos(consulta) {
  consulta = consulta || "";
  const termos = [...consulta.matchAll(L.RE_FRASE_ASPAS)].map((m) => m[1].replace(L.RE_ESPACO, " ").trim());
  const resto = consulta.replace(L.RE_FRASE_ASPAS, " ");
  for (let p of resto.trim().split(L.RE_ESPACO)) {
    const semAsterisco = p.replace(/\*+$/, "");
    p = semAsterisco.replace(RE_PONTA_NAO_PALAVRA_U, "") + (p.endsWith("*") ? "*" : "");
    const f = L.fold(p.replace(/\*+$/, ""));
    if (f.length < 2 || L.PALAVRAS_VAZIAS_RELEVANCIA.has(f)) continue;
    termos.push(p);
  }
  const vistos = new Set();
  return termos.filter((t) => {
    const f = L.fold(t);
    if (vistos.has(f)) return false;
    vistos.add(f);
    return true;
  });
}

/** O que o recibo SABE sobre o PDF: `texto_pdf_completo` null = PDF não lido; true = extraído por inteiro; false = lido em parte. */
export function verificacaoGravada(r) {
  const c = r.texto_pdf_completo;
  if (c === null || c === undefined) return "só ementa + dispositivo do cadastro (PDF não lido)";
  if (c === true) return "inteiro teor lido (PDF), extração completa — o recibo não registra PDF misto (parte digitalizada)";
  return "inteiro teor lido em parte (PDF) — extração parou num teto ou PDF sem texto: não prova que algo NÃO consta";
}

/** Busca local, ZERO requisição. Procura na ementa, no dispositivo e no texto do PDF gravados no recibo (campo `texto`); NUNCA no texto
 * de IA do DEJUR. Palavra inteira, mesma normalização do verificador; todas as palavras de `consulta` e todos os `grupos` (OU dentro do
 * grupo, E entre grupos) são exigidos. */
export function buscarRecibos(consulta, grupos, relator, orgao, limite = 10, pasta = null) {
  const termos = termosDaConsultaRecibos(consulta || "");
  let gs = L.gruposValidos(grupos).map((g) => g.filter((t) => regexTermoRecibo(t)));
  gs = gs.filter((g) => g.length);
  const relF = L.fold(L.texto(relator));
  const orgTxt = L.texto(orgao);
  if (!termos.length && !gs.length && !relF && !orgTxt) {
    return (
      'BUSCA LOCAL NÃO REALIZADA — informe `consulta` (palavras ou "frase exata"), `grupos` ' + "(sinônimos), `relator` ou `orgao`."
    );
  }
  let lim = parseInt(limite || 10, 10);
  lim = Number.isFinite(lim) ? Math.max(1, Math.min(lim, RECIBOS_LIMITE_MAX)) : 10;
  let nomeOrgao = null;
  let avisoOrgao = null;
  if (orgTxt) [nomeOrgao, avisoOrgao] = L.resolverOrgao(orgTxt);
  const [todos, ignorados] = listarRecibosTcero(pasta);
  const totalGeral = todos.length;
  const comPdf = todos.filter((it) => it.r.texto_pdf_completo !== null && it.r.texto_pdf_completo !== undefined).length;
  let cand = todos;
  if (relF) cand = cand.filter((it) => L.fold(String(it.r.relator || "")).includes(relF));
  if (nomeOrgao) {
    const alvoO = L.fold(nomeOrgao);
    cand = cand.filter((it) => L.fold(String(it.r.orgao_cadastro || "")) === alvoO);
  }
  const resT = termos.map((t) => [t, regexTermoRecibo(t)]).filter(([, re]) => re);
  const resG = gs.map((g) => g.map((t) => [t, regexTermoRecibo(t)]));
  const achados = [];
  for (const it of cand) {
    const tn = it.tn;
    if (!resT.every(([, re]) => re.test(tn))) continue;
    if (!resG.every((g) => g.some(([, re]) => re.test(tn)))) continue;
    const soma = resT.reduce((a, [, re]) => a + contar(re, tn), 0) + resG.flat().reduce((a, [, re]) => a + contar(re, tn), 0);
    const primeiro = resT.length ? resT[0][0] : resG.length ? resG[0][0][0] : "";
    achados.push([soma / Math.log(tn.length + 10), String(it.r.data_sessao || ""), it, primeiro]);
  }
  achados.sort((a, b) => b[0] - a[0] || cmpStr(b[1], a[1]));
  const termosTxt = [...resT.map(([t]) => t), ...gs.map((g) => g.join(" | "))].join(", ") || "(só filtros)";
  const filtros = [relF ? `relator «${L.texto(relator)}»` : "", nomeOrgao ? `órgão «${nomeOrgao}»` : ""].filter(Boolean).join("; ");
  const linhas = [
    `**Recibos locais do TCE-RO — ${achados.length} de ${totalGeral} decisão(ões) já lidas nesta máquina atendem a «${termosTxt}»` +
      `${filtros ? " em " + filtros : ""} · ZERO requisição ao portal**`,
    "⚠️ Isto NÃO é pesquisa no acervo do TCE-RO: só olha o que `obter_acordao_tcero` já trouxe para esta máquina " +
      `(${totalGeral} recibo(s); ${comPdf} com o PDF lido, ${totalGeral - comPdf} só com ementa + dispositivo — ` +
      "o que só está no relatório ou no voto não aparece nestes). Zero aqui NUNCA é \"não há jurisprudência\" nem " +
      "\"não localizado\": para isso, `buscar_jurisprudencia_tcero`. Não procura no texto de IA do DEJUR.",
  ];
  if (ignorados) linhas.push(`⚠️ ${ignorados} arquivo(s) da pasta de recibos ficaram de fora (ilegíveis ou com hash que não confere).`);
  if (avisoOrgao) linhas.push(`⚠️ ${avisoOrgao}`);
  if (!todos.length) linhas.push(`_(nenhum recibo em ${pasta || L.DIR_RECIBOS})_`);
  linhas.push("");
  achados.slice(0, lim).forEach(([, , it, primeiro], idx) => {
    const r = it.r;
    const sCit = { sigla: r.sigla, numero: r.numero, relator: r.relator, orgaoJulgador: r.orgao_cadastro, dataSessao: r.data_sessao, idDecisao: r.id_documento };
    const fecho = r.texto_pdf_completo !== null && r.texto_pdf_completo !== undefined ? L.orgaoDoFecho(r.texto) : null;
    let orgTxtItem = `${r.orgao_cadastro || "?"} (cadastro)`;
    if (fecho && L.fold(fecho) !== L.fold(String(r.orgao_cadastro || ""))) orgTxtItem += `; o fecho do PDF diz ${fecho} — vale o fecho, confira`;
    linhas.push(
      `${idx + 1}. ${r.sigla || "?"} ${r.numero || "?"} · id ${r.id_documento} · ${orgTxtItem} · ` +
        `julgado em ${L.dataBr(r.data_sessao || "") || "?"} · Rel. ${r.relator || "?"} · processo ${r.processo || "?"}`
    );
    linhas.push(`   Citação: ${L.citacao(sCit)}`);
    linhas.push(`   Link: ${r.link || "não informado"}`);
    linhas.push(`   Verificação gravada no recibo: ${verificacaoGravada(r)}`);
    const fx = primeiro ? L.faixaNorm(norm1(r.texto), [primeiro], 0.0) : null;
    if (fx) {
      const meio = Math.floor((fx[0] + fx[1]) / 2);
      const pos = posicaoTcero(r.texto, meio);
      const pag = L.paginaPdfTcero(r.texto, meio);
      if (pos) linhas.push(`   Onde: ${pos}` + (pag ? ` (${pag})` : ""));
      const a = Math.max(0, fx[0] - 140);
      const b = Math.min(r.texto.length, fx[1] + 140);
      linhas.push(`   «…${L.umaLinha(r.texto.slice(a, b))}…»`);
    }
    linhas.push(`   recibo gravado em ${String(r.gravado_em || "?").slice(0, 16).replace("T", " ")} (fonte: ${r.fonte || "?"})`);
  });
  if (achados.length > lim) {
    linhas.push(`\n_(mais ${achados.length - lim} recibo(s) atendem; aumente \`limite\` até ${RECIBOS_LIMITE_MAX} ou refine os termos)_`);
  }
  if (achados.length) {
    linhas.push(
      "\nA citação sai SEM a data do DOe (o recibo não a guarda): para a citação completa, `obter_acordao_tcero(id_decisao=...)`. " +
        "Para conferir uma frase antes das aspas: `verificar_citacao_tcero(id_decisao, trecho)` — sem rede quando há recibo."
    );
  } else {
    linhas.push("Nenhum recibo atende. Isso diz só o que esta máquina já leu; não diz nada sobre o acervo do TCE-RO.");
  }
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta de buscar_recibos").join("\n");
}

// --------------------------------------------------------------------------- //
// linha_do_tempo_tcero                                                          //
// --------------------------------------------------------------------------- //
export const LINHA_TEMPO_TOPO_POR_ANO = 2;
export const LINHA_TEMPO_ORGAOS_COLUNAS = 4;

export function anoDaSessao(s) {
  const d = L.campoPanorama(s.dataSessao);
  return d.length >= 4 && /^\d{4}$/.test(d.slice(0, 4)) ? d.slice(0, 4) : "sem data de sessão";
}

function maisComuns(mapa, n) {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Função PURA: conta por ano (da sessão) e por órgão julgador as decisões `itens` e mostra por ano as duas de maior relevância. */
export function linhaDoTempo(itens, termos, anoInicio = null, anoFim = null, filtros = "", totalBruto = null) {
  const porAno = new Map();
  for (const item of itens) {
    const s = (item && typeof item === "object" ? item.source : null) || {};
    const a = anoDaSessao(s);
    if (/^\d+$/.test(a)) {
      if (anoInicio !== null && parseInt(a, 10) < anoInicio) continue;
      if (anoFim !== null && parseInt(a, 10) > anoFim) continue;
    } else if (anoInicio !== null || anoFim !== null) {
      continue; // com recorte de anos, decisão sem data de sessão não tem como entrar
    }
    if (!porAno.has(a)) porAno.set(a, []);
    porAno.get(a).push(item);
  }
  const orgaoDe = (it) => L.campoPanorama((it.source || {}).orgaoJulgador) || "sem informação";
  const nTotal = [...porAno.values()].reduce((a, v) => a + v.length, 0);
  const orgaosTotal = new Map();
  for (const v of porAno.values()) for (const item of v) orgaosTotal.set(orgaoDe(item), (orgaosTotal.get(orgaoDe(item)) || 0) + 1);
  const colunas = maisComuns(orgaosTotal, LINHA_TEMPO_ORGAOS_COLUNAS).map(([o]) => o);
  const temOutros = orgaosTotal.size > colunas.length;
  const anos = [...porAno.keys()].filter((a) => /^\d+$/.test(a)).sort().reverse();
  const semData = porAno.get("sem data de sessão");
  let recorte = "";
  if (anoInicio !== null || anoFim !== null) recorte = ` · anos ${anoInicio !== null ? anoInicio : "…"} a ${anoFim !== null ? anoFim : "…"}`;
  const cab =
    `**Linha do tempo por ano — ${nTotal} decisão(ões) que a consulta devolveu${recorte}` +
    (totalBruto !== null && totalBruto !== nTotal ? ` (de ${totalBruto} no portal antes do filtro de grupos)` : "") +
    (filtros ? ` · ${filtros}` : "") +
    "**";
  const linhas = [
    cab,
    "",
    "| Ano | Decisões | " + colunas.join(" | ") + (temOutros ? " | outros" : "") + " |",
    "|---|---|" + "---|".repeat(colunas.length + (temOutros ? 1 : 0)),
  ];
  const linhaTabela = (rotulo, v) => {
    const c = new Map();
    for (const it of v) c.set(orgaoDe(it), (c.get(orgaoDe(it)) || 0) + 1);
    const cols = colunas.map((o) => String(c.get(o) || 0));
    if (temOutros) cols.push(String([...c.values()].reduce((a, x) => a + x, 0) - colunas.reduce((a, o) => a + (c.get(o) || 0), 0)));
    return `| ${rotulo} | ${v.length} | ` + cols.join(" | ") + " |";
  };
  for (const a of anos) linhas.push(linhaTabela(a, porAno.get(a)));
  if (semData) linhas.push(linhaTabela("sem data de sessão", semData));
  linhas.push("");
  linhas.push(
    `**As ${LINHA_TEMPO_TOPO_POR_ANO} decisões mais pertinentes de cada ano** (ordem do ranking de relevância offline: ` +
      "termos distintos da consulta na ementa e no dispositivo; empate por data):"
  );
  for (const a of anos) {
    const top = termos.length
      ? L.ordenarPorRelevancia(porAno.get(a), termos).slice(0, LINHA_TEMPO_TOPO_POR_ANO)
      : [...porAno.get(a)].sort((x, y) => cmpStr((y.source || {}).dataSessao || "", (x.source || {}).dataSessao || "")).slice(0, LINHA_TEMPO_TOPO_POR_ANO);
    for (const item of top) {
      const s = item.source || {};
      let casados = "";
      if (termos.length) {
        const [, nn] = L.pontuarRelevancia(s, termos);
        casados = ` · termos casados ${nn}/${termos.length}`;
      }
      const link = L.corrigirLinkPdf(s.linkArquivo || "");
      linhas.push(`- ${a} · id ${s.idDecisao} · ${L.citacao(s)}${casados} · ${link || "link não informado"}`);
    }
  }
  linhas.push("");
  linhas.push(
    "_Isto é a CONTAGEM do que o portal devolveu para ESTA consulta (OU nativo no portal; `grupos` filtrados no cliente), " +
      "não a frequência com que a Corte decide o tema nem tendência: o volume de processos, a composição dos órgãos e o que " +
      "o portal publica mudam de ano para ano. Mudança de proporção entre anos é sinal para LER as decisões dos dois " +
      "períodos, nunca prova de mudança de entendimento. Ano = ano da sessão._"
  );
  return linhas;
}

/** Validação de ano_inicio/ano_fim da ferramenta (sem rede). Devolve {erro} ou {ai, af}. */
export function validarAnos(anoInicio, anoFim) {
  const conv = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
    throw new Error("invalido");
  };
  let ai, af;
  try {
    ai = conv(anoInicio);
    af = conv(anoFim);
  } catch {
    return { erro: "ano_inicio/ano_fim inválidos: informe números inteiros (ex.: 2020). Nenhuma requisição foi feita." };
  }
  if ((ai !== null && !(ai >= 1990 && ai <= 2100)) || (af !== null && !(af >= 1990 && af <= 2100)) || (ai !== null && af !== null && ai > af)) {
    return { erro: "ano_inicio/ano_fim fora do intervalo plausível (1990 a 2100) ou invertidos. Nenhuma requisição foi feita." };
  }
  return { ai, af };
}

// --------------------------------------------------------------------------- //
// sugerir_termos_tcero                                                          //
// --------------------------------------------------------------------------- //
export const SUGESTOES_MIN = 10;
export const SUGESTOES_MAX = 20;
export const VOCAB_CASADAS_MIN = 8;
export const VOCAB_RESTANTE_MIN = 15;
export const VOCAB_LIFT_MIN = 1.3;
export const VOCAB_LIFT_FUNDO_MIN = 5.0;
const ARQ_FUNDO_PADRAO = path.join(path.dirname(fileURLToPath(import.meta.url)), "fundo_vocabulario.json");
const fundoCache = new Map();
export const limparFundoCache = () => fundoCache.clear();

const STOP_VOCAB = new Set(
  ("para como pela pelo pelas pelos entre sobre sendo foram ainda sendo cada todo toda todos todas desde " +
    "ante apos assim mais menos muito muita muitos muitas quando onde qual quais cujo cuja cujos cujas " +
    "esta este estes estas essa esse esses essas aquele aquela isso isto aqui seus suas seu sua nosso " +
    "nossa tambem porem contudo todavia portanto entao pois porque conforme segundo mediante perante " +
    "contra durante dentro fora havia houve haver ter tem tinha possui possuem deve devem deverao pode " +
    "podem podera nao sem sob ser sao seja sejam fosse eram era foi sera serao tendo tendo ficou fica " +
    "visto vista dado dada dados partir devido onde alem inclusive bem forma modo tal tais outro outra " +
    "outros outras mesmo mesma mesmos mesmas neste nesta nestes nestas nesse nessa nesses nessas " +
    "deste desta destes destas desse dessa desses dessas pelos aquilo hoje atual atuais").split(" ")
);
export const RE_PALAVRA_VOCAB = /[a-z]{4,}/g;
const palavrasVocab = (t) => L.fold(t || "").match(RE_PALAVRA_VOCAB) || [];

/** Palavras de 4+ letras (sem acento, minúsculas), sem número e sem palavra de ligação, na ordem do texto. */
export function tokensVocab(texto) {
  return palavrasVocab(texto).filter((w) => !STOP_VOCAB.has(w));
}

/** Só o núcleo (ementa + dispositivo); a IA do DEJUR nunca entra no vocabulário. */
export function textoVocabDaDecisao(s) {
  return (s.ementa || "") + " " + L.htmlParaTexto(s.acordaoDescricao || "");
}

export function carregarFundo() {
  const caminho = process.env.TCERO_MCP_FUNDO_VOCAB || ARQ_FUNDO_PADRAO;
  if (fundoCache.has(caminho)) return fundoCache.get(caminho);
  let fundo = null;
  try {
    const d = L.lerJsonGenerico(caminho);
    if (d && typeof d === "object" && d.df && typeof d.df === "object" && !Array.isArray(d.df) && (parseInt(d.N, 10) || 0) >= 300) {
      fundo = { N: parseInt(d.N, 10), df: d.df, df2: d.df2 && typeof d.df2 === "object" && !Array.isArray(d.df2) ? d.df2 : {} };
    }
  } catch {
    fundo = null;
  }
  fundoCache.set(caminho, fundo);
  return fundo;
}
const dfDe = (obj, k, padrao) => (Object.hasOwn(obj, k) ? Number(obj[k]) : padrao);

/** Com `grupos`: cada grupo é uma unidade (basta UM termo dele); sem: cada termo solto de texto_livre. */
export function unidadesDaConsulta(textoLivre, gruposOk) {
  if (gruposOk.length) return gruposOk;
  return L.termosDaConsulta(textoLivre, null).map((t) => [t]);
}

export function acertosDaDecisao(s, unidades) {
  const [nucleo] = L.camposCasamento(s);
  return unidades.filter((u) => u.some((t) => L.termoCasa(nucleo, t))).length;
}

/** (casadas, restante, k): k = maior número de unidades que ao menos `minimo` decisões casam NO NÚCLEO, descendo de M até 1. */
export function separarCasadas(itens, unidades, minimo = 10) {
  const pontos = itens.map((it) => [acertosDaDecisao(it.source || {}, unidades), it]);
  const m = unidades.length;
  let k = 1;
  for (let cand = m; cand >= 1; cand--) {
    if (pontos.filter(([p]) => p >= cand).length >= minimo) {
      k = cand;
      break;
    }
  }
  return [pontos.filter(([p]) => p >= k && p >= 1).map(([, it]) => it), pontos.filter(([p]) => p < k || p < 1).map(([, it]) => it), k];
}

const arred6 = (x) => Number(x.toFixed(6));

/** Função PURA. Devolve {n, m, termos: [[palavra, c]], pares: [[par, c]], usou_fundo, usou_restante} ou {pouco: true, n} / {sem_base: true, n, m}. */
export function sugerirVocabulario(casadas, restante, termosUsuario, fundo, relatoresNomes = null) {
  const n = casadas.length;
  if (n < VOCAB_CASADAS_MIN) return { pouco: true, n };
  const m = restante.length;
  const usaRestante = m >= VOCAB_RESTANTE_MIN;
  const usaFundo = fundo !== null && fundo !== undefined;
  if (!usaRestante && !usaFundo) return { sem_base: true, n, m };
  const nomes = new Set(relatoresNomes || []);
  const meus = new Set();
  for (const t of termosUsuario) for (const w of palavrasVocab(t)) meus.add(w);
  const stems = [...meus].map((w) => (w.length >= 6 ? w.slice(0, Math.max(5, w.length - 3)) : w));
  const ja = (w) => meus.has(w) || nomes.has(w) || stems.some((st) => w.startsWith(st));

  const dfs = (itens) => {
    const d1 = new Map();
    const d2 = new Map();
    for (const it of itens) {
      const ws = tokensVocab(textoVocabDaDecisao(it.source || {}));
      for (const w of new Set(ws)) d1.set(w, (d1.get(w) || 0) + 1);
      const pares = new Set();
      for (let i = 0; i + 1 < ws.length; i++) if (ws[i] !== ws[i + 1]) pares.add(`${ws[i]} ${ws[i + 1]}`);
      for (const p of pares) d2.set(p, (d2.get(p) || 0) + 1);
    }
    return [d1, d2];
  };

  const [c1, c2] = dfs(casadas);
  const [r1, r2] = usaRestante ? dfs(restante) : [new Map(), new Map()];
  const N = usaFundo ? fundo.N : 0;
  const fdf = usaFundo ? fundo.df : {};
  const fdf2 = usaFundo ? fundo.df2 || {} : {};

  // consulta ampla (as casadas são uma fração grande do fundo): 5x o fundo é matematicamente inatingível, então o piso desce, nunca abaixo de 1,5x
  const liftMin = usaFundo ? Math.min(VOCAB_LIFT_FUNDO_MIN, Math.max(1.5, 0.6 / Math.max(n / (N + 1), 1e-9))) : VOCAB_LIFT_FUNDO_MIN;
  const liftFundo = (c, dfF) => c / n / ((dfF + 1) / (N + 1));
  const liftOk = (c, r) => !usaRestante || c / n >= VOCAB_LIFT_MIN * (r / m);

  const escolher = (pisoShare) => {
    const piso = Math.max(3, Math.ceil(pisoShare * n));
    const uni = [];
    for (const [w, c] of c1) {
      if (w.length < 5 || c < piso || ja(w) || !liftOk(c, r1.get(w) || 0)) continue;
      if (usaFundo) {
        const lf = liftFundo(c, dfDe(fdf, w, 0));
        if (lf < liftMin) continue;
        uni.push([w, c, arred6((c / n) * Math.log(lf))]);
      } else {
        uni.push([w, c, arred6((c / n) * Math.log((m + 1) / ((r1.get(w) || 0) + 1)))]);
      }
    }
    const par = [];
    for (const [p, c] of c2) {
      const [a, b] = p.split(" ");
      if (c < Math.max(3, Math.ceil((pisoShare + 0.05) * n)) || ja(a) || ja(b)) continue;
      if (!liftOk(c, r2.get(p) || 0)) continue;
      if (usaFundo) {
        // par ausente do fundo (df < 5) conta como df 4: o piso do arquivo
        const lf = liftFundo(c, dfDe(fdf2, p, 4));
        if (lf < liftMin) continue;
        par.push([p, c, arred6((c / n) * Math.log(lf))]);
      } else {
        par.push([p, c, arred6((c / n) * Math.log((m + 1) / ((r2.get(p) || 0) + 1)))]);
      }
    }
    const ord = (x, y) => y[2] - x[2] || cmpStr(x[0], y[0]);
    uni.sort(ord);
    par.sort(ord);
    return [uni, par];
  };

  let share = 0.2;
  let uni = [];
  let par = [];
  for (share of [0.2, 0.15, 0.1, 0.07]) {
    [uni, par] = escolher(share);
    if (uni.slice(0, 12).length + par.slice(0, 8).length >= SUGESTOES_MIN) break;
  }
  // pares só entram se não repetirem uma palavra já sugerida (evita "dano" + "dano erario" + "erario")
  const termos = uni.slice(0, 12);
  const palavrasJa = new Set(termos.map(([w]) => w));
  const pares = par.filter(([p]) => !p.split(" ").every((w) => palavrasJa.has(w))).slice(0, 8);
  return {
    n,
    m,
    termos: termos.map(([w, c]) => [w, c]),
    pares: pares.map(([p, c]) => [p, c]),
    usou_fundo: usaFundo,
    usou_restante: usaRestante,
    piso: share,
    lift_min: Math.round(liftMin * 100) / 100,
  };
}

export function blocoVocabulario(res, k, mUnid, totalBruto) {
  if (res.pouco) {
    return [
      `**Vocabulário:** só ${res.n} decisão(ões) casaram os termos no núcleo (ementa + dispositivo); são poucas ` +
        `para sugerir termos (mínimo ${VOCAB_CASADAS_MIN}). Alargue a consulta (menos grupos ou mais sinônimos) e repita.`,
    ];
  }
  if (res.sem_base) {
    return [
      `**Vocabulário:** a resposta tem só ${res.m} decisão(ões) fora das que casaram (mínimo ${VOCAB_RESTANTE_MIN} para ` +
        "servir de contraste) e o fundo `fundo_vocabulario.json` não está disponível; sem base de comparação, " +
        "sugerir seria devolver as palavras mais comuns. Nada sugerido.",
    ];
  }
  const base = [];
  if (res.usou_restante) base.push(`as outras ${res.m} decisões da resposta`);
  if (res.usou_fundo) base.push("o vocabulário geral das ementas do TCE-RO (fundo local)");
  const linhas = [
    `**Vocabulário das ${res.n} decisões que casaram ${k} de ${mUnid} termo(s)/grupo(s) no núcleo (ementa + dispositivo)** ` +
      `(de ${totalBruto} que o portal devolveu; contraste com ${base.join(" e ")}; zero requisição extra). ` +
      "Sugestão para a próxima rodada, indício e não conclusão.",
  ];
  if (res.termos.length) linhas.push("- Palavras características (nº de decisões casadas que a trazem): " + res.termos.map(([w, c]) => `${w} (${c}/${res.n})`).join(", "));
  if (res.pares.length) linhas.push("- Pares de palavras: " + res.pares.map(([p, c]) => `«${p}» (${c}/${res.n})`).join(", "));
  const total = res.termos.length + res.pares.length;
  if (total === 0) linhas.push("- Nada passou o corte de frequência.");
  else if (total < SUGESTOES_MIN) linhas.push(`- (só ${total} passaram o corte; a página tem pouca variedade de vocabulário)`);
  linhas.push(
    "Como usar: escolha 2 a 4 que sejam sinônimos ou variantes do SEU conceito e acrescente-os ao mesmo grupo de `grupos` " +
      "(alternativas em OU, alarga); como grupo novo eles exigem o conceito (E, estreita). NÃO cole a lista inteira: na medição " +
      "(6 consultas), 3 sugestões em OU ampliaram o conjunto mas derrubaram o topo em 4 consultas. Palavras de 5+ letras casam " +
      "também a flexão (\"multa\" pega \"multas\"). Cada rodada gasta uma consulta ao portal."
  );
  return linhas;
}

/** Monta o texto de sugerir_termos a partir da resposta já obtida (`r` = resultado de consultaFiltrada em index.js). */
export function textoSugerirTermos(textoLivre, r) {
  const gruposOk = r.grupos_ok;
  if (!gruposOk.length && !L.termosDaConsulta(textoLivre, null).length) return "Informe `texto_livre` ou `grupos` com ao menos um termo.";
  // para o contraste, a base é a resposta INTEIRA do portal (antes do filtro de grupos), não só o que sobrou do filtro
  const todosPortal = r.brutos;
  const unidades = unidadesDaConsulta(textoLivre, gruposOk);
  const [casadas, restante, k] = separarCasadas(todosPortal, unidades);
  const termosUsuario = unidades.flat();
  const nomes = new Set();
  for (const it of todosPortal) for (const w of palavrasVocab((it.source || {}).relator || "")) nomes.add(w);
  const res = sugerirVocabulario(casadas, restante, termosUsuario, carregarFundo(), nomes);
  const linhas = [`Consulta: \`${L.truncar(Object.entries(r.params).map(([kk, v]) => `${kk}=${v}`).join("; "), 200)}\``];
  linhas.push(...blocoVocabulario(res, k, unidades.length, todosPortal.length));
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta de sugerir_termos").join("\n");
}

// --------------------------------------------------------------------------- //
// modo triagem de obter_acordao_tcero                                           //
// --------------------------------------------------------------------------- //
export const TRIAGEM_FECHO_MAX = 1800;
export const TRIAGEM_EXCERTO_MAX = 200;
export const TRIAGEM_ALERTAS_POR_TIPO = 3;
const RE_FECHO_ACORDAM = /ACORDAM\s+os\s+Senhores\s+Conselheiros/gi;
const RE_PROC_LINHA_TC = /(?:(?<=\n)|(?<![\s\S]))[ \t]*Proc\.?[ \t]*:[^\n]*\n?/g; // "Proc.: 02603/22" que sobra do cabeçalho de página
const ROTULO_ESTRUTURA = {
  ementa: "EMENTA",
  acordao: "ACÓRDÃO (o que o colegiado proclamou)",
  relatorio: "RELATÓRIO",
  voto: "VOTO do relator",
  "proposta de decisao": "PROPOSTA DE DECISÃO",
  fundamentacao: "FUNDAMENTAÇÃO",
  fundamentos: "FUNDAMENTOS",
  dispositivo: "DISPOSITIVO",
};

/** O mesmo texto que `gravarReciboTcero` guarda em `texto` (ementa + dispositivo + PDF). */
export function textoDoRecibo(s, textoPdf) {
  const ementa = L.ementaLimpa(s).trim();
  const dispositivo = L.htmlParaTexto(s.acordaoDescricao || "").trim();
  return [ementa, dispositivo, textoPdf || ""].filter(Boolean).join("\n\n");
}

/** [[rótulo, página, título]] dos cabeçalhos que `posicaoTcero` usa (mesma regex e mesmos filtros), na ordem do texto. */
export function estruturaPdfTcero(bruto) {
  const out = [];
  for (const m of bruto.matchAll(RE_CAB_TC)) {
    const k = norm1(m[1]);
    const resto = stripPy(norm1(m[2] || ""), " :.-–");
    if (k === "dispositivo" && resto.startsWith("e tese")) continue;
    if (["acordao", "relatorio", "dispositivo", "ementa"].includes(k) && resto.length > 25) continue;
    let rotulo = Object.hasOwn(ROTULO_ESTRUTURA, k) ? ROTULO_ESTRUTURA[k] : k.toUpperCase();
    if (["voto", "proposta de decisao", "fundamentacao", "fundamentos"].includes(k)) {
      // Divergência deliberada do Python: o pdf.js põe o cabeçalho de página COLADO logo depois do título (o PyMuPDF deixa linhas em branco no
      // meio), e o ponto "título + 3" caía dentro do cabeçalho, que a posição rotula como cabeçalho de página. Pula o cabeçalho; sem cabeçalho
      // colado o ponto é o mesmo do Python.
      let meio = Math.min(bruto.length - 1, m.index + m[0].length + 3);
      for (const h of bruto.matchAll(RE_PAGINA_TC)) {
        if (h.index > meio) break;
        if (meio < h.index + h[0].length) {
          meio = Math.min(bruto.length - 1, h.index + h[0].length);
          break;
        }
      }
      const pos = posicaoTcero(bruto, meio);
      if (pos.startsWith("VOTO de outro conselheiro")) rotulo = "VOTO de outro conselheiro";
    }
    const titulo = colapsa(bruto.slice(m.index, m.index + m[0].length)).trim().slice(0, 80);
    out.push([rotulo, L.paginaPdfTcero(bruto, m.index), titulo, m.index]);
  }
  // red team 22/10/2026: voto de vogal/vencido com título só "CONSELHEIRO NOME" (sem VOTO) — entra se a posição o trata como voto de outro
  for (const [p, , continua] of linhasConselheiroTc(bruto)) {
    // rodada 2: a 2ª linha de um título "VOTO\nCONSELHEIRO NOME" já entrou pelo próprio título VOTO — não lista em dobro
    if (continua || out.some((x) => x[3] === p)) continue;
    const fimLinha = bruto.indexOf("\n", p);
    const meio = Math.min(bruto.length - 1, (fimLinha >= 0 ? fimLinha : bruto.length) + 1);
    if (!posicaoTcero(bruto, meio).startsWith("VOTO de outro conselheiro")) continue;
    const titulo = colapsa(bruto.slice(p, fimLinha >= 0 ? fimLinha : bruto.length)).trim().slice(0, 80);
    out.push(["VOTO de outro conselheiro", L.paginaPdfTcero(bruto, p), titulo, p]);
  }
  return out.sort((a, b) => a[3] - b[3]).map(([r, pg, t]) => [r, pg, t]);
}

/** [texto do fecho, quantos "ACORDAM os Senhores Conselheiros" há no texto]. */
export function fechoDoPdf(bruto, maximo = TRIAGEM_FECHO_MAX) {
  const ms = [...bruto.matchAll(RE_FECHO_ACORDAM)];
  if (!ms.length) return [null, 0];
  const ini = ms[0].index;
  let fim = Math.min(bruto.length, ini + 3000);
  const prefixo = bruto.slice(0, fim);
  const re = new RegExp(RE_CAB_TC.source, "g");
  re.lastIndex = ini + 20;
  for (let m; (m = re.exec(prefixo)) !== null; ) {
    if (["relatorio", "voto", "proposta de decisao"].includes(norm1(m[1]))) {
      fim = m.index;
      break;
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  const semPagina = bruto.slice(ini, fim).replace(RE_PAGINA_TC, " ");
  let seg = colapsa(semPagina.replace(RE_PROC_LINHA_TC, " ")).trim();
  if (seg.length > maximo) {
    const corte = seg.slice(0, maximo);
    const i = corte.lastIndexOf(" ");
    seg = (i >= 0 ? corte.slice(0, i) : corte) + " […]";
  }
  return [seg, ms.length];
}

/** [[rótulo, total de gatilhos, [[posição no bruto, excerto]] dos primeiros]] — os MESMOS detectores que alimentam os campos do recibo
 * (`excertosRaw`) mais a marca de obiter. */
export function alertasDeTriagem(bruto) {
  const out = [];
  for (const [rotulo, regex] of [
    ["voto divergente / vencido / vista", L.RE_DIVERGENCIA_RAW],
    ["parecer do MPC / corpo técnico", L.RE_PARECER_MPC_RAW],
    ["alegação da parte", L.RE_ALEGACAO_RAW],
    ["transcrição de outro julgado/norma", L.RE_TRANSCRICAO_RAW],
  ]) {
    const exc = L.excertosRawComPos(bruto, regex);
    if (exc.length) out.push([rotulo, exc.length, exc.slice(0, TRIAGEM_ALERTAS_POR_TIPO)]);
  }
  const tn = norm1(bruto);
  const ob = [];
  for (const m of tn.matchAll(RE_OBITER)) {
    if (ob.some(([p]) => Math.abs(m.index - p) < 40)) continue;
    const ini = inicioDaFrase(bruto, tn, Math.max(0, m.index - OBITER_JANELA), m.index);
    ob.push([m.index, colapsa(bruto.slice(Math.max(ini, m.index - 40), m.index + 160)).trim()]);
  }
  if (ob.length) out.push(["obiter dictum? (marca de raciocínio hipotético)", ob.length, ob.slice(0, TRIAGEM_ALERTAS_POR_TIPO)]);
  return out;
}

/** Bloco "Do PDF" da triagem — sem o texto corrido. */
export function linhasTriagemPdf(bruto, resultado) {
  if (resultado.sem_texto) {
    return ["\n**Do PDF:** sem texto extraível (provável digitalização); a triagem não tem o que mostrar. Abra o link no navegador."];
  }
  const paginas = resultado.paginas || 0;
  const estado = resultado.parcial ? "extração PARCIAL (" + String(resultado.motivo_parcial) + ")" : "extração completa";
  const linhas = [`\n**Do PDF (sem o texto corrido) — ${L.num(paginas)} página(s), ${estado}:**`];
  const est = estruturaPdfTcero(bruto);
  if (est.length) {
    linhas.push("- Estrutura: " + est.map(([r, p]) => `${r}${p ? " (" + p.replace(" do PDF", "") + ")" : ""}`).join(" · "));
    for (const [r, p, t] of est.filter(([r]) => r === "VOTO de outro conselheiro")) {
      linhas.push(`- VOTO de outro conselheiro começa em «${t}»` + (p ? ` (${p})` : "") + " — não é o voto condutor (vencido, vista ou vogal); veja quem venceu no fecho.");
    }
  } else {
    linhas.push("- Estrutura: nenhum título de acórdão/relatório/voto reconhecido neste PDF.");
  }
  const [fecho, nFechos] = fechoDoPdf(bruto);
  if (fecho) {
    linhas.push(`- Fecho (literal, cabeçalhos de página fora): «${fecho}»` + (nFechos > 1 ? ` (há ${nFechos} fechos no PDF; este é o primeiro)` : ""));
    const org = L.orgaoDoFecho(bruto);
    if (org) linhas.push(`- Órgão que o fecho declara: ${org}`);
  } else {
    linhas.push('- Fecho: não há "ACORDAM os Senhores Conselheiros" no texto (decisão monocrática ou texto sem fecho).');
  }
  const alertas = alertasDeTriagem(bruto);
  if (alertas.length) {
    linhas.push("- Linhas que os detectores marcam (indício para ler; não é veredito):");
    for (const [rotulo, total, ocorr] of alertas) {
      linhas.push(`  · ${rotulo}: ${total} ocorrência(s)` + (total > ocorr.length ? ` (mostro ${ocorr.length})` : ""));
      for (const [pos, exc] of ocorr) {
        const onde = posicaoTcero(bruto, pos + 1);
        const pag = L.paginaPdfTcero(bruto, pos);
        linhas.push(`    – ${onde || "posição não identificada"}${pag ? " (" + pag + ")" : ""}: «${exc.slice(0, TRIAGEM_EXCERTO_MAX)}${exc.length > TRIAGEM_EXCERTO_MAX ? "…" : ""}»`);
      }
    }
  } else {
    linhas.push("- Linhas marcadas pelos detectores: nenhuma.");
  }
  return linhas;
}

/** Bloco de triagem de UMA decisão. `brutoPdf` = texto do recibo (ementa + dispositivo + PDF) se o PDF foi lido. */
export function triagemDecisao(s, brutoPdf = null, resultadoPdf = null, avisoPdf = null) {
  const linhas = [`\n### TRIAGEM · ${s.sigla || "?"} ${s.numero || "(sem número)"} · id ${s.idDecisao}`, `Citação: ${L.citacao(s)}`];
  const campos = [];
  for (const [chave, rotulo] of [["processo", "Processo"], ["natureza", "Natureza"], ["assunto", "Assunto"], ["jurisdicionado", "Jurisdicionado"], ["votacao", "Votação"], ["resultado", "Resultado"]]) {
    if (s[chave]) campos.push(`${rotulo}: ${L.umaLinha(String(s[chave])).slice(0, 240)}`);
  }
  if (campos.length) linhas.push("  " + campos.join(" · "));
  linhas.push(`  Órgão julgador (cadastro): ${s.orgaoJulgador || "não informado"}`);
  for (const a of L.avisosCancelamentoVinculo(s)) linhas.push(a);
  let ementa = L.neutralizarMarkdown((s.ementa || "—").trim());
  if (ementa.length > L.ORCAMENTO_CAMPO) {
    const corte = ementa.slice(0, L.ORCAMENTO_CAMPO);
    const i = corte.lastIndexOf(" ");
    ementa = (i >= 0 ? corte.slice(0, i) : corte) + "… [CORTADO pelo orçamento de caracteres]";
  }
  linhas.push(`\n**Ementa (integral, literal do portal):**\n${ementa}`);
  {
    const te = L.teseDaEmenta(L.ementaLimpa(s));
    if (te) linhas.push(L.linhaTese(te));
  }
  const disp = L.neutralizarMarkdown(L.htmlParaTexto(s.acordaoDescricao || ""));
  if (disp) linhas.push(`\n**Dispositivo (campo \`acordaoDescricao\`, literal):**\n${L.truncar(disp, L.ORCAMENTO_CAMPO)}`);
  else linhas.push("\nDispositivo (`acordaoDescricao`): não informado pelo portal para esta decisão.");
  const link = L.corrigirLinkPdf(s.linkArquivo || "");
  linhas.push(link ? `\nInteiro teor (PDF): ${link}` : "\nInteiro teor: link não informado pelo portal.");
  if (resultadoPdf !== null && brutoPdf !== null) linhas.push(...linhasTriagemPdf(brutoPdf, resultadoPdf));
  else if (avisoPdf) linhas.push(`\n${avisoPdf}`);
  else linhas.push("\n**Do PDF:** não lido (use `ler_inteiro_teor=true` para ver estrutura, fecho e linhas marcadas).");
  linhas.push(
    '\n---\nTRIAGEM é só para decidir se vale ler: NUNCA serve para aspas nem para escrever "inteiro teor lido (PDF)" numa ficha — ' +
      'para isso, `modo="completo"` com `ler_inteiro_teor=true`, ou `verificar_citacao_tcero` (sem rede quando há recibo). ' +
      'As "informações adicionais" (IA do DEJUR) ficam de fora da triagem.'
  );
  return linhas;
}
