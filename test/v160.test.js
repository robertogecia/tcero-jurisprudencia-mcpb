// Espelha o bloco "v1.6.0" do `--selftest` do servidor Python (servidor_tcero.py, commit 4f8fbf7): buscar_recibos · diário de erros ·
// linha do tempo · sugerir termos · triagem · alertas que dizem onde. 100% offline: fixtures, diretórios temporários, rede trocada
// por falsos. O ambiente é fixado ANTES do import (DIR_RECIBOS e a pasta do disjuntor são lidos uma vez, na carga do módulo).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-v160-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const V = await import("../server/v160.js");
const idx = await import("../server/index.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const fx = (nome) => JSON.parse(fs.readFileSync(path.join(AQUI, "fixtures", nome), "utf-8"));
const fxPdf = (nome) => fs.readFileSync(path.join(AQUI, "fixtures", "pdf", nome));
const dC2 = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(AQUI, "fixtures", "exp_C2_controle_or.json.gz"))).toString("utf-8"));
const dId = fx("03_busca_idDecisao.json");
const d02 = fx("02_busca_numeroAcordao.json");
const s98114 = dId.result.find((i) => i.source.idDecisao === 98114).source;
const s96141 = d02.result.find((i) => i.source.idDecisao === 96141).source;

const semAviso = (t) => t.replace(/\s+/g, " ");
const dirEstado = process.env.TCERO_MCP_DIR_ESTADO;

// --------------------------------------------------------------------------------------------------------------------- //
// 1. diário de erros                                                                                                     //
// --------------------------------------------------------------------------------------------------------------------- //
test("diário: pasta, vazio, sanitização, permissões, sem vazamento de segredo", () => {
  assert.equal(V.dirEstado(), dirEstado);
  assert.deepEqual(V.lerErros(30), []);
  assert.match(V.diagnosticoErros(30), /Nenhum erro registrado/);
  const seg = "SEGREDO123";
  const e1 = V.registrarErro("buscar_jurisprudencia_tcero", {
    erro: new Error(`Falha de rede repetida (ReadTimeout: https://papyrus.tcero.tc.br/api/espelho/buscar?textoLivre=${seg}&relatores=Fulano 'Joao ${seg}' proc 02603/22 id 987654321)`),
    args: { texto_livre: seg, grupos: [[seg, "x"], [seg]], relator: `Fulano ${seg}`, pagina: 2, por_pagina: 10, detalhar: true },
    ms: 1234,
  });
  assert.ok(e1 && e1.tipo === "timeout" && e1.ferramenta === "buscar_jurisprudencia_tcero" && e1.versao === L.VERSAO, JSON.stringify(e1));
  const bruto = fs.readFileSync(V.arquivoErros(), "utf-8");
  assert.ok(!bruto.includes(seg) && !bruto.includes("02603") && !bruto.includes("987654321"), bruto);
  assert.ok(!bruto.includes("textoLivre") && !bruto.includes("Joao"), bruto);
  assert.equal(e1.args.pagina, 2);
  assert.equal(e1.args.detalhar, true);
  assert.equal(e1.args.grupos, "2 grupo(s), 3 termo(s)");
  assert.ok(e1.args.texto_livre.startsWith("<texto:") && e1.args.relator.startsWith("<texto:"), JSON.stringify(e1.args));
  assert.equal(fs.statSync(V.arquivoErros()).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(V.arquivoErros())).mode & 0o777, 0o700);
  assert.ok(e1.mensagem.includes("papyrus.tcero.tc.br/api/espelho/buscar") && !e1.mensagem.split("buscar")[1].slice(0, 3).includes("?"));
});

test("diário: tipos novos e reconhecimento de falha na saída", () => {
  assert.equal(V.tipoDoErroDiario("[LEITURA DE PDF NÃO REALIZADA — o host do PDF respondeu HTTP 404]"), "pdf_falha");
  assert.equal(V.tipoDoErroDiario("PDF sem texto extraível (provável digitalização)"), "pdf_sem_texto");
  assert.equal(V.tipoDoErroDiario("[EXTRAÇÃO PARCIAL — teto]"), "pdf_parcial");
  assert.equal(V.tipoDoErroDiario("Resposta do portal em formato inesperado (sem a chave 'result')"), "formato_inesperado");
  assert.equal(V.tipoDoErroDiario("O portal respondeu HTTP 503 de forma persistente"), "http_503");
  assert.equal(V.falhaNaSaida("[LEITURA DE PDF NÃO REALIZADA — x]"), "falha");
  assert.equal(V.falhaNaSaida("Erro na consulta ao TCE-RO: consulta sem nenhum filtro preenchido"), null);
  assert.equal(V.falhaNaSaida("Erro na consulta ao TCE-RO: x\n\nVersão: 1.6.0 · Sistema"), "falha");
  assert.equal(V.falhaNaSaida("Erro ao consultar o portal do TCE-RO (KeyError): 'x'"), "falha");
  assert.equal(V.falhaNaSaida("PDF sem texto extraível (provável digitalização)"), "parcial");
  assert.equal(V.falhaNaSaida("tudo certo, 3 decisões"), null);
});

test("diário: comDiario anota falha/exceção, ignora validação e limitador, relança, resume, poda e nunca derruba", async () => {
  const seg = "SEGREDO123";
  const n0 = V.lerErros(30).length;
  const r1 = await V.comDiario("obter_acordao_tcero", { id_decisao: 98114, ler_inteiro_teor: true }, async () => "bloco\n[LEITURA DE PDF NÃO REALIZADA — falha de rede ao baixar o PDF (ConnectError)]\nmais");
  assert.ok(r1.startsWith("bloco"));
  assert.equal(await V.comDiario("a", {}, async () => "3 decisões"), "3 decisões");
  await V.comDiario("a", {}, async () => "Erro na consulta ao TCE-RO: relator 'X' casa com 2 nomes");
  await V.comDiario("a", {}, async () => "Erro na consulta ao TCE-RO: Muitas consultas em pouco tempo (limite atual: 6 a cada 10m).\n\nVersão: 1.6.0");
  await assert.rejects(() => V.comDiario("verificar_citacao_tcero", { trecho: seg }, async () => { throw new TypeError("x"); }), TypeError);
  const novos = V.lerErros(30).slice(n0);
  assert.deepEqual(novos.map((e) => e.ferramenta), ["obter_acordao_tcero", "verificar_citacao_tcero"]);
  assert.equal(novos[0].tipo, "pdf_falha");
  assert.deepEqual(novos[0].args, { ler_inteiro_teor: true, id_decisao: "int" });
  assert.ok(!fs.readFileSync(V.arquivoErros(), "utf-8").includes(seg));
  // resumo, relatório, período, link de relato (só dado técnico)
  const resumo = V.diagnosticoErros(30);
  assert.ok(resumo.includes("timeout") && resumo.includes("pdf_falha") && resumo.includes("buscar_jurisprudencia_tcero"), resumo);
  assert.ok(resumo.includes(L.ISSUES_NOVA + "?title=") && !resumo.includes(seg), resumo);
  assert.ok(!resumo.includes("Relatório técnico") && V.diagnosticoErros(30, true).includes("Relatório técnico"));
  for (const ruim of [0, "x", 400]) assert.match(V.diagnosticoErros(ruim), /inválido/);
  assert.deepEqual(V.lerErros(30, Date.now() + 40 * 86400_000), []);
  // poda por tamanho: acima de MAX_BYTES mantém só as últimas MAX_LINHAS_ERROS
  const linhaGorda = JSON.stringify({ quando: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"), versao: L.VERSAO, ferramenta: "x", tipo: "outro", mensagem: "m".repeat(300), args: {} }) + "\n";
  fs.appendFileSync(V.arquivoErros(), linhaGorda.repeat(Math.floor(V.MAX_BYTES_ERROS / linhaGorda.length) + 50));
  V.registrarErro("x", { erro: new Error("gatilho da poda") });
  const linhasPos = fs.readFileSync(V.arquivoErros(), "utf-8").split("\n").filter(Boolean);
  assert.ok(linhasPos.length <= V.MAX_LINHAS_ERROS && linhasPos[linhasPos.length - 1].includes("gatilho da poda"), linhasPos.length);
  assert.ok(fs.statSync(V.arquivoErros()).size <= V.MAX_BYTES_ERROS + 2000);
  // o diário nunca derruba a ferramenta: diretório impossível de criar → null
  const antes = process.env.TCERO_MCP_DIR_ESTADO;
  process.env.TCERO_MCP_DIR_ESTADO = path.join(V.arquivoErros(), "dentro-de-arquivo");
  assert.equal(V.registrarErro("x", { erro: new Error("y") }), null);
  process.env.TCERO_MCP_DIR_ESTADO = antes;
  assert.equal(V.sanitizarErro('falhou em "texto da busca do usuario" e \'outro trecho longo\' e a@b.com 0123456/2026'), "falhou em «…» e «…» e <email> <nº>");
});

// --------------------------------------------------------------------------------------------------------------------- //
// 2. buscar_recibos_tcero                                                                                                //
// --------------------------------------------------------------------------------------------------------------------- //
const sSintetico = {
  idDecisao: 11111, sigla: "AC2-TC", numero: "00001/26", processo: "00001/26", relator: "MARIA SINTETICA", orgaoJulgador: "2ª Câmara",
  dataSessao: "2026-02-02T00:00:00", linkArquivo: "//tce.ro.gov.br/AbrirPdfConvidado/aaa",
  ementa: "Julgados IMPROCEDENTES os pedidos. Multas aplicadas ao gestor; reincidência afastada.",
  acordaoDescricao: "<p>Aplicar multa de R$ 1.000,00 ao responsável.</p>",
  informacoesAdicionais: "<p>ZZXQWIA texto de IA que não pode ser achado pela busca local.</p>",
};

// Falsos de rede: o portal devolve a decisão pedida; o PDF vem do arquivo das fixtures.
const decisoes = new Map([["98114", s98114], ["96141", s96141]]);
const pdfPorLink = new Map([[L.corrigirLinkPdf(s98114.linkArquivo), fxPdf("98114.pdf")], [L.corrigirLinkPdf(s96141.linkArquivo), fxPdf("96141.pdf")]]);
const chamadasApi = [];
const chamadasPdf = [];
function instalarFalsos() {
  idx._setDepsParaTeste({
    consultarApi: async (params) => {
      chamadasApi.push({ ...params });
      const s = decisoes.get(String(params.IdDecisao));
      if (!s) throw new Error("mock sem rota para " + JSON.stringify(params));
      return { result: [{ source: s }] };
    },
    baixarPdf: async (url) => {
      chamadasPdf.push(url);
      const b = pdfPorLink.get(url);
      if (!b) throw new Error("mock sem PDF para " + url);
      return b;
    },
  });
}

test("recibos: monta 3 recibos (2 com PDF, 1 só ementa) e a busca local acha, sem rede", async () => {
  instalarFalsos();
  await idx.obterAcordao(98114, null, null, true);
  await idx.obterAcordao(96141, null, null, true);
  L.gravarReciboTcero(sSintetico, { gravadoEm: "2026-10-15T00:00:00-0400" });
  assert.equal(L.lerReciboTcero(11111).texto_pdf_completo, null);
  V.limparMemoRecibos();
  const [lista, ign] = V.listarRecibosTcero();
  assert.equal(lista.length, 3);
  assert.equal(ign, 0);
  // a busca é síncrona e não toca rede: com a API explodindo, funciona do mesmo jeito
  const nApi = chamadasApi.length;
  idx._setDepsParaTeste({ consultarApi: async () => { throw new Error("buscar_recibos NÃO pode consultar a API"); } });
  const b1 = V.buscarRecibos("licitação", null, null, null, 10);
  assert.ok(b1.includes("3 de 3") || b1.includes("de 3 decisão"), b1.slice(0, 400));
  assert.ok(b1.includes("ZERO requisição") && b1.includes("NUNCA") && b1.includes("não há jurisprudência"), b1.slice(0, 600));
  assert.ok(b1.includes("2 com o PDF lido, 1 só com ementa + dispositivo"), b1.slice(0, 500));
  // palavra INTEIRA: "procedentes" não casa dentro de "IMPROCEDENTES"; "improcedentes" casa; "multa*" pega "Multas"
  assert.ok(V.buscarRecibos("procedentes", null, null, null).includes("0 de 3"));
  assert.ok(V.buscarRecibos("improcedentes", null, null, null).includes("1 de 3"));
  assert.ok(V.buscarRecibos('"aplicadas ao gestor"', null, null, null).includes("1 de 3"));
  assert.ok(V.buscarRecibos('"gestor aplicadas"', null, null, null).includes("0 de 3")); // frase: ordem exigida
  assert.ok(V.buscarRecibos("multa*", null, null, null).split("\n")[0].startsWith("**Recibos locais do TCE-RO — "));
  assert.ok(V.buscarRecibos('"REINCIDENCIA afastada"', null, null, null).includes("1 de 3")); // caixa/acento/pontuação como o verificador
  assert.ok(V.buscarRecibos("ZZXQWIA", null, null, null).includes("0 de 3")); // texto de IA NUNCA é pesquisado
  // grupos (OU dentro, E entre) e filtros
  assert.ok(V.buscarRecibos("", [["improcedentes", "inexistentepalavra"], ["multas"]], null, null).includes("1 de 3"));
  assert.ok(V.buscarRecibos("", [["improcedentes"], ["inexistentepalavra"]], null, null).includes("0 de 3"));
  assert.ok(V.buscarRecibos("multa", null, "sintetica", null).includes("1 de 3")); // relator sem caixa/acento
  assert.ok(V.buscarRecibos("multa", null, "sintetica", "Pleno").includes("0 de 3")); // órgão do cadastro
  const bp = V.buscarRecibos("", null, null, "pleno");
  assert.ok(!bp.split("\n")[0].includes("2ª Câmara") && bp.split("\n")[0].includes("órgão «Pleno»"), bp.split("\n")[0]);
  assert.ok(V.buscarRecibos("", null, null, null).includes("BUSCA LOCAL NÃO REALIZADA"));
  assert.ok(V.buscarRecibos("de", null, null, null).includes("BUSCA LOCAL NÃO REALIZADA")); // só palavra vazia = sem critério
  // conteúdo do resultado: citação pronta, link, verificação gravada, onde, trecho
  const bv = V.buscarRecibos("licitatório", null, null, "Pleno", 1);
  assert.ok(bv.includes("APL-TC 00055/26 · id 98114") && bv.includes("Citação: (TCE-RO - APL-TC 00055/26, Rel. JOSÉ EULER"), bv.slice(0, 900));
  assert.ok(bv.includes("Link: https://tcero.tc.br/AbrirPdfConvidado/") && bv.includes("Verificação gravada no recibo: inteiro teor lido (PDF)"), bv);
  assert.ok(bv.includes("Onde: ") && bv.includes("«…") && bv.includes("SEM a data do DOe"), bv);
  assert.ok(!bv.split("Citação:")[1].split("\n")[0].includes("DOe 0"));
  assert.ok(V.buscarRecibos("multa", null, null, null).includes("só ementa + dispositivo do cadastro (PDF não lido)"));
  // limite e ordenação
  const bl = V.buscarRecibos("multa", null, null, null, 1);
  assert.ok(bl.includes("\n1. ") && !bl.includes("\n2. "), bl.slice(0, 300));
  assert.ok(bl.includes("mais ") && bl.includes("aumente `limite`"), bl.slice(-300));
  assert.equal(chamadasApi.length, nApi, "buscar_recibos não pode ter feito requisição");
  // recibo adulterado fica de fora e é contado
  const cam = L.caminhoReciboTcero(96141);
  const dados = JSON.parse(fs.readFileSync(cam, "utf-8"));
  dados.texto += " ADULTERADO";
  fs.writeFileSync(cam, JSON.stringify(dados));
  V.limparMemoRecibos();
  const ba = V.buscarRecibos("licitação", null, null, null);
  assert.ok(ba.includes("1 arquivo(s) da pasta de recibos ficaram de fora") && !ba.includes("id 96141"), ba.slice(0, 600));
  // pasta inexistente: zero recibos, mensagem clara, nada quebra
  assert.ok(V.buscarRecibos("qualquer", null, null, null, 10, path.join(TMP, "nao-existe")).includes("0 de 0"));
  // o recibo em disco NÃO ganhou nenhum campo novo (contrato com o lint da peticao-rg)
  const esperados = ["tribunal", "id_documento", "sigla", "numero", "processo", "nr_processo", "relator", "orgao_cadastro", "data_sessao", "link", "gravado_em", "fonte", "texto",
    "texto_pdf_completo", "texto_ia_dejur", "texto_transcrito", "texto_divergente", "texto_alegacao_parte", "texto_parecer_mpc", "sha256", "sha256_campos"].sort();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(L.caminhoReciboTcero(98114), "utf-8"))).sort(), esperados);
  // via ferramenta (com o diário em volta)
  const via = await V.comDiario("buscar_recibos_tcero", { consulta: "x" }, async () => V.buscarRecibos("multa", null, null, null));
  assert.ok(via.includes("Recibos locais do TCE-RO"));
  instalarFalsos();
});

test("recibos: termos da consulta (frase, prefixo, palavra vazia, acentos nas pontas)", () => {
  assert.deepEqual(V.termosDaConsultaRecibos('multa* "dano ao erário" de'), ["dano ao erário", "multa*"]);
  assert.deepEqual(V.termosDaConsultaRecibos("Reincidência, reincidencia."), ["Reincidência"]);
  assert.deepEqual(V.termosDaConsultaRecibos("irmã"), ["irmã"]); // \w do Python é Unicode: a letra acentuada final não é "ponta não-palavra"
  assert.equal(V.regexTermoRecibo("   "), null);
  assert.ok(V.regexTermoRecibo("multa*").test("as multas foram"));
  assert.ok(!V.regexTermoRecibo("multa").test("as multas foram"));
});

// --------------------------------------------------------------------------------------------------------------------- //
// 3. linha do tempo                                                                                                      //
// --------------------------------------------------------------------------------------------------------------------- //
test("linha do tempo: contagem por ano e órgão, topo por ano, recorte", () => {
  const its = [[2020, "Pleno"], [2020, "1ª Câmara"], [2020, "Pleno"], [2021, "Pleno"], [2022, "2ª Câmara"], [2022, "2ª Câmara"], [2022, "Pleno"], [2022, "Pleno"], [2022, "1ª Câmara"]]
    .map(([ano, org], k) => {
      const i = k + 1;
      return { source: { idDecisao: i, dataSessao: `${ano}-03-01T00:00:00`, orgaoJulgador: org, sigla: "AC1-TC", numero: `${String(i).padStart(5, "0")}/${String(ano).slice(2)}`,
        ementa: `multa ${i % 2 ? "reincidência" : ""} tema${i}`, linkArquivo: `//tce.ro.gov.br/AbrirPdfConvidado/h${i}` } };
    });
  its.push({ source: { idDecisao: 99, ementa: "multa reincidência sem sessão", orgaoJulgador: "Pleno" } });
  const lt = V.linhaDoTempo(its, ["multa", "reincidência"], null, null, "f", 50).join("\n");
  assert.ok(lt.includes("10 decisão(ões)") && lt.includes("(de 50 no portal antes do filtro de grupos)"), lt.slice(0, 300));
  for (const f of ["| 2022 | 5 | ", "| 2020 | 3 | ", "| 2021 | 1 | ", "| sem data de sessão | 1 | "]) assert.ok(lt.includes(f), f + "\n" + lt);
  assert.ok(lt.indexOf("| 2022 |") < lt.indexOf("| 2021 |") && lt.indexOf("| 2021 |") < lt.indexOf("| 2020 |"));
  const conta = (t, sub) => t.split(sub).length - 1;
  assert.equal(conta(lt, "\n- 2022 · id"), 2);
  assert.equal(conta(lt, "\n- 2020 · id"), 2);
  assert.equal(conta(lt, "\n- 2021 · id"), 1);
  assert.ok(lt.includes("não a frequência com que a Corte decide o tema nem tendência") && lt.includes("AbrirPdfConvidado/h"));
  const lt2 = V.linhaDoTempo(its, ["multa"], 2021, 2022).join("\n");
  assert.ok(!lt2.split("**As ")[0].includes("2020") && !lt2.includes("sem data de sessão") && lt2.includes("6 decisão(ões)"), lt2.slice(0, 400));
});

test("linha do tempo: ponta a ponta com a resposta de 1.141 decisões, UMA requisição, parâmetros iguais aos de buscar", async () => {
  const d = dC2();
  const params = [];
  idx._setDepsParaTeste({ consultarApi: async (p) => { params.push({ ...p }); return d; } });
  const grupos = [["reincidência"], ["multa"]];
  const lt3 = await idx.linhaDoTempoAsync(null, grupos, null, null, null, null);
  assert.equal(params.length, 1);
  const [filtrados] = L.filtrarPorGrupos(d.result, L.gruposValidos(grupos));
  assert.equal(filtrados.length, 59);
  assert.ok(lt3.includes(`${filtrados.length} decisão(ões) que a consulta devolveu (de ${d.result.length} no portal antes do filtro de grupos)`), lt3.slice(0, 300));
  const soma = lt3.split("\n").filter((l) => /^\| (\d{4}|sem data de sessão) \|/.test(l)).reduce((a, l) => a + parseInt(l.split("|")[2], 10), 0);
  assert.equal(soma, filtrados.length);
  await idx.buscar(null, null, null, null, null, 1, 10, false, grupos);
  assert.deepEqual(params[1], params[0], "mesmos parâmetros ⇒ o cache de uma busca vale para a linha do tempo");
  // validações sem rede
  params.length = 0;
  assert.match(await idx.linhaDoTempoAsync("multa", null, null, null, "abc", null), /inválidos/);
  assert.match(await idx.linhaDoTempoAsync("multa", null, null, null, 2025, 2020), /fora do intervalo/);
  assert.match(await idx.linhaDoTempoAsync("", null, null, null, null, null), /Informe pelo menos um critério/);
  assert.deepEqual(params, []);
  // erro do portal vira mensagem com rodapé, nunca exceção; erro de entrada sai sem rodapé
  idx._setDepsParaTeste({ consultarApi: async () => { throw new Error("O portal respondeu HTTP 503 de forma persistente"); } });
  const falha = await idx.linhaDoTempoAsync("multa", null, null, null, null, null);
  assert.ok(falha.startsWith("Erro na consulta ao TCE-RO") && falha.includes("\nVersão: "), falha);
  const entrada = await idx.linhaDoTempoAsync("", null, null, null, null, null);
  assert.ok(!entrada.includes("\nVersão: "), entrada);
  assert.equal(V.falhaNaSaida(entrada), null);
  assert.equal(V.falhaNaSaida(falha), "falha");
  instalarFalsos();
});

// --------------------------------------------------------------------------------------------------------------------- //
// 4. sugerir termos                                                                                                      //
// --------------------------------------------------------------------------------------------------------------------- //
test("sugerir termos: núcleo apenas, sem o termo do usuário, sem relator, mínimos e fundo ausente", () => {
  const doc = (i, ementa, ia = "") => ({ source: { idDecisao: i, ementa, relator: "FULANO ZEBRINHO", informacoesAdicionais: ia, acordaoDescricao: "", dataSessao: "2026-01-01T00:00:00" } });
  const fundo = { N: 1000, df: { comum: 900, multa: 300, gamaxis: 5, ementa: 800 }, df2: {} };
  const casadas = Array.from({ length: 10 }, (_, i) => doc(i, "multa por gamaxis e ementa comum foo", "iaonlyword iaonlyword"));
  const rest = Array.from({ length: 20 }, (_, i) => doc(100 + i, "comum outra coisa qualquer texto"));
  const rv = V.sugerirVocabulario(casadas, rest, ["multa"], fundo, new Set(["zebrinho"]));
  const pal = rv.termos.map(([w]) => w);
  assert.ok(pal.includes("gamaxis") && !pal.includes("multa") && !pal.includes("comum") && !pal.includes("iaonlyword") && !pal.includes("zebrinho"), JSON.stringify(rv));
  assert.ok(rv.usou_fundo && rv.usou_restante);
  assert.equal(V.sugerirVocabulario(casadas.slice(0, 5), rest, ["multa"], fundo).pouco, true); // menos de 8 casadas
  assert.equal(V.sugerirVocabulario(casadas, rest.slice(0, 5), ["multa"], null).sem_base, true); // sem fundo e sem restante
  assert.ok(V.blocoVocabulario({ pouco: true, n: 3 }, 1, 1, 10).join("\n").includes("mínimo 8"));
  // fundo ausente/ruim: carregarFundo devolve null sem exceção; o real existe e é válido
  process.env.TCERO_MCP_FUNDO_VOCAB = path.join(TMP, "nao-existe.json");
  V.limparFundoCache();
  assert.equal(V.carregarFundo(), null);
  delete process.env.TCERO_MCP_FUNDO_VOCAB;
  V.limparFundoCache();
  const real = V.carregarFundo();
  assert.ok(real && real.N >= 300 && real.df.licitacao > 100, "fundo_vocabulario.json ausente ou inválido");
  // palavras com nome de propriedade de Object não quebram o fundo
  assert.equal(V.tokensVocab("constructor prototype valueof licitacao").length, 4);
});

test("sugerir termos: ponta a ponta com 1.141 decisões (10 a 20 sugestões, sem o termo pedido, sem nome de relator, zero requisição no cache)", async () => {
  const d = dC2();
  let n = 0;
  idx._setDepsParaTeste({ consultarApi: async () => { n++; return d; } });
  const sg = await idx.sugerirTermosAsync("reincidência multa", null);
  assert.equal(n, 1);
  const itens = [...sg.split("\n").filter((l) => l.startsWith("- Palavras") || l.startsWith("- Pares")).join(" ").matchAll(/(?:«([^»]+)»|(?:^|, )([a-z]+)) \(\d+\/\d+\)/g)];
  const lista = itens.map((m) => m[1] || m[2]);
  assert.ok(lista.length >= 10 && lista.length <= 20, `${lista.length}\n${sg}`);
  assert.ok(!lista.some((x) => x.includes("reincid") || x.split(" ")[0] === "multa" || x === "multa"), lista.join(","));
  assert.ok(sg.includes("zero requisição extra") && sg.includes("indício e não conclusão") && sg.includes("fundo local"), sg.slice(0, 500));
  const nomes = new Set();
  for (const it of d.result) for (const w of L.fold(it.source.relator || "").match(/[a-z]{4,}/g) || []) nomes.add(w);
  assert.ok(!lista.some((x) => x.split(" ").some((w) => nomes.has(w))), lista.filter((x) => x.split(" ").some((w) => nomes.has(w))).join(","));
  assert.match(await idx.sugerirTermosAsync("", null), /Informe pelo menos um critério/);
  assert.match(await idx.sugerirTermosAsync("de ao", null), /Informe `texto_livre` ou `grupos`/);
  instalarFalsos();
});

// --------------------------------------------------------------------------------------------------------------------- //
// 5. triagem                                                                                                             //
// --------------------------------------------------------------------------------------------------------------------- //
test("triagem: modo inválido, sem PDF, com PDF, barata, recibo idêntico ao do modo completo, nunca rebaixa, falha de rede", async () => {
  instalarFalsos();
  idx._limparCachesParaTeste();
  chamadasPdf.length = 0;
  assert.match(await idx.obterAcordao(98114, null, null, false, "xyz"), /modo inválido: 'xyz'; use 'completo' ou 'triagem'\. Nenhuma requisição foi feita\./);
  assert.deepEqual(chamadasPdf, []);
  fs.rmSync(L.DIR_RECIBOS, { recursive: true, force: true });
  V.limparMemoRecibos();
  const tri0 = await idx.obterAcordao(98114, null, null, false, "triagem"); // sem PDF
  assert.ok(tri0.includes("TRIAGEM · APL-TC 00055/26 · id 98114") && tri0.includes("Citação: (TCE-RO - APL-TC 00055/26"), tri0.slice(0, 300));
  assert.ok(tri0.includes("Ementa (integral") && tri0.includes("Órgão julgador (cadastro): Pleno") && tri0.includes("Inteiro teor (PDF): https://tcero.tc.br/"));
  assert.ok(tri0.includes("não lido (use `ler_inteiro_teor=true`") && chamadasPdf.length === 0, tri0.slice(-400));
  assert.ok(tri0.includes("NUNCA serve para aspas") && !tri0.includes("Inteiro teor (PDF, extraído)"));
  assert.ok(!tri0.includes("Informações adicionais") && !tri0.includes("GERADO COM APOIO DE IA"));
  assert.equal(L.lerReciboTcero(98114).texto_pdf_completo, null); // recibo de ementa, como no modo completo
  const tri1 = await idx.obterAcordao(98114, null, null, true, "triagem"); // com PDF
  assert.equal(chamadasPdf.length, 1);
  assert.ok(tri1.includes("**Do PDF (sem o texto corrido)") && tri1.includes("- Estrutura: ACÓRDÃO") && tri1.includes("VOTO do relator (p. ~"), tri1.slice(-2500));
  assert.ok(tri1.includes("- Fecho (literal") && tri1.includes("ACORDAM os Senhores Conselheiros do Pleno") && tri1.includes("Órgão que o fecho declara: Pleno"));
  assert.ok(!tri1.split("- Fecho")[1].split("\n")[0].includes("Proc.: 02603/22")); // cabeçalho de página não vaza no fecho
  assert.ok(tri1.includes("- Linhas que os detectores marcam") && tri1.includes("parecer do MPC / corpo técnico") && tri1.includes("(p. ~"));
  assert.ok(!tri1.includes("Relatório e voto") && !tri1.includes("Inteiro teor (PDF, extraído)"));
  assert.ok(tri1.includes("NUNCA serve para aspas"));
  const full = await idx.obterAcordao(98114, null, null, true, "completo");
  assert.ok(tri1.length < 0.2 * full.length, `${tri1.length} vs ${full.length}`); // leitura barata
  assert.equal(chamadasPdf.length, 1, "o modo completo reaproveita o cache do PDF da triagem");
  // o recibo gravado pela triagem é IDÊNTICO ao do modo completo (não rebaixa nem promove)
  fs.rmSync(L.DIR_RECIBOS, { recursive: true, force: true });
  V.limparMemoRecibos();
  idx._limparCachesParaTeste();
  await idx.obterAcordao(98114, null, null, true, "triagem");
  const recTri = JSON.parse(fs.readFileSync(L.caminhoReciboTcero(98114), "utf-8"));
  fs.rmSync(L.DIR_RECIBOS, { recursive: true, force: true });
  idx._limparCachesParaTeste();
  await idx.obterAcordao(98114, null, null, true, "completo");
  const recComp = JSON.parse(fs.readFileSync(L.caminhoReciboTcero(98114), "utf-8"));
  assert.ok(V.reciboIntegro(recTri) && V.reciboIntegro(recComp));
  for (const k of ["gravado_em", "sha256_campos"]) { delete recTri[k]; delete recComp[k]; } // o hash dos campos inclui a hora da gravação
  assert.deepEqual(recTri, recComp);
  assert.ok(recTri.texto_pdf_completo !== null && recTri.texto.includes("ACORDAM"));
  // triagem SEM PDF depois de um recibo COM PDF não rebaixa
  await idx.obterAcordao(98114, null, null, false, "triagem");
  const recDep = JSON.parse(fs.readFileSync(L.caminhoReciboTcero(98114), "utf-8"));
  assert.ok(recDep.texto_pdf_completo !== null && recDep.texto.includes("ACORDAM"), "triagem sem PDF rebaixou o recibo");
  assert.ok(L.lerReciboTcero(98114) !== null); // hash íntegro
  // falha de rede no PDF: aviso explícito, nunca "não encontrado", e o diário anota
  idx._setDepsParaTeste({ baixarPdf: async () => { throw new L.LeituraPdfFalhou("falha de rede ao baixar o PDF (ConnectError simulado)"); } });
  idx._limparCachesParaTeste();
  fs.rmSync(L.DIR_RECIBOS, { recursive: true, force: true });
  const triF = await V.comDiario("obter_acordao_tcero", { modo: "triagem" }, () => idx.obterAcordao(98114, null, null, true, "triagem"));
  assert.ok(triF.includes("[LEITURA DE PDF NÃO REALIZADA") && !triF.includes("não encontrada") && triF.includes("Ementa (integral"), triF.slice(-500));
  assert.ok(V.lerErros(1).some((e) => e.tipo === "pdf_falha" && e.args.modo === "triagem"));
  // PDF que só cabe em parte / sem texto
  const parc = { texto: "x ".repeat(10), paginas: 400, paginas_lidas: 300, parcial: true, motivo_parcial: "teto de 400 páginas", chars_nao_espaco: 10, sem_texto: false, paginas_sem_texto: 0, erro: null };
  assert.ok(V.linhasTriagemPdf("texto", parc).join("\n").includes("extração PARCIAL (teto de 400 páginas)"));
  assert.ok(V.linhasTriagemPdf("", { sem_texto: true }).join("\n").includes("sem texto extraível"));
  instalarFalsos();
});

// --------------------------------------------------------------------------------------------------------------------- //
// 6. alertas que dizem onde                                                                                              //
// --------------------------------------------------------------------------------------------------------------------- //
test("alertas: OBITER com a frase, VOTO de outro conselheiro com o título, página aproximada do PDF", async () => {
  const tOb = "O relator examinou o recurso. Ainda que se admitisse a tese do recorrente, o prazo prescricional teria transcorrido " +
    "integralmente no caso concreto dos autos, razão pela qual nada mudaria no resultado final do julgamento.";
  const rOb = L.verificarTrecho({ ementa: tOb }, "o prazo prescricional teria transcorrido integralmente no caso concreto dos autos");
  const alOb = rOb.alertas.filter((a) => a.startsWith("OBITER DICTUM?"));
  assert.ok(alOb.length && alOb[0].includes("A frase: «Ainda que se admitisse a tese do recorrente,") && alOb[0].includes("» + o trecho."), JSON.stringify(rOb.alertas));
  assert.ok(alOb[0].split("sob «")[1].split("»")[0].toLowerCase().includes("ainda que se admitisse"));
  const rOb2 = L.verificarTrecho({ ementa: tOb }, "Ainda que se admitisse a tese do recorrente, o prazo prescricional teria transcorrido integralmente");
  const alOb2 = rOb2.alertas.filter((a) => a.startsWith("OBITER DICTUM?"));
  assert.ok(alOb2.length && alOb2[0].includes("A marca está no começo do próprio trecho citado."), JSON.stringify(rOb2.alertas));
  // voto de outro conselheiro: o título e a página aparecem (PDF real 77649, 35 páginas)
  const r77649 = await idx.extrairTextoPdf(fxPdf("77649.pdf"));
  const t77 = r77649.texto;
  const est77 = V.estruturaPdfTcero(t77);
  const outros77 = est77.filter(([r]) => r === "VOTO de outro conselheiro");
  assert.ok(outros77.length && outros77[0][1].startsWith("p. ~"), JSON.stringify(est77));
  const pOutro = t77.indexOf(outros77[0][2]) + outros77[0][2].length + 400;
  const posOutro = (await import("../server/posicao2.js")).posicaoTcero(t77, pOutro);
  assert.ok(posOutro.startsWith("VOTO de outro conselheiro (título: «") && posOutro.includes("não é o voto condutor"), posOutro);
  assert.ok(L.paginaPdfTcero(t77, pOutro).startsWith("p. ~"));
  assert.equal(L.paginaPdfTcero("sem cabeçalho de página", 5), "");
  assert.equal(L.paginaPdfTcero("", 0), "");
  // a página é a do cabeçalho "N de M" anterior ao ponto
  assert.ok(["", "p. ~1 de 35 do PDF"].includes(L.paginaPdfTcero(t77, 0)));
  assert.ok(L.paginaPdfTcero(t77, t77.length - 1).startsWith("p. ~3"));
  // _excertos_raw (recibo) continua devolvendo só texto; a variante com posição bate item a item
  const comPos = L.excertosRawComPos(t77, L.RE_PARECER_MPC_RAW);
  assert.deepEqual(comPos.map(([, e]) => e), L.excertosRaw(t77, L.RE_PARECER_MPC_RAW));
  assert.ok(comPos.every(([p]) => Number.isInteger(p)));
});

test("alerta de posição no verificador: PDF real mostra POSIÇÃO NO JULGADO com página", async () => {
  instalarFalsos();
  idx._limparCachesParaTeste();
  fs.rmSync(L.DIR_RECIBOS, { recursive: true, force: true });
  await idx.obterAcordao(98114, null, null, true);
  const out = await idx.verificarCitacao(98114, null, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS");
  assert.ok(out.includes("✅ VÁLIDO"), out);
  const m = /ℹ POSIÇÃO NO JULGADO: (.+)\./.exec(out);
  assert.ok(m, out);
  // ementa/dispositivo do cadastro vêm antes do primeiro cabeçalho de página: sem página; trecho do PDF: com "(p. ~N de M do PDF)"
  const out2 = await idx.verificarCitacao(98114, null, "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas");
  assert.match(out2, /POSIÇÃO NO JULGADO: .*\(p\. ~\d+ de \d+ do PDF\)\./, out2);
});

// --------------------------------------------------------------------------------------------------------------------- //
// 7. atualização, versão e manifest                                                                                      //
// --------------------------------------------------------------------------------------------------------------------- //
test("COMO_ATUALIZAR no aviso de versão e no rodapé de erro", () => {
  for (const t of ["git pull", ".mcpb", "reiniciar", "dois cliques"]) assert.ok(L.COMO_ATUALIZAR.includes(t), t);
  L.resetVersaoParaTeste();
  L.estadoVersao.versaoNovaCache = "9.9.9";
  const aviso = L.linhaAvisoVersao();
  assert.ok(aviso.includes("git pull") && aviso.includes(".mcpb") && aviso.includes(L.COMO_ATUALIZAR) && aviso.includes("atualize a extensão"), aviso);
  assert.ok(L.finalizarSaida("texto qualquer").includes("Há versão nova"));
  L.resetVersaoParaTeste();
  L.resetCreditoParaTeste();
});

test("versão 1.7.6 igual em manifest, package.json e lib; manifest lista todas as ferramentas registradas", async () => {
  const raiz = path.dirname(AQUI);
  const man = JSON.parse(fs.readFileSync(path.join(raiz, "manifest.json"), "utf-8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf-8"));
  assert.equal(L.VERSAO, "1.7.6");
  assert.equal(man.version, "1.7.6");
  assert.equal(pkg.version, "1.7.6");
  const esperadas = ["buscar_jurisprudencia_tcero", "obter_acordao_tcero", "verificar_citacao_tcero", "diagnostico_ritmo_tcero", "buscar_recibos_tcero", "diagnostico_erros_tcero", "linha_do_tempo_tcero", "sugerir_termos_tcero", "atualizar_extensao_tcero", "julgados_que_citam_tcero"];
  assert.deepEqual(man.tools.map((t) => t.name).sort(), [...esperadas].sort());
  // o arquivo do fundo de vocabulário está ao lado do servidor (é ele que vai no .mcpb) e o .mcpbignore não o exclui
  assert.ok(fs.existsSync(path.join(raiz, "server", "fundo_vocabulario.json")));
  const ign = fs.readFileSync(path.join(raiz, ".mcpbignore"), "utf-8");
  assert.ok(!/fundo_vocabulario|server/.test(ign), ign);
  // tools/list real (stdio) bate com o manifest
  const { spawn } = await import("node:child_process");
  const p = spawn(process.execPath, [path.join(raiz, "server", "index.js")], { env: { ...process.env, TCERO_MCP_SEM_AVISO_ATUALIZACAO: "1", TCERO_MCP_DIR_ESTADO: path.join(TMP, "estado-stdio") }, stdio: ["pipe", "pipe", "ignore"] });
  let saida = "";
  p.stdout.on("data", (d) => (saida += d));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  const ini = Date.now();
  while (!saida.includes('"id":1') && Date.now() - ini < 8000) await new Promise((r) => setTimeout(r, 100));
  p.kill();
  const resp = saida.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 1);
  assert.ok(resp, saida.slice(0, 300));
  assert.deepEqual(resp.result.tools.map((t) => t.name).sort(), [...esperadas].sort());
  const obter = resp.result.tools.find((t) => t.name === "obter_acordao_tcero");
  assert.deepEqual(obter.inputSchema.properties.modo.enum, ["completo", "triagem"]);
});
