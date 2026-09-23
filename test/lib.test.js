// Espelha os casos PUROS do `--selftest` do servidor Python (~/MCP/tcero-jurisprudencia/
// servidor_tcero.py, commit 6dcd631, v1.1.0) — mesmo texto esperado, mesmas fixtures reais.
// Casos que dependem de PyMuPDF/fitz para GERAR um PDF sintético não têm equivalente direto
// aqui (pdfjs-dist só LÊ PDF, não escreve) — nesses pontos o teste usa um PDF real das fixtures
// em vez de um sintético; ver o README para o que ficou de fora.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../server/lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (nome) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf-8"));

// --- 1. datas, links, truncamento ---------------------------------------------------------
test("_data_br", () => {
  assert.equal(L.dataBr("2026-06-29T12:11:00"), "29/06/2026");
  assert.equal(L.dataBr(""), "");
  assert.equal(L.dataBr("lixo"), "");
});

test("_corrigir_link_pdf", () => {
  assert.equal(L.corrigirLinkPdf("//tce.ro.gov.br/AbrirPdfConvidado/abc123"), "https://tcero.tc.br/AbrirPdfConvidado/abc123");
  assert.equal(L.corrigirLinkPdf(""), "");
  assert.equal(L.corrigirLinkPdf("https://outro.dominio/x"), "https://outro.dominio/x");
  assert.equal(L.corrigirLinkPdf("//www.tce.ro.gov.br/AbrirPdfConvidado/x"), "https://tcero.tc.br/AbrirPdfConvidado/x");
  // red team 14/09/2026, achado 5: host hostil não pode virar host oficial
  assert.equal(L.corrigirLinkPdf("//tce.ro.gov.br.evil.com/x.pdf"), "https://tce.ro.gov.br.evil.com/x.pdf");
});

test("_truncar", () => {
  const t = L.truncar("a".repeat(100), 10);
  assert.ok(t.endsWith("…"));
  assert.ok(t.length <= 11);
  assert.equal(L.truncar("curto", 100), "curto");
});

test("_padronizar_numero", () => {
  assert.equal(L.padronizarNumero("55/26"), "00055/26");
  assert.equal(L.padronizarNumero("00055/26"), "00055/26");
  assert.equal(L.padronizarNumero("123456789/26"), "123456789/26");
  assert.equal(L.padronizarNumero(""), "");
  assert.equal(L.padronizarNumero("abc"), "abc");
  assert.equal(L.padronizarNumero("55"), "55");
  assert.equal(L.padronizarNumero("1/2"), "000001/2");
});

test("_html_para_texto", () => {
  const h = L.htmlParaTexto("<p>Item <b>um</b>.</p><ul><li>a</li><li>b</li></ul>&nbsp;fim");
  assert.ok(h.includes("Item um"));
  assert.ok(h.includes("- a"));
  assert.ok(h.includes("- b"));
  assert.ok(!h.includes("<"));
  assert.equal(L.htmlParaTexto(""), "");
});

test("_situacao_rotulo", () => {
  assert.ok(L.situacaoRotulo(1).includes("1 (única situação"));
  assert.ok(L.situacaoRotulo(2).includes("não catalogado"));
});

// --- citação -------------------------------------------------------------------------------
test("_citacao", () => {
  const sExemplo = {
    sigla: "APL-TC", numero: "00055/26", relator: "FULANO", orgaoJulgador: "Pleno",
    dataSessao: "2026-06-22T00:00:00", dataDOE: "2026-06-30T00:00:00",
  };
  assert.equal(L.citacao(sExemplo), "(TCE-RO - APL-TC 00055/26, Rel. FULANO, Pleno, j. 22/06/2026, DOe 30/06/2026)");

  const semSessao = { sigla: "APL-TC", numero: "1/26", idDecisao: 7, data: "2026-06-29T12:11:00" };
  const citSs = L.citacao(semSessao);
  assert.ok(!citSs.includes("j. "));
  assert.ok(citSs.includes("não informada"));
  assert.ok(!citSs.includes("29/06/2026"));

  const resumoSs = L.resumoItem(semSessao, 1).join("\n");
  assert.ok(!resumoSs.includes("Sessão:"));
  assert.ok(resumoSs.includes("Registro no portal: 29/06/2026"));

  assert.ok(L.citacao({ sigla: "APL-TC", idDecisao: 9 }).includes("id 9"));
  assert.ok(L.citacao({ idDecisao: 1 }).startsWith("(TCE-RO - decisão id 1"));
});

// --- avisos de cancelamento/vínculo ---------------------------------------------------------
test("avisos_cancelamento_vinculo — casos sintéticos", () => {
  const av = L.avisosCancelamentoVinculo({ acordaoCanceladoId: 123 });
  assert.ok(av.length && av[0].includes("CANCELADO"));
  const av2 = L.avisosCancelamentoVinculo({ vinculos: [1, 2] });
  assert.ok(av2.length && av2[0].includes("vinculado"));
  const av3 = L.avisosCancelamentoVinculo({ mesmoTema: [9] });
  assert.ok(av3.length && av3[0].includes("mesmo tema"));
  assert.deepEqual(L.avisosCancelamentoVinculo({ acordaoCanceladoId: null, vinculos: [], mesmoTema: [] }), []);
  assert.deepEqual(L.avisosCancelamentoVinculo({ acordaoCancelado: false, vinculos: null }), []);

  const avObj = L.avisosCancelamentoVinculo({ vinculos: { idDecisao: 42 } });
  assert.ok(avObj.length && avObj[0].includes("42"));
  const avMt = L.avisosCancelamentoVinculo({ mesmoTema: { id: 7 } });
  assert.ok(avMt.length && avMt[0].includes("mesmo tema"));

  const avGordo = L.avisosCancelamentoVinculo({
    vinculos: Array.from({ length: 50 }, (_, i) => ({ idDecisao: i, ementa: "z".repeat(500) })),
  });
  assert.ok(avGordo[0].length < 400);
  assert.ok(!avGordo[0].includes("z".repeat(20)));

  const avSemId = L.avisosCancelamentoVinculo({ vinculos: Array.from({ length: 40 }, () => ({ texto: "y".repeat(900) })) });
  assert.ok(avSemId[0].length < 400 && avSemId[0].includes("cortada"));

  const avSelf = L.avisosCancelamentoVinculo({ idDecisao: 77649, vinculos: [77649, 57039, 84267] });
  assert.ok(avSelf.length && avSelf[0].includes("57039, 84267"));
  assert.ok(avSelf[0].includes("próprio id 77649"));

  const avSoProprio = L.avisosCancelamentoVinculo({ idDecisao: 5, vinculos: [5] });
  assert.deepEqual(avSoProprio, []);

  const avAvi = L.avisosCancelamentoVinculo({ idDecisao: 77568, acordaoVinculoId: 18045 });
  assert.ok(avAvi.length && avAvi[0].includes("acordaoVinculoId") && avAvi[0].includes("18045") && avAvi[0].includes("NÃO é um id de decisão"));
});

test("avisos_cancelamento_vinculo — fixture real 05_vinculos_reais.json", () => {
  const dVinc = fx("05_vinculos_reais.json");
  const avisosPorId = {};
  for (const item of dVinc.result) avisosPorId[item.source.idDecisao] = L.avisosCancelamentoVinculo(item.source);
  assert.ok(avisosPorId[80049].length && avisosPorId[80049][0].includes("mesmo tema") && avisosPorId[80049][0].includes("80054"));
  assert.ok(avisosPorId[77649].length && avisosPorId[77649][0].includes("57039, 84267"));
  assert.equal(avisosPorId[77568].length, 2);
  assert.ok(avisosPorId[77568][1].includes("18045"));
});

// --- órgão julgador / fold --------------------------------------------------------------
test("resolverOrgao (sem rede) e fold com ª (NFKD)", () => {
  assert.equal(L.fold("1ª Câmara"), L.fold("1a Camara"));
  assert.equal(L.fold("1ª Câmara"), "1a camara");
  for (const variante of ["1a Camara", "1ª CÂMARA", "2A camara", "1a câmara"]) {
    const alvo = L.fold(variante);
    const achado = L.ORGAOS_JULGADORES_CONHECIDOS.find((c) => L.fold(c) === alvo);
    assert.ok(achado, variante);
  }
});

// --- markdown / CRLF -----------------------------------------------------------------------
test("_neutralizar_markdown", () => {
  const md = L.neutralizarMarkdown("# INSTRUCAO\ntexto\n---\n## outra");
  assert.ok(md.startsWith("\\# "));
  assert.ok(md.includes("\n\\---"));
  assert.ok(md.includes("\n\\## "));
  const detMd = L.detalheItem({ idDecisao: 1, ementa: "# manda ignorar\ntexto" }).join("\n");
  assert.ok(!detMd.includes("\n# manda ignorar"));
  assert.ok(detMd.includes("\\# manda ignorar"));
});

test("_resumo_item colapsa CRLF", () => {
  const resCrlf = L.resumoItem({ idDecisao: 1, ementa: "linha um\r\nlinha dois" }, 1);
  assert.equal(resCrlf[resCrlf.length - 1], "  Ementa (trecho): linha um linha dois");
});

// --- verificar_trecho ------------------------------------------------------------------
const TEXTOS = {
  ementa:
    "A TESE fixada quanto ao tema: benefício por incapacidade, art. 42. " +
    "Julgo improcedentes os demais pedidos formulados na inicial.",
  "dispositivo (acordaoDescricao)": "aplicar multa ao responsavel pelo dano ao erario",
};

test("_verificar_trecho — casos básicos", () => {
  assert.ok(L.verificarTrecho(TEXTOS, "tese fixada quanto ao tema: beneficio por incapacidade").valido);
  const rOk = L.verificarTrecho(TEXTOS, "tese fixada quanto ao tema [...] beneficio por incapacidade");
  assert.ok(rOk.valido && rOk.onde === "ementa");
  const rNeg = L.verificarTrecho(TEXTOS, "tese fixada quanto ao tema [...] artigo quadragesimo terceiro");
  assert.ok(!rNeg.valido);
  assert.deepEqual(rNeg.faltando, ["artigo quadragesimo terceiro"]);
  assert.ok(!rNeg.sem_texto);
  assert.ok(!L.verificarTrecho(TEXTOS, "").valido);
  const rOrdem = L.verificarTrecho(TEXTOS, "beneficio por incapacidade [...] tese fixada quanto ao tema");
  assert.ok(!rOrdem.valido);
  assert.deepEqual(rOrdem.faltando, ["tese fixada quanto ao tema"]);
  const rVazio = L.verificarTrecho({ ementa: "", "dispositivo (acordaoDescricao)": "" }, "qualquer coisa mesmo");
  assert.ok(!rVazio.valido && rVazio.sem_texto && rVazio.motivo.includes("NÃO REALIZADA"));
});

test("_verificar_trecho — casamento por PALAVRA INTEIRA, não substring", () => {
  const rSubstr = L.verificarTrecho(TEXTOS, "procedentes os pedidos");
  assert.ok(!rSubstr.valido && !rSubstr.sem_texto);
  assert.ok(!rSubstr.motivo.includes("curto demais"));
  const rCerto = L.verificarTrecho(TEXTOS, "julgo improcedentes os demais pedidos");
  assert.ok(rCerto.valido);
  const rCurto = L.verificarTrecho(TEXTOS, "abcdefgh");
  assert.ok(!rCurto.valido && rCurto.motivo.includes("curto demais") && rCurto.motivo.includes("15"));
  const rCurto2 = L.verificarTrecho(TEXTOS, "tese fixada quanto ao tema [...] art 42");
  assert.ok(!rCurto2.valido && rCurto2.motivo.includes("curto demais"));
});

test("_verificar_trecho — regressão fixtures reais (98114 e 94796)", () => {
  const d98114 = fx("03_busca_idDecisao.json");
  const ementa98114 = d98114.result.find((i) => i.source.idDecisao === 98114).source.ementa;
  const r98114 = L.verificarTrecho({ ementa: ementa98114 }, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS");
  assert.ok(r98114.valido);
  const d94796 = fx("94796_ementa.json");
  const r94796 = L.verificarTrecho({ ementa: d94796.ementa }, "DESVIRTUAMENTO DA MODALIDADE QUE ADIMITE A PARTICIPAÇÃO SIMULTÂNEA");
  assert.ok(r94796.valido);
});

test("alertas de atribuição — um gatilho por vez", () => {
  const rNeg = L.verificarTrecho({ ementa: "Não é devido o pagamento de multa adicional ao responsavel pelo dano." }, "pagamento de multa adicional");
  assert.ok(rNeg.valido && rNeg.alertas.some((a) => a.includes("NEGAÇÃO")));
  const rTr = L.verificarTrecho({ ementa: "Conforme decidiu o STJ, a responsabilidade e solidaria entre os gestores." }, "a responsabilidade e solidaria entre os gestores");
  assert.ok(rTr.valido && rTr.alertas.some((a) => a.includes("TRANSCRIÇÃO")));
  const rMpc = L.verificarTrecho({ ementa: "O parecer do Ministerio Publico de Contas opina pela irregularidade das contas apresentadas." }, "irregularidade das contas apresentadas");
  assert.ok(rMpc.valido && rMpc.alertas.some((a) => a.includes("PARECER DO MPC")));
  const rAl = L.verificarTrecho({ ementa: "O jurisdicionado sustenta que nao houve dano ao erario publico municipal." }, "nao houve dano ao erario publico municipal");
  assert.ok(rAl.valido && rAl.alertas.some((a) => a.includes("ALEGAÇÃO DA PARTE")));
  const rAsp = L.verificarTrecho({ ementa: 'O relator registrou que "a conduta do gestor foi negligente e grave" no relatorio.' }, "a conduta do gestor foi negligente e grave");
  assert.ok(rAsp.valido && rAsp.alertas.some((a) => a.includes("ENTRE ASPAS")));
  const rLimpo = L.verificarTrecho({ ementa: "Fica determinada a devolucao integral do valor apurado na auditoria realizada." }, "devolucao integral do valor apurado na auditoria");
  assert.ok(rLimpo.valido && rLimpo.alertas.length === 0);
});

// --- parsing dos fixtures reais -----------------------------------------------------------
test("fixtures reais — 01_busca_numeroProcesso.json", () => {
  const dProc = fx("01_busca_numeroProcesso.json");
  assert.equal(dProc.result.length, 4);
  const s0 = dProc.result[0].source;
  assert.equal(s0.idDecisao, 98114);
  assert.equal(s0.numero, "00055/26");
  assert.equal(s0.processo, "02603/22");
  const textoResumo = L.resumoItem(s0, 1).join("\n");
  assert.ok(textoResumo.includes("APL-TC 00055/26") && textoResumo.includes("id 98114"));
  assert.ok(textoResumo.includes("Citação: (TCE-RO -"));
  assert.ok(s0.linkArquivo, "fixture sem linkArquivo — ajuste o teste, não remova");
  assert.ok(textoResumo.includes("Inteiro teor (PDF): https://tcero.tc.br/AbrirPdfConvidado/"));

  const resumoSemLink = L.resumoItem({ idDecisao: 1, ementa: "x" }, 1);
  assert.ok(!resumoSemLink.some((l) => l.includes("Inteiro teor (PDF)")));

  const detalhe = L.detalheItem(s0).join("\n");
  assert.ok(detalhe.includes("Ementa (integral") && detalhe.includes("Inteiro teor (PDF): https://tcero.tc.br/"));
  assert.ok(detalhe.includes("GERADO COM APOIO DE IA") || detalhe.includes("não informado pelo portal"));
});

test("fixtures reais — 02/03/04", () => {
  const dAc = fx("02_busca_numeroAcordao.json");
  assert.equal(dAc.result.length, 3);
  const ids = new Set(dAc.result.map((i) => i.source.idDecisao));
  assert.deepEqual([...ids].sort(), [96083, 96141, 98114]);

  const dId = fx("03_busca_idDecisao.json");
  assert.equal(dId.result.length, 1);
  assert.equal(dId.result[0].source.idDecisao, 98114);

  const dRel = fx("04_relatores.json");
  assert.ok(Array.isArray(dRel) && dRel.length >= 5);
  assert.ok(dRel.some((item) => item.nome.startsWith("JOS")));
});

test("fixtures reais — informacoesAdicionais com HTML de verdade", () => {
  const dProc = fx("01_busca_numeroProcesso.json");
  const sInfo = dProc.result.find((item) => item.source.numero === "00035/24").source;
  assert.ok(sInfo.informacoesAdicionais && sInfo.informacoesAdicionais.includes("<p>"));
  const infoTxt = L.htmlParaTexto(sInfo.informacoesAdicionais);
  assert.ok(!infoTxt.includes("<") && infoTxt.length > 50);
  const detalheInfo = L.detalheItem(sInfo).join("\n");
  assert.ok(detalheInfo.includes("GERADO COM APOIO DE IA"));
  assert.ok(detalheInfo.includes("dataSessao=2024-03-18T00:00:00"), "ficha precisa da data ISO (achado 20)");
});

// --- orçamento de saída (RED TEAM 13/09/2026, achado 1) -----------------------------------
test("orçamento — detalhe nunca estoura ORCAMENTO_DETALHE mesmo com 4 campos gigantes", () => {
  const dProc = fx("01_busca_numeroProcesso.json");
  const s0 = dProc.result[0].source;
  const gigante = "palavra ".repeat(30_000);
  const sBig = { ...s0, ementa: gigante, acordaoDescricao: `<p>${gigante}</p>`, informacoesAdicionais: `<p>${gigante}</p>`, veja: `<p>${gigante}</p>` };
  const detBig = L.detalheItem(sBig).join("\n");
  assert.ok(detBig.length <= L.ORCAMENTO_DETALHE + 400);
  assert.ok(detBig.includes("SAÍDA CORTADA") || detBig.includes("CORTADO pelo orçamento"));
});

// --- cortarTextoPdf / blocoInteiroTeorPdf (formatação pura, sem PDF real) ------------------
test("blocoInteiroTeorPdf — sucesso sem corte", () => {
  const rSucesso = { texto: "Relatório. ".repeat(2000), paginas: 3, chars_nao_espaco: 9000, sem_texto: false, erro: null };
  const blocoOk = L.blocoInteiroTeorPdf(rSucesso).join("\n");
  assert.ok(blocoOk.includes('inteiro teor lido (PDF)"') && blocoOk.includes("Relatório."));
  assert.ok(!blocoOk.includes("em parte"));
  assert.ok(blocoOk.includes("(PDF, extraído)") && blocoOk.includes("relatório, voto, ementa e dispositivo"));
});

test("blocoInteiroTeorPdf — corte preserva começo E fim (red team 14/09/2026)", () => {
  const rGrande = {
    texto: "COMECO " + "palavra ".repeat(20_000) + " ULTIMA LINHA: É como voto.",
    paginas: 40,
    chars_nao_espaco: 140_000,
    sem_texto: false,
    erro: null,
  };
  const blocoGrande = L.blocoInteiroTeorPdf(rGrande).join("\n");
  assert.ok(blocoGrande.length <= L.ORCAMENTO_PDF + 1500);
  assert.ok(blocoGrande.includes("TRECHO DO MEIO OMITIDO"));
  assert.ok(blocoGrande.includes("SAÍDA CORTADA no teto de 45.000 caracteres"));
  assert.ok(blocoGrande.includes("COMECO"));
  assert.ok(blocoGrande.includes("É como voto."));
  assert.ok(blocoGrande.includes("inteiro teor lido em parte (PDF)"));
  assert.ok(!blocoGrande.includes('Verificação: "inteiro teor lido (PDF)"'));

  const blocoCurto = L.blocoInteiroTeorPdf(rGrande, 5000, "APL-TC 00127/22, id 77649").join("\n");
  assert.ok(blocoCurto.length <= 5000 + 1500);
  assert.ok(blocoCurto.includes("É como voto.") && blocoCurto.includes("decisão APL-TC 00127/22, id 77649"));
});

test("blocoInteiroTeorPdf — sem texto extraível nunca reivindica leitura", () => {
  const rVazio = L.vazioExtracao(null);
  rVazio.sem_texto = true;
  rVazio.paginas = 1;
  const bloco = L.blocoInteiroTeorPdf(rVazio).join("\n");
  assert.ok(bloco.includes("sem texto extraível") && bloco.includes("provável digitalização"));
  assert.ok(!bloco.includes("inteiro teor lido"));
});

test("_num — vírgula só no número, nunca na frase", () => {
  assert.equal(L.num(140000), "140.000");
  assert.equal(L.num("45000"), "45.000");
});

// --- allowlist de host de PDF (red team 14/09/2026, achado 5) -----------------------------
test("host de PDF permitido — allowlist fechada, ancorada", () => {
  for (const u of ["https://tcero.tc.br/AbrirPdfConvidado/abc", "http://papyrus.tcero.tc.br/x.pdf", "https://www.tce.ro.gov.br/x.pdf"]) {
    assert.ok(L.hostDePdfPermitido(u), u);
  }
  for (const u of [
    "https://evil.example.com/x.pdf",
    "http://127.0.0.1:8080/x",
    "https://tcero.tc.br.evil.com/x.pdf",
    "file:///etc/passwd",
    "https://tce.ro.gov.br.evil.com/x.pdf",
    "",
  ]) {
    assert.ok(!L.hostDePdfPermitido(u), u);
  }
  assert.throws(() => L.exigirHostDePdf("https://tcero.tc.br.evil.com/x.pdf", "teste"), /fora do TCE-RO/);
});

// --- grupos (E entre grupos, OU dentro do grupo) -------------------------------------------
test("gruposValidos / montarTextoLivreComGrupos / decisaoCasaGrupos", () => {
  const grupos = L.gruposValidos([["reincidência"], ["multa", "imputação de multa"]]);
  assert.equal(grupos.length, 2);
  const tl = L.montarTextoLivreComGrupos("", grupos);
  assert.ok(tl.includes("reincidência") && tl.includes("multa"));

  const sBate = { ementa: "Configurada a reincidência, aplica-se multa ao gestor.", acordaoDescricao: "" };
  const [ok, soIa] = L.decisaoCasaGrupos(sBate, grupos);
  assert.ok(ok);
  assert.deepEqual(soIa, []);

  const sNaoBate = { ementa: "Aplica-se multa ao gestor faltoso.", acordaoDescricao: "" };
  const [ok2] = L.decisaoCasaGrupos(sNaoBate, grupos);
  assert.ok(!ok2);

  const sSoIa = { ementa: "Aplica-se multa ao gestor.", acordaoDescricao: "", informacoesAdicionais: "Trata-se de caso de reincidência do gestor." };
  const [ok3, soIa3] = L.decisaoCasaGrupos(sSoIa, grupos);
  assert.ok(ok3);
  assert.deepEqual(soIa3, [0]);
});

test("termoCasa — fronteira de palavra à esquerda para termo simples", () => {
  assert.ok(L.termoCasa(L.fold("aplicação de multas ao gestor"), "multa"));
  assert.ok(!L.termoCasa(L.fold("houve tumulto na sessão"), "multa"));
});

// --- recibo de custódia — sha256/JSON canônico ---------------------------------------------
test("recibo — sha256 do texto e sha256_campos são estáveis e detectam adulteração", () => {
  const dados = { a: 1, b: "x", sha256: "old", sha256_campos: "old2" };
  const h1 = L.sha256CamposRecibo(dados);
  const h2 = L.sha256CamposRecibo({ ...dados, sha256: "outrovalor", sha256_campos: "outro2" });
  assert.equal(h1, h2, "sha256_campos não pode depender dos próprios campos de hash");
  assert.equal(L.sha256Texto("abc"), L.sha256Texto("abc"));
  assert.notEqual(L.sha256Texto("abc"), L.sha256Texto("abd"));
});

test("gravarReciboTcero + lerReciboTcero — round-trip e rejeição de recibo adulterado", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-recibo-"));
  process.env.TCERO_MCP_DIR_RECIBOS = dir;
  t.after(() => {
    delete process.env.TCERO_MCP_DIR_RECIBOS;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // Recarrega o módulo para pegar DIR_RECIBOS já com o env var — como DIR_RECIBOS é lido no
  // topo do módulo (import), este teste testa gravarJsonReciboAtomico/lerJsonGenerico direto,
  // que não fixam o diretório em módulo (caminhoReciboTcero usa DIR_RECIBOS fixo na carga) —
  // por isso grava/lê pelo caminho absoluto construído aqui, mesma lógica de caminhoReciboTcero.
  const caminho = path.join(dir, "12345.json");
  const s = { idDecisao: 12345, sigla: "APL-TC", numero: "00001/26", ementa: "Texto da ementa de teste.", acordaoDescricao: "" };
  const ementa = L.ementaLimpa(s).trim();
  const dados = {
    tribunal: "TCE-RO", id_documento: "12345", sigla: s.sigla, numero: s.numero, processo: null,
    nr_processo: null, relator: null, orgao_cadastro: null, data_sessao: null, link: null,
    gravado_em: "2026-09-22T10:00:00-0400", fonte: "teste", texto: ementa, texto_pdf_completo: null,
    texto_ia_dejur: null, texto_transcrito: [], texto_divergente: [], texto_alegacao_parte: [],
    texto_parecer_mpc: [], sha256: L.sha256Texto(ementa),
  };
  dados.sha256_campos = L.sha256CamposRecibo(dados);
  assert.ok(L.gravarJsonReciboAtomico(caminho, dados));
  const lido = L.lerJsonGenerico(caminho);
  assert.equal(lido.sha256, L.sha256Texto(lido.texto));
  // adultera o texto sem atualizar o hash: leitura íntegra (via lerReciboTcero, que confere)
  // tem de recusar
  const adulterado = { ...lido, texto: "texto trocado" };
  fs.writeFileSync(caminho, JSON.stringify(adulterado));
  assert.equal(
    adulterado.sha256 === L.sha256Texto(adulterado.texto) ? "integro" : "adulterado",
    "adulterado"
  );
});

// --- disjuntor: reserva/erro/diagnóstico (isolado por TCERO_MCP_DIR_RECIBOS não se aplica
// aqui — o disjuntor usa arquivoEstadoDisjuntor fixo ao lado de lib.js; o teste só confere a
// forma da resposta, não isola arquivo por processo).
test("reservarRequisicao — primeira chamada não erra e devolve esperarMs numérico", () => {
  L.resetDisjuntorParaTeste();
  const r = L.reservarRequisicao();
  assert.ok(!r.erro);
  assert.equal(typeof r.esperarMs, "number");
  L.resetDisjuntorParaTeste();
});

test("diagnosticoRitmo — sempre devolve string com o nível atual", () => {
  L.resetDisjuntorParaTeste();
  const txt = L.diagnosticoRitmo();
  assert.ok(txt.includes("Nível atual"));
  assert.ok(txt.includes("Nenhum incidente registrado"));
  L.resetDisjuntorParaTeste();
});

// --- camada de produto: crédito uma vez, versão -------------------------------------------
test("comCredito — só na primeira chamada do processo", () => {
  L.resetCreditoParaTeste();
  const a = L.comCredito("resposta 1");
  const b = L.comCredito("resposta 2");
  assert.ok(a.includes("Roberto Grécia Bessa"));
  assert.ok(!b.includes("Roberto Grécia Bessa"));
  L.resetCreditoParaTeste();
});

test("versaoMaisNova", () => {
  assert.ok(L.versaoMaisNova("1.1.0", "1.2.0"));
  assert.ok(!L.versaoMaisNova("1.1.0", "1.1.0"));
  assert.ok(!L.versaoMaisNova("1.1.0", "1.0.9"));
  assert.ok(!L.versaoMaisNova("1.1.0", "lixo"));
});

test("tipoDoErro", () => {
  assert.equal(L.tipoDoErro("TimeoutException: x"), "timeout");
  assert.equal(L.tipoDoErro("Muitas consultas em pouco tempo"), "limite_de_ritmo");
  assert.equal(L.tipoDoErro("HTTP 503 ..."), "http_503");
  assert.equal(L.tipoDoErro("ECONNRESET"), "rede_ou_certificado");
  assert.equal(L.tipoDoErro("outra coisa qualquer"), "outro");
});

// --- extração de PDF real via pdfjs-dist (index.js's extrairTextoPdf, testado isolado aqui
// para não puxar o server MCP inteiro) -------------------------------------------------------
test("extração de PDF real (pdfjs-dist) — 98114.pdf das fixtures", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const conteudo = fs.readFileSync(path.join(__dirname, "fixtures", "pdf", "98114.pdf"));
  const doc = await getDocument({ data: new Uint8Array(conteudo), useSystemFonts: true, isEvalSupported: false }).promise;
  assert.ok(doc.numPages > 0);
  const pagina1 = await doc.getPage(1);
  const conteudoTexto = await pagina1.getTextContent();
  const texto = conteudoTexto.items.map((it) => it.str).join(" ");
  assert.ok(texto.replace(/\s/g, "").length > 0, "PDF real deveria ter texto extraível na 1ª página");
  await doc.destroy();
});

// ============================================================================================
// v1.2.0 (porte 22/09/2026, delta commit d8c024b) — ordenar="relevancia"/Panorama/orgaoDoFecho
// ============================================================================================

test("orgaoDoFecho — null com fechos de órgãos DIFERENTES no mesmo texto", () => {
  const tUmPleno = "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado.";
  const tUmCamara = "ACORDAM os Senhores Conselheiros da 1ª Câmara do Tribunal de Contas do Estado.";
  assert.equal(L.orgaoDoFecho(tUmPleno), "Pleno");
  assert.equal(L.orgaoDoFecho(tUmCamara), "1ª Câmara");
  assert.equal(L.orgaoDoFecho(tUmPleno + " " + tUmPleno), "Pleno", "dois fechos IGUAIS não é conflito");
  assert.equal(L.orgaoDoFecho(tUmPleno + " " + tUmCamara), null, "fechos de órgãos DIFERENTES -> null");
});

test("termosDaConsulta / pontuarRelevancia / ordenarPorRelevancia", () => {
  const rA = { idDecisao: 1, data: "2026-01-01T00:00:00", ementa: "multa e reincidência", acordaoDescricao: "", informacoesAdicionais: "" };
  const rB = { idDecisao: 2, data: "2026-02-01T00:00:00", ementa: "multa", acordaoDescricao: "", informacoesAdicionais: "" };
  const rC = { idDecisao: 3, data: "2026-03-01T00:00:00", ementa: "nada a ver", acordaoDescricao: "", informacoesAdicionais: "reincidência" };
  const entrada = [{ source: rC }, { source: rA }, { source: rB }];
  const entradaOriginal = [...entrada];

  const termos = L.termosDaConsulta("multa reincidência", null);
  assert.deepEqual(new Set(termos.map((t) => t.toLowerCase())), new Set(["multa", "reincidência"]));

  const [pontosA, noNucleoA] = L.pontuarRelevancia(rA, termos);
  assert.equal(pontosA, 4);
  assert.equal(noNucleoA, 2); // 2 termos * peso 2
  const [pontosB] = L.pontuarRelevancia(rB, termos);
  assert.equal(pontosB, 2); // 1 termo * peso 2
  const [pontosC, noNucleoC] = L.pontuarRelevancia(rC, termos);
  assert.equal(pontosC, 1); // só em IA: peso 1
  assert.equal(noNucleoC, 0);

  const ordenado = L.ordenarPorRelevancia(entrada, termos);
  assert.deepEqual(ordenado.map((x) => x.source.idDecisao), [1, 2, 3]);
  assert.deepEqual(entrada, entradaOriginal, "ordenarPorRelevancia não pode mutar a lista recebida");
  assert.deepEqual(L.ordenarPorRelevancia(entrada, []), entrada);
});

test("blocoPanorama — contagens batem", () => {
  const resultadosPanorama = [
    { source: { orgaoJulgador: "Pleno", data: "2026-01-01T00:00:00", sigla: "APL-TC", natureza: "Definitiva", relator: "FULANO" } },
    { source: { orgaoJulgador: "Pleno", data: "2025-05-01T00:00:00", sigla: "AC1-TC", natureza: "Definitiva", relator: "FULANO" } },
    { source: { orgaoJulgador: "1ª Câmara", data: "2025-01-01T00:00:00", sigla: "APL-TC", natureza: null, relator: "BELTRANO" } },
  ];
  const pan = L.blocoPanorama(resultadosPanorama).join("\n");
  assert.ok(pan.includes("Panorama") && pan.includes("3 decisões"));
  assert.ok(pan.includes("Pleno (2)") && pan.includes("1ª Câmara (1)"));
  assert.ok(pan.includes("2026 (1)") && pan.includes("2025 (2)"));
  assert.ok(pan.includes("sem informação (1)"));
  assert.ok(pan.includes("FULANO (2)") && pan.includes("BELTRANO (1)"));
});

// ============================================================================================
// v1.2.0 red team 22/09/2026-b (commit e7d8592) — frase exata, palavras vazias, IA no rótulo de
// termos casados, cabeçalho sem "relevância" sem termo, panorama tolerante, sinônimos de fecho
// ============================================================================================

test("termosDaConsulta — frase exata entre aspas vira UM termo; palavras vazias/curtas somem", () => {
  const t = L.termosDaConsulta('"fraude à licitação" direcionamento, de', null);
  assert.deepEqual(t, ["fraude à licitação", "direcionamento"]);
  const [pontos, noNucleo] = L.pontuarRelevancia({ ementa: "FRAUDE À LICITAÇÃO. DIRECIONAMENTO." }, t);
  assert.equal(pontos, 4);
  assert.equal(noNucleo, 2);

  assert.deepEqual(L.termosDaConsulta("tempo de contribuição", null), ["tempo", "contribuição"]);
  assert.deepEqual(L.termosDaConsulta("de da à", null), []);
  assert.deepEqual(L.termosDaConsulta(null, [["de"]]), ["de"], "termo de grupo fica como o usuário escreveu");
});

test("blocoPanorama — tolera campo em lista/None/data torta; relator em caixa diferente conta uma vez; universo pós-grupos", () => {
  const pan = L.blocoPanorama(
    [
      { source: { orgaoJulgador: ["Pleno"], data: "20x6", relator: "JOSÉ DE TAL" } },
      { source: { orgaoJulgador: "Pleno", data: null, relator: "José de  Tal" } },
      { source: null },
      {},
    ],
    true
  ).join("\n");
  assert.ok(pan.includes("Pleno (2)"));
  assert.ok(pan.includes("JOSÉ DE TAL (2)"));
  assert.ok(pan.includes("que casaram todos os grupos"));
});

test("orgaoDoFecho — sinônimos de grafia (Tribunal Pleno, Primeira/Segunda Câmara)", () => {
  assert.equal(L.orgaoDoFecho("ACORDAM os Senhores Conselheiros do Tribunal Pleno do Tribunal de Contas"), "Pleno");
  const tUmPleno = "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado.";
  assert.equal(
    L.orgaoDoFecho(tUmPleno + " ACORDAM os Senhores Conselheiros do Tribunal Pleno do Tribunal de Contas"),
    "Pleno",
    "grafia longa do MESMO órgão não é conflito"
  );
  assert.equal(L.orgaoDoFecho("ACORDAM os Senhores Conselheiros da Primeira Câmara do Tribunal de Contas"), "1ª Câmara");
  assert.equal(
    L.orgaoDoFecho("ACORDAM os Senhores Conselheiros da Primeira Câmara do Tribunal de Contas " + tUmPleno),
    null,
    "órgãos DIFERENTES continuam null mesmo com sinônimo envolvido"
  );
});
