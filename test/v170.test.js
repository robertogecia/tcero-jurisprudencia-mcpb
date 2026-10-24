// Espelha o bloco "v1.7.0" do `--selftest` do servidor Python (servidor_tcero.py, commit 785c88a): TESE DA EMENTA · VOZ DA CASA ·
// julgados_que_citam_tcero · placar · consulta pouco seletiva · corte por resultado · recibo idêntico ao da 1.6.0.
// 100% offline: fixtures, pastas temporárias, rede trocada por falsos (nenhum pedido ao portal do TCE-RO).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-v170-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const V = await import("../server/v160.js");
const V7 = await import("../server/v170.js");
const idx = await import("../server/index.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const fx = (nome) => JSON.parse(fs.readFileSync(path.join(AQUI, "fixtures", nome), "utf-8"));
const fxPdf = (nome) => fs.readFileSync(path.join(AQUI, "fixtures", "pdf", nome));
const dBig = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(AQUI, "fixtures", "exp_C2_controle_or.json.gz"))).toString("utf-8"));
const s98114 = fx("03_busca_idDecisao.json").result.find((i) => i.source.idDecisao === 98114).source;
const api = (fn) => idx._setDepsParaTeste({ consultarApi: fn });
const semRede = async () => { throw new Error("o teste da v1.7.0 não pode tocar a rede"); };
idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });

const CAMPOS_V160 = ["tribunal", "id_documento", "sigla", "numero", "processo", "nr_processo", "relator", "orgao_cadastro", "data_sessao",
  "link", "gravado_em", "fonte", "texto", "texto_pdf_completo", "texto_ia_dejur", "texto_transcrito", "texto_divergente",
  "texto_alegacao_parte", "texto_parecer_mpc", "sha256", "sha256_campos"];

// ---------- item 1: TESE DA EMENTA ----------
test("tese da ementa: literal, nos três modos, ausente no modelo antigo e no modelo novo sem rótulo", () => {
  const te = L.teseDaEmenta(L.ementaLimpa(s98114));
  assert.ok(te && te.completa && te.texto.startsWith("O descumprimento injustificado de determinação expedida"), JSON.stringify(te));
  const lt = L.linhaTese(te);
  assert.ok(lt.startsWith('- TESE DA EMENTA (literal; tese enunciada pelo órgão, não prova de ratio; para aspas, confira com verificar_citacao_tcero): "'), lt);
  assert.ok(!lt.includes("INCOMPLETA") && !lt.includes("[…]"));
  for (const t of [L.resumoItem(s98114, 1).join("\n"), L.detalheItem(s98114).join("\n"), V.triagemDecisao(s98114).join("\n")]) {
    assert.ok(t.includes("TESE DA EMENTA (literal") && t.includes("verificar_citacao_tcero"), t.slice(0, 300));
  }
  const antigo = { idDecisao: 5, sigla: "AC1-TC", numero: "1/20", ementa: "PRESTAÇÃO DE CONTAS. REGULARIDADE.\r\n1. Contas regulares.\r\n2. Tese de julgamento: não vale fora de seção." };
  assert.equal(L.teseDaEmenta(L.ementaLimpa(antigo)), null);
  const semRot = { idDecisao: 6, ementa: "I. Caso em exame\r\nResumo.\r\nII. Questão em discussão\r\nPergunta.\r\nIII. Entendimento: Procedente.\r\nIV. Fundamento: art. 1." };
  assert.equal(L.teseDaEmenta(L.ementaLimpa(semRot)), null);
  for (const t of [L.resumoItem(antigo, 1), L.detalheItem(antigo), V.triagemDecisao(antigo), L.resumoItem(semRot, 1)]) {
    const j = t.join("\n");
    assert.ok(!j.includes("TESE DA EMENTA") && !j.includes("INCOMPLETA"));
  }
});

test("tese da ementa: modelo CNJ, corte em item inteiro e aviso TESE INCOMPLETA; sem itens, 'trecho parcial'", () => {
  let itens = "";
  for (let k = 1; k <= 8; k++) itens += (k > 1 ? " " : "") + `${k}. Texto da tese número ${k}, ` + "palavra ".repeat(40) + "fim.";
  const cnj = { ementa: "I. Caso em exame\r\nA.\r\nII. Questão em discussão\r\nB.\r\nIII. Razões de decidir\r\nC.\r\nIV. Dispositivo e tese\r\nTese de julgamento: " + itens };
  const te2 = L.teseDaEmenta(L.ementaLimpa(cnj));
  assert.ok(te2 && !te2.completa && te2.total === 8 && te2.exibidos >= 1 && te2.exibidos < 8 && te2.texto.length <= L.TESE_MAX, JSON.stringify(te2));
  const lt2 = L.linhaTese(te2);
  assert.ok(lt2.includes(`TESE INCOMPLETA: ${te2.exibidos} de 8 itens`) && lt2.includes("abra o inteiro teor antes de fichar") && lt2.includes('[…]"'), lt2);
  const cnj2 = { ementa: "I. Caso em exame\r\nA.\r\nIV. Dispositivo e tese\r\nTese de julgamento: " + "Frase longa sem itens numerados. ".repeat(60) };
  const te3 = L.teseDaEmenta(L.ementaLimpa(cnj2));
  assert.ok(te3 && !te3.completa && te3.total === 1 && L.linhaTese(te3).includes("trecho parcial"), JSON.stringify(te3));
});

test("tese da ementa: nunca entra no recibo; recibo = o da 1.6.0 (campos, ordem, bytes)", async () => {
  api(async () => ({ result: [{ source: { ...s98114 } }] }));
  idx._limparCachesParaTeste();
  const saidaComp = await idx.obterAcordao(98114, null, null, false);
  assert.ok(saidaComp.includes("TESE DA EMENTA (literal"));
  await idx.obterAcordao(98114, null, null, false, "triagem");
  const rec = L.lerReciboTcero(98114);
  assert.deepEqual(Object.keys(rec), CAMPOS_V160);
  assert.ok(!JSON.stringify(rec).includes("TESE DA EMENTA"));
  assert.equal(rec.texto, [L.ementaLimpa(s98114).trim(), L.htmlParaTexto(s98114.acordaoDescricao || "").trim()].filter(Boolean).join("\n\n"));
  assert.equal(rec.sha256, L.sha256Texto(rec.texto));
  assert.equal(rec.sha256_campos, L.sha256CamposRecibo(rec));
  const sh = L.sha256CamposRecibo(rec);
  await idx.obterAcordao(98114, null, null, false);
  assert.equal(L.sha256CamposRecibo(L.lerReciboTcero(98114)), sh);
  // byte a byte contra um recibo gravado pelo commit da 1.6.0 (e8dc4a6), mesma entrada e mesma hora fixada
  // o caminho do recibo é fixado na carga do módulo: grava no mesmo local e restaura depois
  const cam = L.caminhoReciboTcero(98114);
  const antes = fs.readFileSync(cam);
  fs.rmSync(cam);
  L.gravarReciboTcero(s98114, { gravadoEm: "2026-10-15T00:00:00-0400" });
  const novo = fs.readFileSync(cam);
  const ouro = fs.readFileSync(path.join(AQUI, "fixtures", "recibo_v160_98114.json"));
  assert.ok(novo.equals(ouro), "o recibo da 1.7.0 difere byte a byte do gravado pela 1.6.0");
  fs.writeFileSync(cam, antes);
});

// ---------- item 2: VOZ DA CASA ----------
test("VOZ DA CASA: em `notas`, nunca em `alertas`; linha com ℹ; alerta de outra voz continua", () => {
  const p98 = fxPdf("98114.pdf");
  return idx.extrairTextoPdf(p98).then((r) => {
    const bruto = [L.ementaLimpa(s98114).trim(), r.texto].filter(Boolean).join("\n\n");
    const rCasa = L.verificarTrecho({ "texto (recibo)": bruto }, "caracteriza infração sujeita à aplicação de multa prevista na Lei Complementar Estadual");
    assert.ok(rCasa.valido && rCasa.notas.length && rCasa.notas[0].startsWith("VOZ DA CASA: o trecho está em ementa"), JSON.stringify(rCasa));
    assert.ok(rCasa.notas[0].includes("palavra do próprio TCE-RO") && !rCasa.alertas.some((a) => a.startsWith("VOZ DA CASA")));
    const rVoto = L.verificarTrecho({ "texto (recibo)": bruto }, "abstenham-se de prorrogar os contratos decorrentes do Pregão Eletrônico");
    assert.ok(rVoto.valido && rVoto.notas.length === 0, JSON.stringify(rVoto));
    const rPor = L.verificarTrecho({ ementa: "Contas regulares com ressalvas, nos termos do voto do relator, determinando o arquivamento.", "dispositivo (acordaoDescricao)": "" }, "Contas regulares com ressalvas, nos termos do voto do relator");
    assert.ok(rPor.notas.length && rPor.notas[0].startsWith("VOZ DA CASA: o trecho está em ementa"), JSON.stringify(rPor));
    assert.deepEqual(rPor.alertas, []);
    const rDisp = L.verificarTrecho({ ementa: "x", "dispositivo (acordaoDescricao)": "Julgar regulares com ressalva as contas do exercício de 2024 do Município." }, "Julgar regulares com ressalva as contas do exercício de 2024");
    assert.ok(rDisp.notas.length && rDisp.notas[0].includes("dispositivo (acordaoDescricao)"), JSON.stringify(rDisp));
    const lv = L.linhasVerificacaoItem({ idDecisao: 7, sigla: "AC1-TC", numero: "1/26" }, "Contas regulares com ressalvas, nos termos do voto do relator", { ementa: "Contas regulares com ressalvas, nos termos do voto do relator, determinando o arquivamento." });
    assert.ok(lv.some((l) => l.startsWith("   ℹ VOZ DA CASA:")) && !lv.some((l) => l.includes("atribuído a outra voz")), JSON.stringify(lv));
    const rTr = L.verificarTrecho({ ementa: "Conforme decidiu o STJ, a responsabilidade e solidaria entre os gestores nos casos de dano ao erario." }, "a responsabilidade e solidaria entre os gestores");
    assert.ok(rTr.alertas.some((a) => a.startsWith("TRANSCRIÇÃO")), JSON.stringify(rTr));
  });
});

// ---------- item 3: julgados_que_citam_tcero ----------
test("julgados_que_citam: número e regex", () => {
  assert.deepEqual(V7.numeroCitado("37/23"), ["00037/23", "37", "23"]);
  assert.deepEqual(V7.numeroCitado(" 00037/23 "), ["00037/23", "37", "23"]);
  assert.deepEqual(V7.numeroCitado("02603/22"), ["02603/22", "2603", "22"]);
  // pendências do red team 22/10/2026: mesma normalização das outras ferramentas — "37/2023" (ano com 4 dígitos) agora é 00037/23
  assert.deepEqual(V7.numeroCitado("37/2023"), ["00037/23", "37", "23"]);
  for (const ruim of ["", "37", "37/1823", "abc/23", "123456/23", "37-23", "02603/22/TCE"]) assert.equal(V7.numeroCitado(ruim), null, ruim);
  const rx = V7.regexNumeroCitado("37", "23");
  for (const bom of ["Acórdão APL-TC 00037/23, rel.", "APLTC 37/23.", "(00037/23)", "Proc. 00037/23/TCE-RO", "n. 0037 / 23"]) assert.ok(rx.test(bom), bom);
  for (const mau of ["100037/23", "00037/2023", "dia 15/37/23", "x/00037/23", "00037/230", "00037/23/24"]) assert.ok(!rx.test(mau), mau);
  assert.ok(V7.regexNumeroCitado("1136", "22").test("Processo n. 01136/22/TCE-RO") && !V7.regexNumeroCitado("15", "10").test("em 15/10/23"));
  const jan = V7.janelasDeCitacaoTcero("a ".repeat(300) + "Acórdão APL-TC 00037/23 diz. Também 00037/23 de novo. " + "b ".repeat(300), "37", "23");
  assert.ok(jan.length === 1 && jan[0][1].includes("Acórdão APL-TC 00037/23") && jan[0][1].length < 700, JSON.stringify(jan));
});

test("julgados_que_citam: portal que não honra a frase (base inteira) é contido pelo filtro local; avisos obrigatórios", async () => {
  const chamadas = [];
  api(async (params, operacao) => { chamadas.push([{ ...params }, operacao]); return dBig; });
  const saida = await idx.julgadosQueCitam("37/23", 10);
  assert.deepEqual(chamadas, [[{ textoLivre: '"00037/23"' }, "citacoes"]]);
  const rx = V7.regexNumeroCitado("37", "23");
  const reais = dBig.result.map((i) => i.source).filter((s) => [L.ementaLimpa(s), L.htmlParaTexto(s.acordaoDescricao || ""), L.htmlParaTexto(s.informacoesAdicionais || "")].some((t) => rx.test(t)) && !V7.ehOProprio(s, "00037/23"));
  assert.ok(reais.length >= 2 && reais.length < 100, String(reais.length));
  assert.ok(saida.includes(`${reais.length} achado(s): ${reais.length} pelo texto que o portal indexa, 0 pelos recibos locais`), saida.slice(0, 400));
  assert.ok(saida.length < 25000 && saida.includes("decisão(ões); ") && saida.includes("sem o número no texto (descartadas)"), String(saida.length));
  assert.ok(saida.includes("fonte: portal") && saida.includes("[ementa] >"), saida.slice(0, 800));
  assert.ok(saida.includes("id 97149") && saida.includes("Acórdão APL-TC 00037/23"), saida.slice(0, 1500));
  for (const a of ["NÃO detecta superação", "recall é baixo", "PDF do inteiro teor NÃO é varrido", "Leitura assistida"]) assert.ok(saida.includes(a), a);
});

test("julgados_que_citam: zero, próprio julgado, IA, recibos, portal fora do ar, formato inválido", async () => {
  api(async () => ({ result: [] }));
  const s0 = await idx.julgadosQueCitam("99999/99", 10);
  assert.ok(s0.includes("0 achado(s)") && s0.includes("ZERO AQUI NÃO PROVA que ninguém aplicou o julgado") && s0.includes("recall é baixo"), s0);
  const proprio = { result: [{ source: { idDecisao: 1, sigla: "APL-TC", numero: "00037/23", processo: "01111/20", ementa: "Ver 00037/23 aqui mesmo." } },
    { source: { idDecisao: 2, sigla: "AC1-TC", numero: "00500/24", processo: "00037/23", ementa: "Processo 00037/23 reexame." } }] };
  api(async () => proprio);
  assert.ok((await idx.julgadosQueCitam("00037/23", 10)).includes("0 achado(s)"));
  const ia = { result: [{ source: { idDecisao: 11111, sigla: "AC2-TC", numero: "00001/26", processo: "00002/25", relator: "MARIA SINTETICA", orgaoJulgador: "2ª Câmara",
    dataSessao: "2026-02-02T00:00:00", ementa: "Ementa sem número.", acordaoDescricao: "<p>Dispositivo.</p>", informacoesAdicionais: "<p>Aplicou o precedente do Acórdão APL-TC 00037/23 ao caso.</p>" } }] };
  api(async () => ia);
  L.gravarReciboTcero({ ...ia.result[0].source, ementa: "Ementa cita o Acórdão APL-TC 00037/23 e outro." }, { gravadoEm: "2026-10-15T00:00:00-0400" });
  L.gravarReciboTcero({ idDecisao: 22222, sigla: "AC1-TC", numero: "00003/26", processo: "00004/25", relator: "FULANO", orgaoJulgador: "1ª Câmara",
    dataSessao: "2026-03-03T00:00:00", ementa: "Contas. Aplica a Súmula; cf. Processo 37/23 (precedente).", acordaoDescricao: "<p>x</p>" }, { gravadoEm: "2026-10-15T00:00:00-0400" });
  const sIa = await idx.julgadosQueCitam("37/23", 10);
  assert.ok(sIa.includes("2 achado(s): 1 pelo texto que o portal indexa, 2 pelos recibos locais"), sIa.slice(0, 500));
  assert.ok(sIa.includes("informações adicionais (IA do DEJUR, não citável)"), sIa);
  assert.ok(sIa.includes("fonte: portal + recibo local") && sIa.includes("fonte: recibo local") && sIa.includes("recibo local (ementa+dispositivo)"), sIa);
  api(async () => { throw new Error("portal fora do ar"); });
  const sCai = await idx.julgadosQueCitam("37/23", 10);
  assert.ok(sCai.includes("[PESQUISA NÃO REALIZADA no portal] portal fora do ar") && sCai.includes("só os recibos locais foram vistos") && sCai.includes("fonte: recibo local"), sCai.slice(0, 600));
  api(semRede);
  assert.ok((await idx.julgadosQueCitam("37 de 2023", 10)).includes("Nenhuma requisição foi feita"));
});

// ---------- itens 4, 5 e 6: placar, consulta pouco seletiva, corte por resultado ----------
test("placar, consulta pouco seletiva (>= 1000) e Dica entre 200 e 999", async () => {
  api(async () => dBig);
  idx._limparCachesParaTeste();
  const sb = await idx.buscar("reincidência multa", null, null, null, null, 1, 10, false);
  assert.ok(dBig.result.length >= 1000);
  const ult = sb.split("\n").at(-1);
  assert.ok(ult.startsWith("Placar: ") && ult.includes("consulta(s) ao portal na janela de") && ult.includes("limitador: nível 1/5, livre"), ult);
  assert.ok(sb.includes("Consulta pouco seletiva: o portal devolveu 1.141 decisões") && sb.includes("Restrinja por relator ou órgão julgador, ou por ano"), sb.slice(0, 900));
  assert.ok(!sb.includes("Dica: total alto"));
  const med = { result: dBig.result.slice(0, 300) };
  api(async () => med);
  const sm = await idx.buscar("reincidência multa", null, null, null, null, 1, 5, false);
  assert.ok(!sm.includes("pouco seletiva") && sm.includes("Dica: total alto") && sm.split("\n").at(-1).startsWith("Placar: "));
  const pq = { result: dBig.result.slice(0, 50) };
  api(async () => pq);
  const sp = await idx.buscar("reincidência multa", null, null, null, null, 1, 5, false);
  assert.ok(!sp.includes("pouco seletiva") && !sp.includes("Dica: total alto") && sp.includes("Placar: "));
});

test("corte no limite de um resultado; placar vem depois do corte; sem corte nada muda", async () => {
  const gordos = { result: Array.from({ length: 50 }, (_, k) => ({ source: { ...s98114, idDecisao: 100 + k, ementa: "X".repeat(11000), acordaoDescricao: "<p>" + "Y".repeat(11000) + "</p>" } })) };
  api(async () => gordos);
  idx._limparCachesParaTeste();
  const sg = await idx.buscar(null, null, "02603/22", null, null, 1, 50, true);
  assert.ok(sg.includes("SAÍDA CORTADA no teto de 60.000 caracteres (resposta da busca)") && sg.includes("Cortei na fronteira do resultado:"), sg.slice(-700));
  assert.ok(sg.split("\n").at(-1).startsWith("Placar: ") && sg.length <= L.ORCAMENTO_SAIDA + 800, String(sg.length));
  const corpo = sg.split("\n[SAÍDA CORTADA")[0];
  const cabs = corpo.split("\n").filter((l) => l.startsWith("### "));
  assert.ok(cabs.length && corpo.split("**Ementa (integral").length - 1 === cabs.length, `${cabs.length}`);
  const l = ["cab", "\n**1. A**", "x", "\n**2. B**", "y"];
  assert.deepEqual(L.cortarBlocoPorResultado(l, 10000, "t"), l);
  // o recibo gravado nesta bateria continua com os campos da 1.6.0
  for (const n of fs.readdirSync(process.env.TCERO_MCP_DIR_RECIBOS)) assert.deepEqual(Object.keys(L.lerReciboTcero(n.replace(".json", ""))), CAMPOS_V160, n);
});

// ---------- v1.7.1 (correções do relatório de revisão) ----------
test("v1.7.1 item 1: avisos antes da lista, corte em resultado inteiro, 'e mais N' preservado, placar", async () => {
  const gordo = { result: Array.from({ length: 120 }, (_, k) => ({ source: { idDecisao: 700 + k, sigla: "AC1-TC", numero: `${String(k + 1).padStart(5, "0")}/25`, processo: `${String(k + 500).padStart(5, "0")}/24`,
    relator: "R", orgaoJulgador: "1ª Câmara", dataSessao: `2025-01-${String((k % 28) + 1).padStart(2, "0")}T00:00:00`, ementa: "palavra ".repeat(70) + " Acórdão APL-TC 00037/23 " + "x ".repeat(100) } })) };
  api(async () => gordo);
  const antes = L.ORCAMENTO_SAIDA;
  // o teto é const exportada; o corte é testado direto na função com teto pequeno e, ponta a ponta, pelo tamanho natural abaixo
  const sg = await idx.julgadosQueCitam("37/23", 50);
  assert.ok(sg.includes("Placar: ") && /… e mais \d+ achado\(s\) além do limite pedido \(50\)/.test(sg), sg.slice(-400));
  const ordem = ["NÃO detecta superação", "Leitura assistida", "PDF do inteiro teor NÃO é varrido", "recall é baixo"].map((a) => sg.indexOf(a));
  assert.ok(ordem.every((p) => p >= 0 && p < sg.indexOf("\n1. AC1-TC")), String(ordem));
  const linhas = ["cab", "aviso", "", "1. AC1-TC 1/25 · id 1 · x", "   [ementa] > a", "", "2. AC1-TC 2/25 · id 2 · x", "   [ementa] > b", "", "3. AC1-TC 3/25 · id 3 · x", "   [ementa] > c"];
  const cortado = L.cortarBlocoPorResultado(linhas, 120, "t", L.RE_CABECA_CITACAO);
  assert.ok(cortado.at(-1).includes("Cortei na fronteira do resultado") && cortado.filter((l) => /^[0-9]+\. /.test(l)).length >= 1, JSON.stringify(cortado));
  const corpo = cortado.slice(0, -1).filter((l) => l !== "");
  assert.ok(corpo.at(-1).startsWith("   [ementa] >"), JSON.stringify(corpo));
  assert.equal(L.ORCAMENTO_SAIDA, antes);
  api(async () => ({ result: [] }));
  const s0 = await idx.julgadosQueCitam("99999/99", 10);
  assert.ok(s0.indexOf("ZERO AQUI NÃO PROVA") < s0.indexOf("Leitura assistida") && s0.includes("Placar: "), s0);
});

test("v1.7.1 item 2: VOZ DA CASA cala quando há alerta de atribuição", () => {
  for (const [em, tr] of [
    ['O Ministério Público de Contas opinou que "as contas devem ser julgadas irregulares por dano" ao erário.', "as contas devem ser julgadas irregulares por dano"],
    ["A recorrente alega que a multa é desproporcional ao dano apurado nos autos.", "a multa é desproporcional ao dano apurado nos autos"],
    ["Conforme decidiu o STJ, a prescrição intercorrente não se aplica às contas especiais.", "a prescrição intercorrente não se aplica às contas especiais"],
  ]) {
    const r = L.verificarTrecho({ ementa: em }, tr);
    assert.ok(r.valido && r.alertas.length && r.notas.length === 0, em + JSON.stringify(r));
  }
});

test("v1.7.1 item 3 e 5: só dígitos ASCII; mesma numeração com sigla diferente não é o próprio", () => {
  assert.equal(V7.numeroCitado("٣٧/٢٣"), null);
  assert.equal(V7.numeroCitado("３７/２３"), null);
  assert.deepEqual(V7.numeroCitado("37/23"), ["00037/23", "37", "23"]);
  const o = { numero: "00037/23", processo: "01111/20", sigla: "AC1-TC" };
  assert.ok(V7.ehOProprio(o, "00037/23") && V7.ehOProprio(o, "00037/23", "AC1-TC") && !V7.ehOProprio(o, "00037/23", "APL-TC"));
  assert.ok(V7.ehOProprio({ numero: "00500/24", processo: "00037/23", sigla: "AC1-TC" }, "00037/23", "APL-TC"));
  const [ach, pr] = V7.citacoesNoPortal([{ source: { ...o, idDecisao: 1, ementa: "cf. 00037/23" } }], "00037/23", "37", "23", "APL-TC");
  assert.equal(ach.length, 1);
  assert.equal(pr, 0);
});
