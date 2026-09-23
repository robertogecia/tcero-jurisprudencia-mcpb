#!/usr/bin/env node
/**
 * Servidor MCP — Jurisprudência do TCE-RO (Tribunal de Contas do Estado de Rondônia)
 * Busca pública no portal ePapyrus (papyrus.tcero.tc.br), sem login.
 * Porte Node.js do servidor Python (~/MCP/tcero-jurisprudencia/servidor_tcero.py, commit
 * 6dcd631, v1.1.0) para empacotamento .mcpb (1 clique no Claude Desktop).
 *
 * Wiring do protocolo MCP, rede (fetch nativo) e extração de PDF (pdfjs-dist) ficam aqui.
 * Toda a lógica pura (formatação, normalização, recibo, disjuntor em arquivo) está em lib.js
 * e é coberta por testes em test/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as L from "./lib.js";

// --------------------------------------------------------------------------- //
// Checagem de versão nova — dispara em 2º plano, nunca aguardada.             //
// --------------------------------------------------------------------------- //
async function checarVersaoNova(timeoutMs = 5000) {
  if (process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO === "1") return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(L.RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": L.HEADERS_BASE["User-Agent"] },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (r.status !== 200) return null;
    const json = await r.json();
    const tag = String(json?.tag_name || "").trim();
    const tagLimpa = tag.startsWith("v") ? tag.slice(1) : tag;
    return L.versaoMaisNova(L.VERSAO, tagLimpa) ? tagLimpa : null;
  } catch {
    return null;
  }
}

function iniciarChecagemVersao() {
  if (L.estadoVersao.tarefaIniciada) return;
  L.estadoVersao.tarefaIniciada = true;
  checarVersaoNova()
    .then((tag) => {
      L.estadoVersao.versaoNovaCache = tag;
    })
    .catch(() => {});
}

function linkRelato(tipo, agora = Date.now()) {
  let estadoTxt;
  try {
    const e = L.lerEstado();
    const inc = e.incidentes || [];
    const tipos = inc.slice(-5).map((i) => i.operacao || "sem_tipo").join(", ") || "nenhum";
    const recentes = (e.requisicoes || []).filter((t) => agora - t <= 60000).length;
    estadoTxt =
      `- Nível do limitador: ${e.indiceJanela + 1} de ${L.ESCADA_JANELA_MS.length}\n` +
      `- Consultas no último minuto: ${recentes}\n` +
      `- Bloqueios registrados: ${inc.length} (últimas operações: ${tipos})\n`;
  } catch {
    estadoTxt = "- Estado do limitador: indisponível\n";
  }
  const titulo = `Erro ${tipo} na v${L.VERSAO}`;
  const corpo =
    "**Relato gerado pela extensão** (revise antes de enviar; não inclua nome de parte, " +
    "número de processo nem o texto da sua busca — issues são públicas)\n\n" +
    `- Versão: ${L.VERSAO}\n- Sistema: ${process.platform} ${process.version}\n` +
    `- Tipo do erro: ${tipo}\n${estadoTxt}` +
    "\n**O que eu estava fazendo:** \n\n" +
    "**A pesquisa funciona direto no portal (papyrus.tcero.tc.br), pelo navegador?** sim / não\n\n" +
    "**Desde quando acontece?** \n";
  return `${L.ISSUES_NOVA}?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;
}

function rodapeErro(mensagem) {
  const tipo = L.tipoDoErro(mensagem);
  const partes = [
    `\n\nVersão: ${L.VERSAO} · Sistema: ${process.platform} ${process.version} · ` +
      `Limitador: ${estadoLimitadorResumo()}`,
  ];
  iniciarChecagemVersao();
  if (L.estadoVersao.versaoNovaCache) {
    partes.push(
      `Há versão nova (v${L.estadoVersao.versaoNovaCache}) e ela pode já corrigir este problema: ${L.RELEASES_PAGINA}`
    );
  }
  if (!L.SEM_RELATO_TIPOS.has(tipo)) {
    const sufixo = L.estadoVersao.versaoNovaCache ? " (depois de atualizar, se houver versão nova)" : "";
    partes.push(
      `Se o problema continuar${sufixo}, relate ao autor em ${linkRelato(tipo)} informando ` +
        "a versão, o sistema e esta mensagem."
    );
  }
  return partes.join("\n");
}

function estadoLimitadorResumo(agora = Date.now()) {
  const e = L.lerEstado();
  const situacao = agora < e.bloqueadoAte ? "BLOQUEADO" : "livre";
  return `nível ${e.indiceJanela + 1}/${L.ESCADA_JANELA_MS.length}, ${situacao}`;
}

class PortalRecusou extends Error {}

function formatarErroPortal(e, prefixo) {
  const msg = `${prefixo}: ${e.message || e}`;
  if (e instanceof PortalRecusou || e instanceof Error) {
    return msg + rodapeErro(String(e.message || e));
  }
  return msg;
}

// --------------------------------------------------------------------------- //
// Camada HTTP                                                                  //
// --------------------------------------------------------------------------- //
async function getComRetentativa(url, params, operacao) {
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < L.TENTATIVAS_MAX; tentativa++) {
    const reserva = L.reservarRequisicao();
    if (reserva.erro) throw new Error(reserva.erro);
    if (reserva.esperarMs > 0) await new Promise((r) => setTimeout(r, reserva.esperarMs));
    const qs = new URLSearchParams(params).toString();
    let r;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90_000);
      try {
        r = await fetch(`${url}?${qs}`, { headers: L.HEADERS_BASE, redirect: "follow", signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      ultimoErro = e;
      if (tentativa < L.TENTATIVAS_MAX - 1) {
        await new Promise((res) => setTimeout(res, 2000 * (tentativa + 1)));
        continue;
      }
      const nomeErro = e.name === "AbortError" ? "TimeoutException" : e.code || e.name || "Error";
      if (!L.falhaTransitoria(nomeErro)) {
        L.registrarBloqueioDetectado(Date.now(), operacao, false);
      }
      throw new PortalRecusou(`Falha de rede repetida ao consultar o portal do TCE-RO (${nomeErro}: ${e.message}).`);
    }
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      const retryAfter = parseFloat(r.headers.get("retry-after") || "0") || 0;
      if (r.status >= 500 && tentativa < L.TENTATIVAS_MAX - 1) {
        await new Promise((res) => setTimeout(res, 2000 * (tentativa + 1)));
        continue;
      }
      L.registrarBloqueioDetectado(Date.now(), operacao, r.status === 403 || r.status === 429, retryAfter * 1000);
      throw new PortalRecusou(
        `O portal do TCE-RO respondeu HTTP ${r.status} de forma persistente ` +
          "(bloqueio, recusa explícita, ou instabilidade do lado do tribunal). O portal " +
          "papyrus.tcero.tc.br segue acessível no navegador."
      );
    }
    L.registrarSucesso();
    return r;
  }
  throw new PortalRecusou(`Falha de rede repetida ao consultar o portal do TCE-RO: ${ultimoErro}`);
}

// Cache da resposta crua por processo (TTL curto) — mesma disciplina do Python.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 24;
const CACHE_MAX_BYTES = 48 * 1024 * 1024;
const cacheRespostas = new Map();
let cacheBytes = 0;

function cacheLer(chave) {
  const item = cacheRespostas.get(chave);
  if (!item) return null;
  if (Date.now() - item.quando > CACHE_TTL_MS) {
    cacheRespostas.delete(chave);
    cacheBytes -= item.tamanho;
    return null;
  }
  return item.dados;
}

function cacheGravar(chave, dados, tamanho = 0) {
  const antigo = cacheRespostas.get(chave);
  if (antigo) {
    cacheRespostas.delete(chave);
    cacheBytes -= antigo.tamanho;
  }
  tamanho = Math.max(0, tamanho || 0);
  if (tamanho > CACHE_MAX_BYTES) return;
  while (cacheRespostas.size && (cacheRespostas.size >= CACHE_MAX || cacheBytes + tamanho > CACHE_MAX_BYTES)) {
    const chaveVelha = cacheRespostas.keys().next().value;
    const velho = cacheRespostas.get(chaveVelha);
    cacheRespostas.delete(chaveVelha);
    cacheBytes -= velho.tamanho;
  }
  cacheRespostas.set(chave, { quando: Date.now(), dados, tamanho });
  cacheBytes += tamanho;
}

async function consultarApi(params, operacao) {
  if (!params || !Object.entries(params).some(([k, v]) => k !== "filtrarResultados" && L.texto(v))) {
    throw new Error(
      "consulta sem nenhum filtro preenchido — o portal do TCE-RO devolveria o acervo " +
        "inteiro (múltiplos MB). Informe número, id, relator, órgão ou texto livre."
    );
  }
  const chave = JSON.stringify(Object.entries(params).sort());
  const emCache = cacheLer(chave);
  if (emCache !== null) return emCache;
  const r = await getComRetentativa(L.ENDPOINT_BUSCAR, params, operacao);
  const buf = await r.arrayBuffer();
  const tamanho = buf.byteLength;
  let dados;
  try {
    dados = JSON.parse(Buffer.from(buf).toString("utf-8"));
  } catch (e) {
    throw new Error(`O portal respondeu algo que não é JSON válido (HTTP ${r.status}): ${e.message}`);
  }
  if (!dados || typeof dados !== "object" || !("result" in dados)) {
    throw new Error("Resposta do portal em formato inesperado (sem a chave 'result') — o portal pode ter mudado de layout.");
  }
  if (dados.result !== null && dados.result !== undefined && !Array.isArray(dados.result)) {
    throw new Error(
      `Resposta do portal em formato inesperado ('result' veio como ${typeof dados.result}, ` +
        "não lista) — o portal pode ter mudado de layout."
    );
  }
  cacheGravar(chave, dados, tamanho);
  return dados;
}

// --------------------------------------------------------------------------- //
// PDF — download + extração (pdfjs-dist legacy build, sem binário nativo)     //
// --------------------------------------------------------------------------- //
let _pdfjsPromise = null;
function pdfjs() {
  if (!_pdfjsPromise) _pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjsPromise;
}

let ultimoDownloadPdfEm = 0;
let lockDownloadPdf = Promise.resolve();

async function baixarPdf(url) {
  const liberar = lockDownloadPdf;
  let resolverProxima;
  lockDownloadPdf = new Promise((res) => {
    resolverProxima = res;
  });
  await liberar;
  try {
    const espera = L.ESPACAMENTO_MIN_PDF_S * 1000 - (Date.now() - ultimoDownloadPdfEm);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimoDownloadPdfEm = Date.now();
    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 45_000);
        let r;
        try {
          r = await fetch(url, { headers: L.HEADERS_BASE, redirect: "follow", signal: ctrl.signal });
        } finally {
          clearTimeout(t);
        }
        L.exigirHostDePdf(r.url, "o destino final do redirect");
        if (r.status >= 400) throw new L.LeituraPdfFalhou(`o host do PDF respondeu HTTP ${r.status} para ${url}`);
        const cl = r.headers.get("content-length");
        if (cl && Number.isFinite(Number(cl)) && Number(cl) > L.TETO_BYTES_PDF) {
          throw new L.LeituraPdfFalhou(
            `PDF anunciado com ${L.num(cl)} bytes, acima do teto de ${L.num(L.TETO_BYTES_PDF)} bytes ` +
              "desta ferramenta — não baixado; abra o link no navegador."
          );
        }
        const reader = r.body.getReader();
        const partes = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > L.TETO_BYTES_PDF) {
            throw new L.LeituraPdfFalhou(
              `PDF acima do teto de ${L.num(L.TETO_BYTES_PDF)} bytes desta ferramenta durante o download ` +
                "— não baixado por completo; abra o link no navegador."
            );
          }
          partes.push(value);
        }
        return Buffer.concat(partes.map((p) => Buffer.from(p)));
      } catch (e) {
        ultimoErro = e;
        if (e instanceof L.LeituraPdfFalhou) throw e;
        if (tentativa === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
    }
    throw new L.LeituraPdfFalhou(`falha ao baixar o PDF: ${ultimoErro?.message || ultimoErro}`);
  } finally {
    resolverProxima();
  }
}

// Bindings mutáveis — em produção apontam para as funções reais acima; o harness de paridade
// (test/paridade.py) e testes Node trocam por mocks de fixtures via _setDepsParaTeste, sem
// tocar rede e sem duplicar a lógica de buscar/obterAcordao/verificarCitacao.
let _consultarApiImpl = consultarApi;
let _baixarPdfImpl = baixarPdf;

async function extrairTextoPdf(conteudo, tetoPaginas = L.TETO_PAGINAS_PDF, prazoS = L.TETO_SEGUNDOS_PDF) {
  let doc;
  try {
    // verbosity: 0 é OBRIGATÓRIO aqui, não cosmético: pdfjs-dist escreve avisos ("Warning: ...")
    // em console.log por padrão, e o transporte MCP por stdio exige que stdout carregue só
    // JSON-RPC — um aviso solto no meio quebra o parser do cliente (medido no smoke test:
    // "Warning: TT: undefined function: 32" corrompeu a resposta de obter_acordao_tcero).
    const { getDocument } = await pdfjs();
    doc = await getDocument({
      data: new Uint8Array(conteudo),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    return L.vazioExtracao(`${e.name || "Error"}: ${e.message}`);
  }
  const comecouEm = Date.now();
  let parcial = false;
  let motivoParcial = null;
  let paginasSemTexto = 0;
  const paginas = doc.numPages;
  const partes = [];
  try {
    for (let i = 1; i <= paginas; i++) {
      if (i - 1 >= tetoPaginas) {
        parcial = true;
        motivoParcial = `extração parada em ${tetoPaginas} páginas (teto desta ferramenta) de um documento com ${paginas}`;
        break;
      }
      if ((Date.now() - comecouEm) / 1000 > prazoS) {
        parcial = true;
        motivoParcial = `extração parada em ${i - 1} de ${paginas} páginas ao passar do prazo de ${prazoS.toFixed(0)}s desta ferramenta`;
        break;
      }
      const pagina = await doc.getPage(i);
      const conteudoTexto = await pagina.getTextContent();
      // NÃO junta com " " entre todo item: cada item já carrega o espaço que lhe pertence (é
      // assim que o pdf.js segmenta o conteúdo), e juntar com espaço extra duplicava/triplicava
      // espaços que o PyMuPDF (usado no Python) não tem — divergência real medida no harness de
      // paridade (test/paridade.py, v1.2.0). `hasEOL` marca fim de linha, o equivalente ao '\n'
      // que o PyMuPDF já insere entre linhas — sem isso, palavras de linhas diferentes colavam
      // ("JulgamentoDP-SPJ").
      let tPagina = "";
      for (const it of conteudoTexto.items) {
        tPagina += it.str;
        if (it.hasEOL) tPagina += "\n";
      }
      if (tPagina.replace(/\s/g, "").length < L.LIMIAR_CHARS_POR_PAGINA) paginasSemTexto++;
      partes.push(tPagina);
    }
  } catch (e) {
    return L.vazioExtracao(`${e.name || "Error"}: ${e.message}`);
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
  const texto = partes.join("\n");
  const lidas = partes.length;
  if (parcial && lidas === 0) return L.vazioExtracao(motivoParcial);
  const charsNaoEspaco = texto.replace(/\s/g, "").length;
  const semTexto = charsNaoEspaco < L.LIMIAR_CHARS_POR_PAGINA * Math.max(1, lidas);
  return {
    texto: semTexto ? "" : texto,
    paginas,
    paginas_lidas: lidas,
    paginas_sem_texto: paginasSemTexto,
    chars_nao_espaco: charsNaoEspaco,
    sem_texto: semTexto,
    parcial,
    motivo_parcial: motivoParcial,
    erro: null,
  };
}

// Cache do texto extraído por id_decisao/link, TTL 1h — mesma disciplina do Python.
const CACHE_PDF_TTL_MS = 60 * 60_000;
const CACHE_PDF_MAX = 24;
const cachePdf = new Map();

function cachePdfLer(chave) {
  const item = cachePdf.get(chave);
  if (!item) return null;
  if (Date.now() - item.quando > CACHE_PDF_TTL_MS) {
    cachePdf.delete(chave);
    return null;
  }
  return item.dados;
}
function cachePdfGravar(chave, dados) {
  while (cachePdf.size >= CACHE_PDF_MAX) cachePdf.delete(cachePdf.keys().next().value);
  cachePdf.set(chave, { quando: Date.now(), dados });
}

async function lerInteiroTeorPdf(s, orcamento = L.ORCAMENTO_PDF) {
  const link = L.corrigirLinkPdf(s.linkArquivo || "");
  if (!link) {
    return [
      "\nLeitura do inteiro teor (PDF): este acórdão não tem `linkArquivo` informado pelo " +
        "portal — sem link não há como baixar o PDF automaticamente.",
    ];
  }
  let rotulo = [s.sigla, s.numero].filter(Boolean).join(" ");
  rotulo = rotulo ? `${rotulo}, id ${s.idDecisao}` : `id ${s.idDecisao}`;
  if (orcamento < 2000) {
    return [
      `\n[INTEIRO TEOR (PDF) NÃO EXIBIDO — o detalhe desta decisão já consumiu a resposta ` +
        `(sobraram ${L.num(Math.max(0, orcamento))} caracteres do teto de ${L.num(L.ORCAMENTO_SAIDA)}). ` +
        "O PDF não foi nem baixado. Abra o link do inteiro teor acima no navegador.]",
    ];
  }
  const chave = chaveCachePdfSemCrypto(s, link);
  const emCache = cachePdfLer(chave);
  if (emCache !== null) {
    const linhas = L.blocoInteiroTeorPdf(emCache, orcamento, rotulo);
    linhas.push("\n(PDF já baixado nesta sessão — reaproveitado do cache, sem nova requisição de rede.)");
    return linhas;
  }
  let conteudo;
  try {
    conteudo = await _baixarPdfImpl(link);
  } catch (e) {
    return [`\n[LEITURA DE PDF NÃO REALIZADA — ${e.message}]`];
  }
  const resultado = await extrairTextoPdf(conteudo);
  if (resultado.erro) {
    return [`\n[LEITURA DE PDF NÃO REALIZADA — falha ao ler o PDF (${resultado.erro})]`];
  }
  cachePdfGravar(chave, resultado);
  return L.blocoInteiroTeorPdf(resultado, orcamento, rotulo);
}

function chaveCachePdfSemCrypto(s, link) {
  if (s.idDecisao !== null && s.idDecisao !== undefined) return `id:${s.idDecisao}`;
  return `link:${Buffer.from(link).toString("base64")}`;
}

async function textoPdfParaRecibo(s) {
  const link = L.corrigirLinkPdf(s.linkArquivo || "");
  if (!link) return [null, null];
  const chave = chaveCachePdfSemCrypto(s, link);
  let resultado = cachePdfLer(chave);
  if (resultado === null) {
    let conteudo;
    try {
      conteudo = await _baixarPdfImpl(link);
    } catch {
      return [null, null];
    }
    resultado = await extrairTextoPdf(conteudo);
    if (resultado.erro) return [null, null];
    cachePdfGravar(chave, resultado);
  }
  if (resultado.sem_texto) return [null, false];
  return [resultado.texto || null, !resultado.parcial];
}

// --------------------------------------------------------------------------- //
// Relatores / órgão julgador                                                  //
// --------------------------------------------------------------------------- //
const CACHE_RELATORES_TTL_MS = 60 * 60_000;
let cacheRelatores = null; // { quando, lista }

async function relatoresConhecidos(operacao) {
  if (cacheRelatores && Date.now() - cacheRelatores.quando <= CACHE_RELATORES_TTL_MS) {
    return [cacheRelatores.lista, null];
  }
  try {
    const r = await getComRetentativa(L.ENDPOINT_RELATORES, {}, operacao);
    const lista = await r.json();
    if (!Array.isArray(lista)) return [cacheRelatores ? cacheRelatores.lista : [], "/api/busca/relatores não devolveu uma lista"];
    cacheRelatores = { quando: Date.now(), lista };
    return [lista, null];
  } catch (e) {
    return [cacheRelatores ? cacheRelatores.lista : [], `${e.name || "Error"}: ${e.message}`];
  }
}

class FiltroAmbiguo extends Error {}

async function resolverRelator(relator, operacao) {
  const alvo = L.fold(relator);
  const [lista, erro] = await relatoresConhecidos(operacao);
  for (const item of lista) {
    const nome = item.nome || "";
    if (L.fold(nome) === alvo) return [nome, null];
  }
  const candidatos = lista.map((i) => i.nome || "").filter((nome) => alvo && L.fold(nome).includes(alvo));
  if (candidatos.length === 1) {
    return [
      candidatos[0],
      `relator ${L.pyRepr(relator)} não bateu exatamente com a lista conhecida — usando ` +
        `${L.pyRepr(candidatos[0])} (único nome compatível)`,
    ];
  }
  if (candidatos.length > 1) {
    throw new FiltroAmbiguo(
      `relator ${L.pyRepr(relator)} casa com ${candidatos.length} nomes da lista do portal: ` +
        candidatos.map((c) => L.pyRepr(c)).join("; ") +
        ". A busca exige o nome EXATO e escolher um por conta própria devolveria a " +
        "jurisprudência de outro conselheiro — repita informando o nome completo."
    );
  }
  if (erro) {
    return [
      relator,
      `[VERIFICAÇÃO NÃO REALIZADA] não foi possível consultar /api/busca/relatores (${erro}) ` +
        `— o nome ${L.pyRepr(relator)} foi enviado como veio, SEM conferência de grafia. Zero resultado ` +
        "aqui não significa 'não há jurisprudência desse relator'",
    ];
  }
  return [
    relator,
    `relator ${L.pyRepr(relator)} não está na lista de ${lista.length} nome(s) que o portal expõe em ` +
      "/api/busca/relatores (pode ser uma lista parcial/desatualizada); a busca exige o nome " +
      "EXATO — se vier zero resultado, confira grafia e acentuação",
  ];
}

function resolverOrgao(orgao) {
  const alvo = L.fold(orgao);
  for (const conhecido of L.ORGAOS_JULGADORES_CONHECIDOS) {
    if (L.fold(conhecido) === alvo) return [conhecido, null];
  }
  return [
    orgao,
    `orgao_julgador ${L.pyRepr(orgao)} não é um dos ${L.pyRepr(L.ORGAOS_JULGADORES_CONHECIDOS)} (única lista ` +
      "encontrada, hardcoded no frontend do portal — não há endpoint de descoberta); a busca " +
      "exige o valor EXATO — se vier zero resultado, é provável que seja isso",
  ];
}

// --------------------------------------------------------------------------- //
// Implementação das ferramentas                                               //
// --------------------------------------------------------------------------- //
async function buscar(textoLivre, numeroAcordao, numeroProcesso, relator, orgaoJulgador, pagina, porPagina, detalhar, grupos, ordenar = "relevancia") {
  if (ordenar !== "data" && ordenar !== "relevancia") {
    return `ordenar inválido: ${L.pyRepr(ordenar)}; use 'data' ou 'relevancia'. Nenhuma requisição foi feita.`;
  }
  const avisos = [];
  const filtrosNaoResolvidos = [];
  const gruposOk = L.gruposValidos(grupos);
  const params = {};
  const textoLivreCombinado = L.montarTextoLivreComGrupos(textoLivre, gruposOk);
  if (textoLivreCombinado) params.textoLivre = textoLivreCombinado;
  if (L.texto(numeroAcordao)) params.numeroAcordao = L.padronizarNumero(L.texto(numeroAcordao));
  if (L.texto(numeroProcesso)) params.numeroProcesso = L.padronizarNumero(L.texto(numeroProcesso));

  let dados;
  try {
    if (!Object.keys(params).length && !L.texto(relator) && !L.texto(orgaoJulgador)) {
      return (
        "Informe pelo menos um critério: texto_livre, grupos, numero_acordao, " +
        "numero_processo, relator ou orgao_julgador. Uma busca sem nenhum filtro " +
        "devolveria o acervo inteiro."
      );
    }
    pagina = Math.max(1, parseInt(pagina, 10) || 1);
    porPagina = parseInt(porPagina, 10) || L.POR_PAGINA_PADRAO;
    if (!(porPagina >= 1 && porPagina <= L.POR_PAGINA_MAX)) {
      throw new Error(`por_pagina inválido: ${porPagina}; use de 1 a ${L.POR_PAGINA_MAX}`);
    }
    if (detalhar && porPagina > L.TETO_DETALHAR_NA_BUSCA) {
      avisos.push(
        `detalhar=true só se aplica aos primeiros ${L.TETO_DETALHAR_NA_BUSCA} itens desta ` +
          `página (pedidos: ${porPagina}) — para os demais, use obter_acordao_tcero(id_decisao=...)`
      );
    }
    if (L.texto(relator)) {
      const [nome, aviso] = await resolverRelator(L.texto(relator), "busca");
      params.relatores = nome;
      if (aviso) {
        avisos.push(aviso);
        filtrosNaoResolvidos.push(`relator=${L.pyRepr(nome)}`);
      }
    }
    if (L.texto(orgaoJulgador)) {
      const [nomeO, avisoO] = resolverOrgao(L.texto(orgaoJulgador));
      params.orgaosJulgadores = nomeO;
      if (avisoO) {
        avisos.push(avisoO);
        filtrosNaoResolvidos.push(`orgao_julgador=${L.pyRepr(nomeO)}`);
      }
    }
    dados = await _consultarApiImpl(params, "busca");
  } catch (e) {
    return formatarErroPortal(e, "Erro na consulta ao TCE-RO");
  }

  const todosBrutos = dados.result || [];
  let avisosIaPorId = {};
  let todos, totalBruto;
  if (gruposOk.length) {
    totalBruto = todosBrutos.length;
    [todos, avisosIaPorId] = L.filtrarPorGrupos(todosBrutos, gruposOk);
  } else {
    totalBruto = null;
    todos = todosBrutos;
  }
  const termosRelevancia = ordenar === "relevancia" ? L.termosDaConsulta(textoLivre, gruposOk) : [];
  if (ordenar === "relevancia" && termosRelevancia.length) {
    todos = L.ordenarPorRelevancia(todos, termosRelevancia);
  }
  const total = todos.length;
  const inicio = (pagina - 1) * porPagina;
  const paginaItens = todos.slice(inicio, inicio + porPagina);
  const totalPaginas = total ? Math.max(1, Math.ceil(total / porPagina)) : 1;

  const linhas = [];
  const filtrosTxt = L.truncar(
    Object.entries(params).map(([k, v]) => `${k}=${v}`).join("; "),
    300
  );
  let ordemTxt;
  if (ordenar === "relevancia" && termosRelevancia.length) {
    ordemTxt = "por relevância (offline, termos da consulta)";
  } else if (ordenar === "relevancia") {
    // Red team 22/09/2026-b, achado 5: só relator/órgão/número não dá termo para pontuar — a
    // ordem é a do portal, e o cabeçalho não pode dizer "por relevância".
    ordemTxt = "por data (padrão do portal — sem termo de texto para pontuar relevância)";
  } else {
    ordemTxt = "por data (padrão do portal)";
  }
  if (gruposOk.length) {
    linhas.push(
      `**${totalBruto} decisão(ões)** no portal ePapyrus/TCE-RO (OU nativo) para ` +
        `\`${filtrosTxt}\` → **${total}** após exigir todos os ${gruposOk.length} grupo(s) · ` +
        `página ${pagina}/${totalPaginas} (${porPagina} por página) · ordenado ${ordemTxt}`
    );
  } else {
    linhas.push(`**${total} decisão(ões)** no portal ePapyrus/TCE-RO para \`${filtrosTxt}\` · página ${pagina}/${totalPaginas} (${porPagina} por página) · ordenado ${ordemTxt}`);
  }
  for (const a of avisos) linhas.push(`⚠️ ${a}`);
  if ((gruposOk.length ? totalBruto : total) > 200 && pagina === 1) {
    linhas.push(
      "Dica: total alto — a API do TCE-RO não pagina no servidor (tudo já foi baixado e " +
        "cacheado aqui por alguns minutos); restrinja com número de processo/acórdão, " +
        "relator, órgão julgador ou `grupos` para uma busca mais direta."
    );
  }
  if (total === 0 && filtrosNaoResolvidos.length) {
    linhas.push(
      "\n⛔ ZERO resultados COM filtro não reconhecido (" + filtrosNaoResolvidos.join("; ") + "). " +
        "Trate isto como **FILTRO INVÁLIDO, não como 'não há jurisprudência'** — o portal exige " +
        "o valor EXATO e devolve vazio, sem erro, para qualquer valor fora da lista. Corrija o " +
        "filtro e repita antes de concluir qualquer coisa sobre o acervo."
    );
    return linhas.join("\n");
  }
  if (!paginaItens.length) {
    if (total === 0 && gruposOk.length && totalBruto) {
      linhas.push(
        `\nNenhuma decisão casou TODOS os ${gruposOk.length} grupo(s) exigido(s) — havia ` +
          `${totalBruto} decisão(ões) no portal via OU nativo (qualquer termo de qualquer ` +
          "grupo). Considere adicionar sinônimos a um grupo, remover um grupo, ou revisar " +
          "manualmente com texto_livre solto (sem grupos)."
      );
    } else {
      linhas.push(
        "\nNenhuma decisão nesta página." +
          (total === 0 ? " A busca casa palavras/valores; confira grafia, acentuação e se o total acima é 0." : " A página pedida está além do fim.")
      );
    }
    return linhas.join("\n");
  }

  for (let idx = 0; idx < paginaItens.length; idx++) {
    const item = paginaItens[idx];
    const i = inicio + idx + 1;
    const s = item.source || {};
    if (detalhar && idx < L.TETO_DETALHAR_NA_BUSCA) {
      linhas.push(...L.detalheItem(s));
    } else {
      linhas.push(...L.resumoItem(s, i));
    }
    if (ordenar === "relevancia" && termosRelevancia.length) {
      const [pts, noNucleo] = L.pontuarRelevancia(s, termosRelevancia);
      const soIa = pts - 2 * noNucleo;
      linhas.push(
        `  termos casados: ${noNucleo}/${termosRelevancia.length} (núcleo: ementa+dispositivo)` +
          (soIa ? ` · +${soIa} só em informações adicionais (IA)` : "")
      );
    }
    const gruposSoIa = avisosIaPorId[s.idDecisao];
    if (gruposSoIa && gruposSoIa.length) {
      const rotulo = gruposSoIa.map((n) => `grupo ${n + 1}`).join(", ");
      linhas.push(
        `  ⚠️ ${rotulo} só encontrado em informações adicionais (texto de apoio gerado ` +
          "com IA pelo DEJUR) — não está na ementa nem no dispositivo desta decisão."
      );
    }
  }
  if (!detalhar) {
    linhas.push(
      "\nEmentas truncadas (o link do PDF acima de cada item já é o inteiro teor completo). " +
        "Para o texto integral da ementa, dispositivo e informações adicionais de um item " +
        "específico: obter_acordao_tcero(id_decisao=<id acima>)."
    );
  }
  if (total > pagina * porPagina) linhas.push(`\nPróxima página: pagina=${pagina + 1} (mesmos parâmetros).`);
  if (pagina === 1 && total >= 3) linhas.push(...L.blocoPanorama(todos, Boolean(gruposOk.length)));
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta da busca").join("\n");
}

async function obterAcordao(idDecisao, numeroAcordao, numeroProcesso, lerInteiroTeor) {
  const idTxt = L.texto(idDecisao);
  const acTxt = L.texto(numeroAcordao);
  const procTxt = L.texto(numeroProcesso);
  if (!idTxt && !acTxt && !procTxt) {
    return "Informe id_decisao (mais direto), ou numero_acordao, ou numero_processo.";
  }
  let dados;
  try {
    if (idTxt) {
      dados = await _consultarApiImpl({ IdDecisao: idTxt, filtrarResultados: "false" }, "detalhe");
    } else {
      const params = {};
      if (acTxt) params.numeroAcordao = L.padronizarNumero(acTxt);
      if (procTxt) params.numeroProcesso = L.padronizarNumero(procTxt);
      dados = await _consultarApiImpl(params, "detalhe");
    }
  } catch (e) {
    return formatarErroPortal(e, "Erro na consulta ao TCE-RO");
  }

  const resultados = dados.result || [];
  if (!resultados.length) {
    const alvo = idTxt || acTxt || procTxt;
    return `Nenhuma decisão encontrada para ${L.pyRepr(alvo)} no portal do TCE-RO. Confira o número/id.`;
  }
  const linhas = [];
  if (resultados.length > 1) {
    linhas.push(
      `**${resultados.length} decisões encontradas** sob esse número — o mesmo número de ` +
        "acórdão pode ter mais de um `idDecisao` no portal (achado real, 13/09/2026). " +
        "Identifique pelo id antes de citar:"
    );
    for (const item of resultados.slice(0, L.TETO_ITENS_LISTADOS)) {
      const s = item.source || {};
      const dj = L.dataBr(s.dataSessao || "") || `registro ${L.dataBr(s.data || "") || "?"}`;
      linhas.push(`- id ${s.idDecisao} · ${s.sigla || "?"} ${s.numero || "?"} · ${dj} · Rel. ${s.relator || "?"} · ${s.orgaoJulgador || "?"}`);
    }
    if (resultados.length > L.TETO_ITENS_LISTADOS) {
      linhas.push(
        `- … e mais ${resultados.length - L.TETO_ITENS_LISTADOS} decisão(ões) não listadas aqui. ` +
          "Total alto assim quase sempre é filtro amplo demais (ex.: número de processo com " +
          "muitas decisões) — restrinja pelo número do acórdão ou use " +
          "buscar_jurisprudencia_tcero, que pagina."
      );
    }
    linhas.push("\nChame de novo com obter_acordao_tcero(id_decisao=<id acima>) para o detalhe de cada um. Mostrando o primeiro:");
  }
  const s0 = resultados[0].source || {};
  linhas.push(...L.detalheItem(s0));
  if (lerInteiroTeor) {
    const RESERVA_BLOCO_PDF = 1500;
    const usado = linhas.reduce((acc, l) => acc + l.length + 1, 0);
    const sobra = Math.min(L.ORCAMENTO_PDF, L.ORCAMENTO_SAIDA - usado - RESERVA_BLOCO_PDF);
    linhas.push(...(await lerInteiroTeorPdf(s0, sobra)));
    const [textoPdf, pdfCompleto] = await textoPdfParaRecibo(s0);
    L.gravarReciboTcero(s0, { textoPdf, textoPdfCompleto: pdfCompleto, gravadoEm: agoraIso() });
  } else {
    L.gravarReciboTcero(s0, { gravadoEm: agoraIso() });
  }
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta de obter_acordao").join("\n");
}

// Equivalente a time.strftime("%Y-%m-%dT%H:%M:%S%z") do Python: hora local com offset numérico.
function agoraIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sinal = offMin >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(offMin) / 60));
  const offM = pad(Math.abs(offMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sinal}${offH}${offM}`
  );
}

async function verificarCitacao(idDecisao, numeroAcordao, trecho) {
  if (!L.texto(trecho)) return "Informe o trecho que pretende citar entre aspas.";
  const idTxt = L.texto(idDecisao);
  const acTxt = L.texto(numeroAcordao);
  if (!idTxt && !acTxt) return "Informe id_decisao (preferível) ou numero_acordao.";

  if (idTxt) {
    const recibo = L.lerReciboTcero(idTxt);
    if (recibo !== null) {
      const sRecibo = { idDecisao: recibo.id_documento, sigla: recibo.sigla, numero: recibo.numero };
      const textos = { "texto (recibo: ementa + dispositivo + PDF quando lido)": recibo.texto || "" };
      const linhas = [
        `Fonte do texto conferido: RECIBO local (gravado em ${recibo.gravado_em || "?"}, ` +
          "zero requisição ao portal — ver diagnostico_ritmo_tcero para o disjuntor não ter sido tocado).",
      ];
      linhas.push(...L.linhasVerificacaoItem(sRecibo, trecho, textos));
      const rodapeRecibo =
        "\nCobre ementa + dispositivo + (quando já lido com ler_inteiro_teor=true) o inteiro teor em " +
        "PDF — NÃO as \"informações adicionais\" (IA do DEJUR). Comparação tolerante a caixa, acento, " +
        "pontuação e espaço, casamento por PALAVRA INTEIRA; `[...]` separa fragmentos em ordem. Se ❌: " +
        "não cite entre aspas. Recibo desatualizado? Rode obter_acordao_tcero(id_decisao=...) de novo " +
        "para regravá-lo.";
      return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta de verificar_citacao").join("\n") + rodapeRecibo;
    }
  }

  let dados;
  try {
    if (idTxt) {
      dados = await _consultarApiImpl({ IdDecisao: idTxt, filtrarResultados: "false" }, "verificacao");
    } else {
      dados = await _consultarApiImpl({ numeroAcordao: L.padronizarNumero(acTxt) }, "verificacao");
    }
  } catch (e) {
    return formatarErroPortal(e, "Erro na consulta ao TCE-RO");
  }

  const resultados = dados.result || [];
  if (!resultados.length) {
    const alvo = idTxt || acTxt;
    return `Nenhuma decisão sob ${L.pyRepr(alvo)} — não há como verificar; não cite.`;
  }
  const linhas = ["Fonte do texto conferido: PORTAL (sem recibo local para conferir sem rede; obter_acordao_tcero grava um)."];
  if (resultados.length > 1) {
    linhas.push(
      `⚠️ ${Math.min(resultados.length, L.TETO_DECISOES_VERIFICADAS)} de ${resultados.length} decisões sob ` +
        `${L.pyRepr(acTxt || idTxt)} conferidas — o mesmo número de acórdão cobre decisões de ` +
        "processos e órgãos diferentes no TCE-RO. Um ✅ abaixo vale só para o id daquela linha."
    );
  }
  for (const item of resultados.slice(0, L.TETO_DECISOES_VERIFICADAS)) {
    const s = item.source || {};
    const textos = {
      ementa: L.ementaLimpa(s),
      "dispositivo (acordaoDescricao)": L.htmlParaTexto(s.acordaoDescricao || ""),
    };
    linhas.push(...L.linhasVerificacaoItem(s, trecho, textos));
  }
  if (resultados.length > L.TETO_DECISOES_VERIFICADAS) {
    linhas.push(
      `… e mais ${resultados.length - L.TETO_DECISOES_VERIFICADAS} decisão(ões) NÃO conferidas ` +
        "(teto de saída). Informe id_decisao para conferir uma decisão específica."
    );
  }
  const rodape =
    "\nCobre ementa e dispositivo (`acordaoDescricao`, quando o portal o preenche) — NÃO o " +
    "inteiro teor em PDF nem as \"informações adicionais\" (geradas por IA, não citáveis " +
    "como texto do acórdão). Comparação tolerante a caixa, acento, pontuação e espaço, " +
    "casamento por PALAVRA INTEIRA; `[...]` separa fragmentos em ordem. Se ❌: não cite " +
    "entre aspas — parafraseie, ou confira o inteiro teor no PDF. Se vier ⚠️ NÃO " +
    "VERIFICÁVEL, o portal não trouxe texto algum para esta decisão — isso NÃO é o mesmo " +
    "que 'o trecho não existe'. ✅ com alerta de atribuição: o trecho é literal, mas pode " +
    "não ser a posição da Corte — ver a linha de alerta.";
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta de verificar_citacao").join("\n") + rodape;
}

// --------------------------------------------------------------------------- //
// MCP server                                                                   //
// --------------------------------------------------------------------------- //
const server = new McpServer({ name: "Jurisprudência TCE-RO", version: L.VERSAO });
iniciarChecagemVersao();

server.registerTool(
  "buscar_jurisprudencia_tcero",
  {
    title: "Buscar jurisprudência do TCE-RO",
    description:
      "Pesquisa jurisprudência do TCE-RO (Tribunal de Contas do Estado de Rondônia) no portal oficial " +
      "ePapyrus (papyrus.tcero.tc.br), sem login. Fonte dos precedentes de controle externo em Rondônia " +
      "— licitação, prestação de contas, responsabilização de gestor, imputação de multa/débito, atos de " +
      "pessoal sujeitos a registro. Informe pelo menos um critério (texto_livre, grupos, numero_acordao, " +
      "numero_processo, relator ou orgao_julgador). A API do portal NÃO pagina no servidor; esta ferramenta " +
      "pagina no CLIENTE e cacheia a resposta crua por alguns minutos. Por padrão devolve um resumo " +
      "compacto; use detalhar=true (só para os primeiros 5 itens da página) ou obter_acordao_tcero para o " +
      "texto integral. USE `grupos` sempre que a busca envolver 2+ CONCEITOS: o portal só sabe fazer OU e " +
      "ordena por data (não por relevância) — sem `grupos`, um agente que lê só a 1ª página de uma busca " +
      "de dois conceitos está lendo praticamente ruído. O portal não tem nenhuma forma conhecida de E " +
      "(nem 'AND', nem '+termo') — a única forma nativa de exigir mais de uma palavra é a frase exata " +
      "entre aspas; para 2+ conceitos, use `grupos` (filtro no cliente). Por padrão (ordenar=" +
      "\"relevancia\") os resultados são reordenados OFFLINE por quantos termos distintos da " +
      "consulta cada decisão contém (ementa+dispositivo pesam 2, informações adicionais de IA " +
      "pesam 1) — medição real mostrou recall@10 subindo de 2% (ordem por data) para 62-72%; " +
      "peça ordenar=\"data\" para a ordem cronológica pura do portal. Com 3+ decisões, a página 1 " +
      "termina com um Panorama offline (órgão, ano, sigla, natureza, top-5 relatores).",
    inputSchema: {
      texto_livre: z.string().default("").describe("Busca por texto no corpo/ementa/informações adicionais. Sempre OU entre termos soltos (não E). Frase entre aspas exige a ordem exata."),
      grupos: z
        .array(z.array(z.string()))
        .optional()
        .describe(
          "Grupos de sinônimos/conceitos — OU dentro do grupo, E entre grupos (filtrado NO CLIENTE, " +
            "não existe E nativo no portal). Ex.: [[\"reincidência\"],[\"multa\",\"imputação de multa\"]]. " +
            `Até ${L.GRUPOS_MAX} grupos × ${L.TERMOS_POR_GRUPO_MAX} termos.`
        ),
      numero_acordao: z.string().optional().describe('Número do acórdão (ex.: "00055/26" ou "55/26" — zero-preenchido automaticamente para 8 caracteres).'),
      numero_processo: z.string().optional().describe('Número do processo administrativo (ex.: "02603/22" ou "2603/22").'),
      relator: z.string().optional().describe("Nome do relator — a API exige o nome EXATO; esta ferramenta tenta aproximar pela lista de /api/busca/relatores."),
      orgao_julgador: z.string().optional().describe('Um dos valores exatos: "1ª Câmara", "2ª Câmara" ou "Pleno".'),
      pagina: z.number().int().optional().describe("Página de resultados (1+)."),
      por_pagina: z.number().int().optional().describe("Itens por página (1 a 50, padrão 10)."),
      detalhar: z.boolean().optional().describe("Se true, os primeiros itens (até 5) vêm com ementa integral, dispositivo, informações adicionais e link do PDF."),
      ordenar: z
        .enum(["relevancia", "data"])
        .optional()
        .describe(
          '"relevancia" (PADRÃO quando há texto_livre/grupos) ordena offline por termos distintos ' +
            "casados (núcleo pesa 2, informações adicionais de IA pesam 1), desempatando por data; " +
            '"data" é a ordem nativa do portal (mais recente primeiro). Sem texto_livre nem grupos, ' +
            '"relevancia" se comporta como "data" (não há termo para pontuar).'
        ),
    },
  },
  async (a) => {
    try {
      const texto = await buscar(
        a.texto_livre ?? "",
        a.numero_acordao ?? null,
        a.numero_processo ?? null,
        a.relator ?? null,
        a.orgao_julgador ?? null,
        a.pagina ?? 1,
        a.por_pagina ?? L.POR_PAGINA_PADRAO,
        !!a.detalhar,
        a.grupos ?? null,
        a.ordenar ?? "relevancia"
      );
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "obter_acordao_tcero",
  {
    title: "Obter acórdão do TCE-RO",
    description:
      "Traz o detalhe COMPLETO de uma decisão do TCE-RO: ementa integral, dispositivo (`acordaoDescricao`), " +
      "informações adicionais (⚠️ geradas com apoio de IA pelo DEJUR do tribunal — nunca fonte primária " +
      "isolada), legislação aplicada, link do PDF do inteiro teor, e avisos de cancelamento/vínculo. " +
      "Use antes de citar qualquer decisão devolvida por buscar_jurisprudencia_tcero. Com " +
      "ler_inteiro_teor=true, baixa o PDF e extrai relatório e voto completos — categoria de verificação " +
      "mais forte que ementa/dispositivo; se o PDF for digitalizado (sem texto), a extração parar num teto " +
      "de páginas/tempo, ou o texto não couber no orçamento de saída, isso é dito explicitamente, nunca " +
      'disfarçado de "inteiro teor lido".',
    inputSchema: {
      id_decisao: z.union([z.number(), z.string()]).optional().describe("Id numérico da decisão (`idDecisao`) — o jeito mais direto e confiável."),
      numero_acordao: z.string().optional().describe('Número do acórdão (ex.: "00055/26"), se não tiver o id.'),
      numero_processo: z.string().optional().describe("Número do processo administrativo, se não tiver o id nem o número do acórdão."),
      ler_inteiro_teor: z.boolean().optional().describe("Se true, baixa e extrai o texto do PDF do inteiro teor (relatório + voto completos)."),
    },
  },
  async (a) => {
    try {
      const texto = await obterAcordao(a.id_decisao ?? null, a.numero_acordao ?? null, a.numero_processo ?? null, !!a.ler_inteiro_teor);
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "verificar_citacao_tcero",
  {
    title: "Verificar citação do TCE-RO",
    description:
      "Confere se um trecho aparece LITERALMENTE na ementa ou no dispositivo (`acordaoDescricao`) de uma " +
      "decisão do TCE-RO, antes de ir entre aspas para a peça. Com id_decisao, confere primeiro contra o " +
      "recibo local (zero requisição) quando ele existe. Comparação tolerante a caixa/acento/pontuação/" +
      "espaço, casamento por PALAVRA INTEIRA; `[...]` separa fragmentos em ordem. Alerta quando o trecho, " +
      "embora literal, pode não ser a posição da própria Corte (parecer do MPC/corpo técnico, alegação da " +
      "parte, transcrição de outro tribunal, negação próxima, trecho entre aspas). NÃO cobre as " +
      '"informações adicionais" (IA) nem o inteiro teor em PDF ainda não lido.',
    inputSchema: {
      trecho: z.string().describe("Texto que se pretende citar entre aspas (cortes marcados com [...])."),
      id_decisao: z.union([z.number(), z.string()]).optional().describe("Id numérico da decisão — preferível."),
      numero_acordao: z.string().optional().describe("Número do acórdão, se não tiver o id."),
    },
  },
  async (a) => {
    try {
      const texto = await verificarCitacao(a.id_decisao ?? null, a.numero_acordao ?? null, a.trecho);
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "diagnostico_ritmo_tcero",
  {
    title: "Diagnóstico do controle de ritmo (TCE-RO)",
    description:
      "Mostra por que as buscas do TCE-RO podem estar falhando: nível atual do limite de ritmo " +
      "(auto-imposto), orçamento consumido, se há bloqueio em curso e o histórico de incidentes. " +
      "Não faz nenhuma requisição.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: L.finalizarSaida(L.diagnosticoRitmo()) }] })
);

// Só conecta o transporte quando executado diretamente (`node server/index.js`), nunca quando
// importado — necessário para o harness de paridade (test/paridade.py) e para testes Node
// importarem `buscar`/`obterAcordao`/`verificarCitacao` sem subir um servidor MCP de verdade.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// --------------------------------------------------------------------------- //
// Injeção de dependências de rede — só para testes/harness de paridade (nunca  //
// usado no caminho de produção real). Permite trocar `consultarApi`/          //
// `baixarPdf` por fixtures sem tocar a rede, sem duplicar a lógica de         //
// `buscar`/`obterAcordao`/`verificarCitacao`.                                 //
// --------------------------------------------------------------------------- //
export function _setDepsParaTeste({ consultarApi: novoConsultarApi, baixarPdf: novoBaixarPdf } = {}) {
  if (novoConsultarApi) _consultarApiImpl = novoConsultarApi;
  if (novoBaixarPdf) _baixarPdfImpl = novoBaixarPdf;
}
export function _resetDepsParaTeste() {
  _consultarApiImpl = consultarApi;
  _baixarPdfImpl = baixarPdf;
}
export { buscar, obterAcordao, verificarCitacao };
