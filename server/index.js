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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.js";
import * as V from "./v160.js";
import * as V7 from "./v170.js";
import { checarSemanal } from "./semana.js";
import os from "node:os";
import { baixarAtualizacao, textoAtualizacao, ErroAtualizacao } from "./atualizar.js";

// --------------------------------------------------------------------------- //
// Checagem de versão nova — dispara em 2º plano, nunca aguardada.             //
// --------------------------------------------------------------------------- //
async function consultarUltimaTag(timeoutMs = 5000) {
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
    return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(tagLimpa) ? tagLimpa : null;
  } catch {
    return null;
  }
}

function iniciarChecagemVersao() {
  if (L.estadoVersao.tarefaIniciada) return;
  L.estadoVersao.tarefaIniciada = true;
  if (process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO === "1") return;
  // Uma consulta por semana; nas demais sessões a sugestão sai do registro local (ver semana.js).
  checarSemanal({
    arquivo: process.env.TCERO_MCP_ARQUIVO_AVISO_VERSAO || path.join(os.homedir(), ".tcero-jurisprudencia-aviso-versao.json"),
    atual: L.VERSAO, versaoMaisNova: L.versaoMaisNova, consultar: () => consultarUltimaTag(),
  })
    .then((tag) => {
      L.estadoVersao.versaoNovaCache = tag;
    })
    .catch(() => {});
}

function rodapeErro(mensagem) {
  const tipo = L.tipoDoErro(mensagem);
  const partes = [
    `\n\nVersão: ${L.VERSAO} · Sistema: ${process.platform} ${process.version} · ` +
      `Limitador: ${L.estadoLimitadorResumo()}`,
  ];
  iniciarChecagemVersao();
  if (L.estadoVersao.versaoNovaCache) {
    partes.push(
      `Há versão nova (v${L.estadoVersao.versaoNovaCache}) e ela pode já corrigir este problema.\nBaixar: ${L.PACOTE_MCPB_URL}\nDepois dê dois cliques no arquivo baixado e reinicie o Claude Desktop. ${L.COMO_ATUALIZAR}\n${L.ATALHO_ATUALIZAR}`
    );
  }
  if (!L.SEM_RELATO_TIPOS.has(tipo)) {
    const sufixo = L.estadoVersao.versaoNovaCache ? " (depois de atualizar, se houver versão nova)" : "";
    partes.push(
      `Se o problema continuar${sufixo}, relate ao autor em ${L.linkRelato(tipo)} informando ` +
        "a versão, o sistema e esta mensagem."
    );
  }
  return partes.join("\n");
}

class PortalRecusou extends Error {}

function formatarErroPortal(e, prefixo) {
  const msg = `${prefixo}: ${e.message || e}`;
  // Como no Python: erro de ENTRADA do usuário (ValueError) sai sem o rodapé de erro de portal.
  if (e instanceof L.ErroEntrada) return msg;
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
    throw new L.ErroEntrada(
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

// v1.6.0: baixa (ou pega do cache) e extrai o PDF de `s`, sem formatar o texto: [resultado, aviso]. Mesmo caminho de lerInteiroTeorPdf
// (mesmas travas, mesmo cache), então textoPdfParaRecibo depois reaproveita o cache e o recibo gravado é idêntico ao do modo completo.
async function pdfParaTriagem(s) {
  const link = L.corrigirLinkPdf(s.linkArquivo || "");
  if (!link) return [null, "**Do PDF:** este acórdão não tem `linkArquivo` informado pelo portal."];
  const chave = chaveCachePdfSemCrypto(s, link);
  const emCache = cachePdfLer(chave);
  if (emCache !== null) return [emCache, null];
  let conteudo;
  try {
    conteudo = await _baixarPdfImpl(link);
  } catch (e) {
    if (e instanceof L.LeituraPdfFalhou) return [null, `[LEITURA DE PDF NÃO REALIZADA — ${e.message}]`];
    return [null, `[LEITURA DE PDF NÃO REALIZADA — falha inesperada (${e?.constructor?.name || "Error"}: ${e?.message})]`];
  }
  const resultado = await extrairTextoPdf(conteudo);
  if (resultado.erro) return [null, `[LEITURA DE PDF NÃO REALIZADA — falha ao ler o PDF (${resultado.erro})]`];
  cachePdfGravar(chave, resultado);
  return [resultado, null];
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

class FiltroAmbiguo extends L.ErroEntrada {}

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
      throw new L.ErroEntrada(`por_pagina inválido: ${porPagina}; use de 1 a ${L.POR_PAGINA_MAX}`);
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
      const [nomeO, avisoO] = L.resolverOrgao(L.texto(orgaoJulgador));
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
  const totalPortal = todosBrutos.length;
  if (totalPortal >= L.LIMIAR_POUCO_SELETIVA && pagina === 1) {
    linhas.push(L.avisoPoucoSeletiva(totalPortal));
  } else if ((gruposOk.length ? totalBruto : total) > 200 && pagina === 1) {
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
  const saida = L.cortarBlocoPorResultado(linhas, L.ORCAMENTO_SAIDA, "resposta da busca");
  const placar = L.placarConsultas();
  if (placar) saida.push(placar);
  return saida.join("\n");
}

async function obterAcordao(idDecisao, numeroAcordao, numeroProcesso, lerInteiroTeor, modo = "completo") {
  if (modo !== "completo" && modo !== "triagem") {
    return `modo inválido: ${L.pyRepr(modo)}; use 'completo' ou 'triagem'. Nenhuma requisição foi feita.`;
  }
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
  if (modo === "triagem") {
    // v1.6.0: leitura barata. O recibo gravado é EXATAMENTE o que o modo completo gravaria (mesmo caminho de
    // download/cache e mesmas chamadas): a triagem não rebaixa nem promove a verificação.
    let resultadoPdf = null;
    let avisoPdf = null;
    let brutoPdf = null;
    if (lerInteiroTeor) {
      [resultadoPdf, avisoPdf] = await pdfParaTriagem(s0);
      const [textoPdf, pdfCompleto] = await textoPdfParaRecibo(s0);
      L.gravarReciboTcero(s0, { textoPdf, textoPdfCompleto: pdfCompleto, gravadoEm: agoraIso() });
      brutoPdf = resultadoPdf !== null ? V.textoDoRecibo(s0, textoPdf) : null;
    } else {
      L.gravarReciboTcero(s0, { gravadoEm: agoraIso() });
    }
    linhas.push(...V.triagemDecisao(s0, brutoPdf, resultadoPdf, avisoPdf));
    return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "triagem de obter_acordao").join("\n");
  }
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
// v1.6.0 — consulta compartilhada por linha_do_tempo_tcero e sugerir_termos_tcero                //
// --------------------------------------------------------------------------- //
// UMA consulta à API, com os mesmos parâmetros que `buscar` monta (então a resposta cacheada de uma busca anterior idêntica é reaproveitada,
// sem requisição extra), e o mesmo filtro de `grupos` no cliente. Levanta como `buscar`; quem chama formata.
async function consultaFiltrada(textoLivre, grupos, relator, orgaoJulgador, operacao) {
  const avisos = [];
  const gruposOk = L.gruposValidos(grupos);
  const params = {};
  const tlc = L.montarTextoLivreComGrupos(textoLivre || "", gruposOk);
  if (tlc) params.textoLivre = tlc;
  if (!Object.keys(params).length && !L.texto(relator) && !L.texto(orgaoJulgador)) {
    throw new L.ErroEntrada(
      "Informe pelo menos um critério: texto_livre, grupos, relator ou orgao_julgador. " + "Uma consulta sem nenhum filtro devolveria o acervo inteiro."
    );
  }
  if (L.texto(relator)) {
    const [nome, aviso] = await resolverRelator(L.texto(relator), operacao);
    params.relatores = nome;
    if (aviso) avisos.push(aviso);
  }
  if (L.texto(orgaoJulgador)) {
    const [nomeO, avisoO] = L.resolverOrgao(L.texto(orgaoJulgador));
    params.orgaosJulgadores = nomeO;
    if (avisoO) avisos.push(avisoO);
  }
  const dados = await _consultarApiImpl(params, operacao);
  const brutos = dados.result || [];
  let todos, avisosIa;
  if (gruposOk.length) [todos, avisosIa] = L.filtrarPorGrupos(brutos, gruposOk);
  else [todos, avisosIa] = [brutos, {}];
  return { todos, brutos, total_bruto: brutos.length, avisos, avisos_ia: avisosIa, grupos_ok: gruposOk, params };
}

// Como o Python: erro de entrada/portal/runtime → "Erro na consulta ao TCE-RO"; qualquer outro → com o nome da classe.
function erroDaConsulta(e) {
  if (e instanceof PortalRecusou || e instanceof L.ErroEntrada || e?.constructor === Error) return formatarErroPortal(e, "Erro na consulta ao TCE-RO");
  return formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e?.constructor?.name || "Error"})`);
}

async function linhaDoTempoAsync(textoLivre, grupos, relator, orgaoJulgador, anoInicio, anoFim) {
  const v = V.validarAnos(anoInicio, anoFim);
  if (v.erro) return v.erro;
  let r;
  try {
    r = await consultaFiltrada(textoLivre, grupos, relator, orgaoJulgador, "linha_do_tempo");
  } catch (e) {
    return erroDaConsulta(e);
  }
  const termos = L.termosDaConsulta(textoLivre, r.grupos_ok);
  const filtros = L.truncar(Object.entries(r.params).map(([k, x]) => `${k}=${x}`).join("; "), 300);
  let linhas;
  if (r.todos.length) linhas = V.linhaDoTempo(r.todos, termos, v.ai, v.af, filtros, r.grupos_ok.length ? r.total_bruto : null);
  else linhas = [`**Linha do tempo por ano — 0 decisão(ões)** para \`${filtros}\`.`];
  for (const a of r.avisos) linhas.splice(1, 0, `⚠️ ${a}`);
  return L.cortarBloco(linhas, L.ORCAMENTO_SAIDA, "resposta da linha do tempo").join("\n");
}

async function sugerirTermosAsync(textoLivre, grupos) {
  let r;
  try {
    r = await consultaFiltrada(textoLivre, grupos, null, null, "sugerir_termos");
  } catch (e) {
    return erroDaConsulta(e);
  }
  return V.textoSugerirTermos(textoLivre, r);
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
      const texto = await V.comDiario(
        "buscar_jurisprudencia_tcero",
        {
          texto_livre: a.texto_livre, grupos: a.grupos, numero_acordao: a.numero_acordao, numero_processo: a.numero_processo,
          relator: a.relator, orgao_julgador: a.orgao_julgador, pagina: a.pagina, por_pagina: a.por_pagina,
          detalhar: a.detalhar, ordenar: a.ordenar,
        },
        () =>
          buscar(
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
          )
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
      modo: z
        .enum(["completo", "triagem"])
        .optional()
        .describe(
          '"completo" (padrão) ou "triagem". "triagem" = leitura BARATA para decidir se vale ler a decisão inteira: citação, resultado, ementa inteira, ' +
            "dispositivo, órgão do cadastro e link; e, com `ler_inteiro_teor=true`, do PDF só a estrutura (onde começam acórdão, relatório, voto e votos de " +
            "outros conselheiros, com a página aproximada), o fecho e as linhas que os detectores já marcam (voto divergente, obiter, transcrição, parecer do " +
            "MPC, alegação da parte), cada uma com o lugar onde aparece. SEM o texto corrido e SEM as informações adicionais de IA. A triagem NUNCA serve " +
            'para aspas nem para escrever "inteiro teor lido" numa ficha; o recibo que ela grava é exatamente o que o modo completo gravaria (não rebaixa nem promove a verificação).'
        ),
    },
  },
  async (a) => {
    try {
      const texto = await V.comDiario(
        "obter_acordao_tcero",
        { id_decisao: a.id_decisao, numero_acordao: a.numero_acordao, numero_processo: a.numero_processo, ler_inteiro_teor: a.ler_inteiro_teor, modo: a.modo },
        () => obterAcordao(a.id_decisao ?? null, a.numero_acordao ?? null, a.numero_processo ?? null, !!a.ler_inteiro_teor, a.modo ?? "completo")
      );
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
      const texto = await V.comDiario(
        "verificar_citacao_tcero",
        { id_decisao: a.id_decisao, numero_acordao: a.numero_acordao, trecho: a.trecho },
        () => verificarCitacao(a.id_decisao ?? null, a.numero_acordao ?? null, a.trecho)
      );
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

server.registerTool(
  "buscar_recibos_tcero",
  {
    title: "Buscar nos recibos locais (sem rede)",
    description:
      "Busca SEM REDE nos recibos locais: o que esta máquina já leu do TCE-RO (cada `obter_acordao_tcero` grava um recibo com ementa, dispositivo e, se lido, o texto do PDF). " +
      "Serve para reencontrar um acórdão já lido, ou procurar uma expressão no voto de um acórdão que já passou por aqui, sem gastar consulta ao portal. NÃO é pesquisa no " +
      'acervo do TCE-RO: zero resultado aqui NUNCA é "não há jurisprudência" nem "não localizado" — para isso use `buscar_jurisprudencia_tcero`. Procura na ementa, no ' +
      "dispositivo e no texto do PDF gravados; nunca no texto de IA do DEJUR. Palavra inteira, com a mesma normalização do verificador (caixa, acento, pontuação). " +
      "Devolve quantos recibos existem e quantos atendem; por recibo: sigla/número, id, órgão, data da sessão, relator, processo, citação pronta (sem a data do DOe, que o " +
      "recibo não guarda), link, a verificação gravada (ementa+dispositivo, PDF lido ou lido em parte), onde o termo aparece (posição no julgado e página aproximada) e o trecho em volta.",
    inputSchema: {
      consulta: z.string().default("").describe('Palavras (todas exigidas) e "frases exatas entre aspas". `multa*` = prefixo.'),
      grupos: z.array(z.array(z.string())).optional().describe("Como em buscar_jurisprudencia_tcero: OU dentro do grupo, E entre grupos."),
      relator: z.string().optional().describe("Parte do nome do relator (sem caixa/acento)."),
      orgao: z.string().optional().describe('"1ª Câmara", "2ª Câmara" ou "Pleno" (órgão do cadastro).'),
      limite: z.number().int().optional().describe("Quantos mostrar (1 a 20; padrão 10)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (a) => {
    try {
      const texto = await V.comDiario("buscar_recibos_tcero", { consulta: a.consulta, grupos: a.grupos, relator: a.relator, orgao: a.orgao, limite: a.limite }, async () =>
        V.buscarRecibos(a.consulta ?? "", a.grupos ?? null, a.relator ?? null, a.orgao ?? null, a.limite ?? 10)
      );
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao ler os recibos locais (${e.constructor.name})`)) }], isError: true };
    }
  }
);

// v1.7.0 — julgados_que_citam_tcero: UMA consulta ao portal (frase entre aspas) + recibos locais (sem rede). Só o filtro local do número decide.
async function julgadosQueCitam(numero, limite = 10) {
  const c = V7.numeroCitado(numero);
  if (!c) return "Informe o número no formato do portal, NNNNN/AA (1 a 5 dígitos, barra, 2 dígitos), de um processo ou de um acórdão. Nenhuma requisição foi feita.";
  const [forma, n, aa] = c;
  limite = Math.max(1, Math.min(parseInt(limite, 10) || 10, 50));
  const info = {};
  let portal = null;
  try {
    const dados = await _consultarApiImpl({ textoLivre: `"${forma}"` }, "citacoes");
    const itens = dados.result || [];
    [portal, info.proprias, info.sem_numero] = V7.citacoesNoPortal(itens, forma, n, aa);
    info.total_portal = itens.length;
  } catch (e) {
    portal = null;
    if (e instanceof PortalRecusou || e instanceof L.ErroEntrada || e?.constructor === Error) info.erro = L.umaLinha(String(e.message || e)).slice(0, 300);
    else info.erro = `${e?.constructor?.name || "Error"}: ${L.umaLinha(String(e?.message || e)).slice(0, 200)}`;
  }
  const recibos = V7.citacoesNosRecibos(forma, n, aa);
  const linhas = V7.formatarCitacoes(forma, portal, recibos, limite, info).split("\n");
  // a linha "… e mais N" sai antes do corte e volta depois dele: o corte é em fronteira de resultado inteiro, e o "e mais" nunca se perde
  const mais = linhas.filter((l) => l.startsWith("… e mais "));
  const corpo = linhas.filter((l) => !l.startsWith("… e mais "));
  const saida = [...L.cortarBlocoPorResultado(corpo, L.ORCAMENTO_SAIDA, "julgados_que_citam_tcero", L.RE_CABECA_CITACAO), ...mais];
  const placar = L.placarConsultas(); // a ferramenta faz UMA consulta ao portal: o placar diz onde está o limitador
  if (placar) saida.push(placar);
  return saida.join("\n");
}

server.registerTool(
  "julgados_que_citam_tcero",
  {
    title: "Julgados que citam um processo ou acórdão (TCE-RO)",
    description:
      "Julgados do TCE-RO que CITAM um processo ou um acórdão pelo número (NNNNN/AA), com o trecho em volta. " +
      "UMA consulta ao portal (frase entre aspas no texto livre) + busca SEM REDE nos recibos locais; cada achado diz de qual fonte veio (portal ou recibo local). " +
      "LEITURA ASSISTIDA: serve para ver como o precedente é tratado depois dele. NÃO detecta superação nem distinção. ZERO RESULTADO NÃO PROVA que ninguém o aplicou: " +
      "o portal indexa texto (ementa, dispositivo e informações adicionais) e o PDF do inteiro teor NÃO é varrido, então o recall é baixo; citação por extenso ou sem a forma " +
      "NNNNN/AA não é achada. Os recibos cobrem só o que esta máquina já leu. O portal casa por OU quando não honra a frase; por isso só se listam as decisões que trazem o número no texto devolvido.",
    inputSchema: {
      numero: z.string().describe('Número do processo ou do acórdão julgado citado, no formato do portal, ex.: "00037/23" ou "37/23".'),
      limite: z.number().int().optional().describe("Quantos achados mostrar (1 a 50; padrão 10)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (a) => {
    try {
      const texto = await V.comDiario("julgados_que_citam_tcero", { numero: a.numero, limite: a.limite }, () => julgadosQueCitam(a.numero, a.limite ?? 10));
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "diagnostico_erros_tcero",
  {
    title: "Diagnóstico do diário de erros (TCE-RO)",
    description:
      "Resume as falhas que as ferramentas deste servidor registraram nesta máquina (rede, portal, PDF, formato inesperado) e devolve o link do formulário de relato já preenchido. " +
      "O diário fica em `~/.tcero-jurisprudencia/erros.jsonl` (ou em `TCERO_MCP_DIR_ESTADO`) e guarda SÓ dado técnico: ferramenta, tipo do erro, mensagem curta sanitizada, versão, " +
      "sistema e data. NUNCA o texto da busca, nome de parte, número de processo nem trecho citado. Não faz nenhuma requisição.",
    inputSchema: {
      dias: z.number().int().optional().describe("Período a resumir (1 a 365; padrão 30)."),
      relatorio: z.boolean().optional().describe("Se true, acrescenta a tabela técnica dos últimos registros, pronta para colar numa issue."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (a) => ({ content: [{ type: "text", text: L.finalizarSaida(V.diagnosticoErros(a.dias ?? 30, !!a.relatorio)) }] })
);

server.registerTool(
  "linha_do_tempo_tcero",
  {
    title: "Linha do tempo por ano (TCE-RO)",
    description:
      "Conta, ano a ano e por órgão julgador, as decisões que casam uma consulta, e mostra por ano as duas mais pertinentes (citação e link). UMA consulta ao portal (zero se a mesma " +
      "busca acabou de ser feita: a resposta fica em cache por alguns minutos); o filtro de `grupos` é o mesmo da busca. É contagem do que o portal devolveu para ESTA consulta, " +
      "não tendência da Corte: o volume de processos e a composição dos órgãos mudam de ano para ano. Use para saber QUANDO e em QUAL órgão o tema aparece e ler as decisões dos " +
      "dois períodos; mudança de proporção entre anos nunca prova mudança de entendimento.",
    inputSchema: {
      texto_livre: z.string().default("").describe("Como em buscar_jurisprudencia_tcero (OU entre palavras)."),
      grupos: z.array(z.array(z.string())).optional().describe("Como em buscar_jurisprudencia_tcero (OU dentro do grupo, E entre grupos)."),
      relator: z.string().optional().describe("Nome do relator (exato; a ferramenta tenta aproximar pela lista do portal)."),
      orgao_julgador: z.string().optional().describe('"1ª Câmara", "2ª Câmara" ou "Pleno".'),
      ano_inicio: z.number().int().optional().describe("Primeiro ano da sessão a mostrar (recorte no cliente; não muda a consulta)."),
      ano_fim: z.number().int().optional().describe("Último ano da sessão a mostrar."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (a) => {
    try {
      const texto = await V.comDiario(
        "linha_do_tempo_tcero",
        { texto_livre: a.texto_livre, grupos: a.grupos, relator: a.relator, orgao_julgador: a.orgao_julgador, ano_inicio: a.ano_inicio, ano_fim: a.ano_fim },
        () => linhaDoTempoAsync(a.texto_livre ?? "", a.grupos ?? null, a.relator ?? null, a.orgao_julgador ?? null, a.ano_inicio ?? null, a.ano_fim ?? null)
      );
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "sugerir_termos_tcero",
  {
    title: "Sugerir termos para `grupos` (TCE-RO)",
    description:
      "Sugere 10 a 20 palavras e pares de palavras para montar `grupos`, tirados das ementas e dispositivos que casaram a sua consulta: frequentes entre as decisões que casaram e " +
      "raros fora delas. Resolve o problema do portal, que só casa as palavras que você escreveu: o vocabulário que o TCE-RO usou para o mesmo assunto aparece aqui. Usa a resposta da " +
      "busca (zero requisição extra se a mesma consulta já foi feita há pouco; senão, UMA consulta). É sugestão, não conclusão: confira que a nova busca traz o assunto, e NÃO cole a " +
      "lista inteira em `grupos` — escolha 2 a 4 que sejam mesmo sinônimos (medição: 3 sugestões em OU derrubaram o topo em 4 de 6 consultas). Exclui o seu próprio termo, nomes de " +
      "relatores e palavras de ligação; ignora o texto de IA do DEJUR.",
    inputSchema: {
      texto_livre: z.string().default("").describe("Termos soltos (OU no portal). Serve para descobrir o vocabulário do assunto."),
      grupos: z.array(z.array(z.string())).optional().describe("Conceitos já montados (E entre grupos); as sugestões saem das decisões que casam os grupos."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (a) => {
    try {
      const texto = await V.comDiario("sugerir_termos_tcero", { texto_livre: a.texto_livre, grupos: a.grupos }, () => sugerirTermosAsync(a.texto_livre ?? "", a.grupos ?? null));
      return { content: [{ type: "text", text: L.finalizarSaida(texto) }] };
    } catch (e) {
      return { content: [{ type: "text", text: L.finalizarSaida(formatarErroPortal(e, `Erro ao consultar o portal do TCE-RO (${e.constructor.name})`)) }], isError: true };
    }
  }
);

server.registerTool(
  "atualizar_extensao_tcero",
  {
    title: "Baixar a versão mais nova desta extensão",
    description:
      "USE SÓ QUANDO O USUÁRIO PEDIR para atualizar a extensão. Consulta o GitHub oficial do projeto. Sem `confirmar`, só INFORMA se há versão mais nova (nada é baixado): " +
      "mostre ao usuário e PERGUNTE se quer baixar. Só com `confirmar=true` — depois que o usuário disse que quer — baixa o arquivo para a pasta Downloads, confere o SHA-256 e diz " +
      "onde ele está. NÃO instala: o usuário instala dando dois cliques no arquivo e confirmando. Nunca use por iniciativa própria, nunca passe confirmar=true sem a resposta do " +
      "usuário e nunca abra ou execute o arquivo. Não consulta o portal do TCE-RO.",
    inputSchema: {
      confirmar: z.boolean().optional().describe("true = o usuário disse, nesta conversa, que quer baixar o arquivo agora. Omita para só ver se há versão nova."),
    },
    annotations: { title: "Baixar atualização da extensão", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (a) => {
    try {
      return { content: [{ type: "text", text: textoAtualizacao(await baixarAtualizacao({ confirmar: a.confirmar === true })) }] };
    } catch (e) {
      const texto = e instanceof ErroAtualizacao ? e.message : `Não consegui baixar a atualização (${e?.message || e}).`;
      return { content: [{ type: "text", text: texto }], isError: true };
    }
  }
);

// Só conecta o transporte quando executado diretamente (`node server/index.js`), nunca quando
// importado — necessário para o harness de paridade (test/paridade.py) e para testes Node
// importarem `buscar`/`obterAcordao`/`verificarCitacao` sem subir um servidor MCP de verdade.
// Comparação por CAMINHO, não por texto da URL: `import.meta.url` codifica espaço como %20 e
// `process.argv[1]` não. O Claude Desktop instala a extensão em ".../Application Support/Claude/
// Claude Extensions/..." (com espaços), então a versão antiga nunca conectava o transporte lá —
// processo vivo, `initialize` sem resposta, "Request timed out" após 60 s (log de 06–15/10/2026).
// O smoke test só passava porque rodava em ~/MCP, sem espaço.
function mesmoArquivo(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return path.resolve(a) === path.resolve(b); }
}
if (process.argv[1] && mesmoArquivo(fileURLToPath(import.meta.url), process.argv[1])) {
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
export function _limparCachesParaTeste() {
  cacheRespostas.clear();
  cacheBytes = 0;
  cachePdf.clear();
}
export { julgadosQueCitam, buscar, obterAcordao, verificarCitacao, linhaDoTempoAsync, sugerirTermosAsync, consultaFiltrada, extrairTextoPdf, formatarErroPortal };
