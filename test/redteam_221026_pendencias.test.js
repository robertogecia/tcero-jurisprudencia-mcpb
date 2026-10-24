// Red team 22/10/2026 — pendências de gravidade média e baixa do TCE-RO (as duas altas saíram na 1.7.5):
//  1. voto do PRÓPRIO relator rotulado "de outro conselheiro" (77649: autuação em duas colunas, a captura lia "SESSÃO" como relator);
//  2. caminho pelo portal sem POSIÇÃO: a pergunta da "Questão em discussão" saía ✅ com VOZ DA CASA;
//  3. recibo sem PDF dava "❌ NÃO ENCONTRADO — parafraseie ou corrija" a trecho que está no voto;
//  4. numero_acordao não normalizado ("55/2026" → "055/2026"; sigla e ano de 4 dígitos iam crus e o vazio virava "não cite");
//  5. julgados_que_citam descartava calado acórdão de outra sigla com o mesmo número e decisão do processo com esse número;
//  6. resetDisjuntorParaTeste apagava o estado na pasta real quando rodado sem isolamento.
// 100% offline: PDFs públicos já usados nos outros testes + textos sintéticos (nomes inventados); estado e recibos em pasta temporária.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-rt-pend-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const V = await import("../server/v160.js");
const V7 = await import("../server/v170.js");
const P = await import("../server/posicao2.js");
const idx = await import("../server/index.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const semRede = async () => { throw new Error("o teste não pode tocar a rede"); };
const api = (fn) => idx._setDepsParaTeste({ consultarApi: fn, baixarPdf: semRede });
api(semRede);
const fixture03 = JSON.parse(fs.readFileSync(path.join(AQUI, "fixtures", "03_busca_idDecisao.json"), "utf8"));
const item98114 = fixture03.result.find((i) => i.source.idDecisao === 98114);
const textoPdf = async (id) => (await idx.extrairTextoPdf(fs.readFileSync(path.join(AQUI, "fixtures", "pdf", `${id}.pdf`)))).texto;
const limparRecibos = () => fs.rmSync(process.env.TCERO_MCP_DIR_RECIBOS, { recursive: true, force: true });

// ---------------------------------------------------------------- 1. relator lido errado → voto do relator "de outro conselheiro"
test("77649: relator vem da autuação em duas colunas; o voto dele é o condutor (verificar e triagem)", async () => {
  const bruto = await textoPdf("77649");
  assert.deepEqual(P.relatorTc(bruto), ["omar", "pires", "dias"]);
  limparRecibos();
  L.gravarReciboTcero({ idDecisao: 77649, sigla: "APL-TC", numero: "00001/26", ementa: "", acordaoDescricao: "" },
    { textoPdf: bruto, textoPdfCompleto: true, gravadoEm: "2026-10-22T00:00:00-0400" });
  const out = await idx.verificarCitacao("77649", null, "a imputação deva ser afastada diante da ausência de amparo legal do detalhamento exigido por esta Corte");
  assert.ok(out.includes("✅ VÁLIDO"), out);
  assert.ok(out.includes("POSIÇÃO NO JULGADO: fundamentação do voto condutor"), out);
  assert.ok(!out.includes("VOTO de outro conselheiro"), out);
  const tri = V.linhasTriagemPdf(bruto, { paginas: 0, sem_texto: false, parcial: false }).join("\n");
  assert.ok(!tri.includes("«VOTO DO CONSELHEIRO-SUBSTITUTO OMAR PIRES DIAS»"), tri.slice(0, 1500));
  assert.ok(tri.includes("VOTO do relator"), tri.slice(0, 600));
  // os vogais (outros nomes) continuam "de outro conselheiro"
  assert.ok(tri.includes("«CONSELHEIRO EDILSON DE SOUSA SILVA»"), tri.slice(0, 1500));
});

test("os outros PDFs da fixture não mudam de relator (85572, 96141, 98114)", async () => {
  assert.deepEqual(P.relatorTc(await textoPdf("85572")), ["jose", "euler", "potyguara", "pereira", "mello"]);
  assert.deepEqual(P.relatorTc(await textoPdf("96141")), ["omar", "pires", "dias"]);
  assert.deepEqual(P.relatorTc(await textoPdf("98114")), ["jose", "euler", "potyguara", "pereira", "mello"]);
});

function acordaoSintetico({ cabecalho, fecho }) {
  const voto = Array.from({ length: 6 }, (_, i) => `${i + 1}. O gestor apresentou justificativas parciais quanto ao item ${i + 1}, que se examinam a seguir com o cuidado devido.`).join("\n");
  return [
    "PROCESSO: 01234/25", "ASSUNTO: Fiscalização de atos", "JURISDICIONADO: Município de Exemplópolis", ...cabecalho,
    "EMENTA: CONTROLE EXTERNO. DETERMINAÇÃO. CUMPRIMENTO PARCIAL.",
    "ACÓRDÃO", fecho,
    "PROCESSO: 01234/25", "ASSUNTO: Fiscalização de atos", "JURISDICIONADO: Município de Exemplópolis",
    "RELATÓRIO", "1. Trata-se de monitoramento do cumprimento de determinações expedidas por esta Corte de Contas ao gestor municipal.",
    "VOTO DO CONSELHEIRO ALFREDO BERNARDES COSTA", voto,
    "Ante o exposto, voto no sentido de considerar parcialmente cumprida a determinação, sem aplicação de multa ao gestor.",
    "É como voto.",
  ].join("\n");
}

test("sintético: relator só no fecho (cabeçalho em duas colunas, sem a linha Conselheiro) → voto condutor", () => {
  const t = acordaoSintetico({
    cabecalho: ["RELATOR", "SESSÃO", ":", ":", "3ª Sessão Ordinária"],
    fecho: "ACORDAM os Senhores Conselheiros do Pleno, em consonância com o Voto do Relator, Conselheiro Alfredo Bernardes Costa, por unanimidade, em considerar parcialmente cumprida a determinação.",
  });
  assert.deepEqual(P.relatorTc(t), ["alfredo", "bernardes", "costa"]);
  const meio = t.indexOf("justificativas parciais quanto ao item 3");
  assert.ok(P.posicaoTcero(t, meio).startsWith("fundamentação do voto condutor"), P.posicaoTcero(t, meio));
});

test("sintético: relator ilegível em toda parte → voto de autoria NÃO confirmada (nunca 'de outro conselheiro'); maioria → confira", () => {
  const t = acordaoSintetico({
    cabecalho: ["RELATOR", "SESSÃO", ":", ":", "3ª Sessão Ordinária"],
    fecho: "ACORDAM os Senhores Conselheiros do Pleno, por maioria, vencido o Conselheiro Zeferino Quaresma Lobo, em considerar parcialmente cumprida a determinação.",
  });
  assert.deepEqual(P.relatorTc(t), []);
  const meio = t.indexOf("justificativas parciais quanto ao item 3");
  const pos = P.posicaoTcero(t, meio);
  assert.ok(pos.startsWith("voto de conselheiro (título: «VOTO DO CONSELHEIRO ALFREDO BERNARDES COSTA») — autoria não confirmada"), pos);
  assert.ok(!pos.includes("não é o voto condutor"), pos);
  const r = L.verificarTrecho({ texto: t }, "apresentou justificativas parciais quanto ao item 3, que se examinam a seguir");
  assert.ok(r.valido && r.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") && a.includes("não leu o relator")), JSON.stringify(r));
  assert.ok(!r.notas.some((n) => n.startsWith("VOZ DA CASA")), JSON.stringify(r.notas));
  assert.equal(L.parteDoJulgadoTc(pos), "voto de conselheiro «VOTO DO CONSELHEIRO ALFREDO BERNARDES COSTA»");
});

// ---------------------------------------------------------------- 2. portal: POSIÇÃO dentro da ementa; VOZ DA CASA fora de pergunta/narração
test("portal (sem recibo): a pergunta da Questão em discussão sai com POSIÇÃO e sem VOZ DA CASA; a tese mantém VOZ DA CASA", async () => {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(AQUI, "fixtures", "exp_C2_controle_or.json.gz"))));
  const it = d.result.find((i) => i.source.idDecisao === 98114);
  limparRecibos();
  api(async () => ({ result: [it] }));
  const out = await idx.verificarCitacao("98114", null, "a reincidência no descumprimento de determinações da Corte autoriza a aplicação de multa agravada");
  assert.ok(out.includes("Fonte do texto conferido: PORTAL") && out.includes("✅ VÁLIDO"), out);
  assert.ok(out.includes("POSIÇÃO NO JULGADO: ementa (campo do portal) › II. QUESTÃO EM DISCUSSÃO — a pergunta posta, não a resposta"), out);
  assert.ok(!out.includes("VOZ DA CASA"), out);
  // controle: trecho do Entendimento/tese continua com VOZ DA CASA
  const em = L.ementaLimpa(it.source);
  const iEnt = L.fold(em).indexOf("entendimento");
  assert.ok(iEnt > 0, em.slice(0, 300));
  const frase = em.slice(iEnt).split(/(?<=\.)\s+/).find((f) => f.length > 80) || "";
  const tr = frase.replace(/^[^:]*:\s*/, "").slice(0, 110).replace(/\s\S*$/, "");
  const r = L.verificarTrecho({ ementa: em }, tr);
  assert.ok(r.valido && /III\. ENTENDIMENTO/.test(r.posicao) && (r.alertas.length || r.notas.some((n) => n.startsWith("VOZ DA CASA"))), tr + JSON.stringify(r));
  api(semRede);
});

test("VOZ DA CASA: cala no Caso em exame, na Questão em discussão e na parte final; fala no Entendimento, no Fundamento e no dispositivo", () => {
  const voz = (pos, nome = "texto") => L.alertaVozDaCasa(nome, pos);
  assert.equal(voz("ementa do cadastro › II. QUESTÃO EM DISCUSSÃO — a pergunta posta, não a resposta"), null);
  assert.equal(voz("ementa (campo do portal) › I. CASO EM EXAME — resumo do caso, não tese", "ementa"), null);
  assert.equal(voz("ementa › parte final (dispositivos e jurisprudência citados, resumo) — referência, não tese", "ementa"), null);
  assert.ok(voz("ementa do cadastro › III. ENTENDIMENTO — a tese que o Tribunal de Contas firmou (candidato a ratio; confira no voto)"));
  assert.ok(voz("ementa (campo do portal) › IV. FUNDAMENTO — fundamentos resumidos na ementa", "ementa"));
  assert.ok(voz("", "dispositivo (acordaoDescricao)"));
  assert.ok(voz("", "ementa"));   // ementa sem seções: como antes
});

// ---------------------------------------------------------------- 3. recibo sem PDF (ou com PDF parcial)
test("recibo sem PDF: trecho fora da ementa/dispositivo sai ⚠️ NÃO VERIFICÁVEL NO INTEIRO TEOR, nunca ❌; com PDF inteiro, ❌ como antes", async () => {
  limparRecibos();
  let chamadas = 0;
  api(async () => { chamadas++; return { result: [item98114] }; });
  await idx.obterAcordao("98114", null, null, false);
  assert.equal(L.lerReciboTcero("98114").texto_pdf_completo, null);
  const voto = "aplicou-se multa somente aos responsáveis pelo ente municipal fictício de Vila Sintética";
  const s1 = await idx.verificarCitacao("98114", null, voto);
  assert.equal(chamadas, 1);
  assert.ok(s1.includes("⚠️ NÃO VERIFICÁVEL NO INTEIRO TEOR") && s1.includes("o PDF do inteiro teor NÃO foi lido"), s1);
  assert.ok(s1.includes("obter_acordao_tcero(id_decisao=98114, ler_inteiro_teor=true)") && !s1.includes("❌ NÃO ENCONTRADO") && !s1.includes("parafraseie ou corrija"), s1);
  // PDF lido em parte
  L.gravarReciboTcero(item98114.source, { textoPdf: "Primeira página do voto, sem o trecho procurado.", textoPdfCompleto: false, gravadoEm: "2026-10-22T00:00:00-0400" });
  const s2 = await idx.verificarCitacao("98114", null, voto);
  assert.ok(s2.includes("⚠️ NÃO VERIFICÁVEL NO INTEIRO TEOR") && s2.includes("lido só EM PARTE"), s2);
  // PDF inteiro, trecho ausente: ❌ (a ausência agora prova algo)
  L.gravarReciboTcero(item98114.source, { textoPdf: "Voto completo sintético, sem o trecho procurado em parte alguma.", textoPdfCompleto: true, gravadoEm: "2026-10-22T00:00:00-0400" });
  const s3 = await idx.verificarCitacao("98114", null, voto);
  assert.ok(s3.includes("❌ NÃO ENCONTRADO") && !s3.includes("NÃO VERIFICÁVEL NO INTEIRO TEOR"), s3);
  // PDF inteiro COM o trecho: ✅
  L.gravarReciboTcero(item98114.source, { textoPdf: `Voto. Por isso, ${voto}, nos termos do item II.`, textoPdfCompleto: true, gravadoEm: "2026-10-22T00:00:00-0400" });
  assert.ok((await idx.verificarCitacao("98114", null, voto)).includes("✅ VÁLIDO"));
  // trecho curto demais continua a recusa própria, mesmo sem PDF
  limparRecibos();
  await idx.obterAcordao("98114", null, null, false);
  assert.ok((await idx.verificarCitacao("98114", null, "multa")).includes("curto demais"));
  api(semRede);
});

// ---------------------------------------------------------------- 4. normalização do número
test("normalizarNumeroTc: sigla, prefixo, ano de 4 dígitos, espaços e zeros; o resto é recusado", () => {
  const f = (v) => L.normalizarNumeroTc(v);
  for (const [v, forma] of [["55/26", "00055/26"], ["55/2026", "00055/26"], ["00055/2026", "00055/26"], ["0000055/26", "00055/26"],
    ["55 / 26", "00055/26"], ["APL-TC 00055/26", "00055/26"], ["Acórdão APL-TC 55/26", "00055/26"], ["AC1-TC n. 120/25", "00120/25"],
    ["APLR-TC 7/24", "00007/24"], ["Processo n. 2603/22", "02603/22"], ["1010/2017", "01010/17"]]) {
    assert.equal(f(v).forma, forma, v);
    assert.equal(L.padronizarNumero(v), forma, v);
  }
  assert.equal(f("APL-TC 00055/26").sigla, "APL-TC");
  assert.equal(f("Acórdão AC2-TC 55/26").tipo, "acordao");
  assert.equal(f("Processo 2603/22").tipo, "processo");
  assert.equal(f("55/26").sigla, null);
  for (const ruim of ["", "55", "123456/26", "55/2", "55/1826", "abc/26", "55-26", "٥٥/٢٦", "55/26/TCE"]) assert.equal(f(ruim).valido, false, ruim);
  assert.deepEqual(V7.numeroCitado("APL-TC 00037/23"), ["00037/23", "37", "23"]);
  assert.deepEqual(V7.numeroCitado("37 / 2023"), ["00037/23", "37", "23"]);
});

test("verificar/obter/buscar: número normalizado vai ao portal; formato ruim é recusado SEM requisição; vazio mostra a forma consultada", async () => {
  limparRecibos();
  const enviados = [];
  api(async (p) => { enviados.push({ ...p }); return p.numeroAcordao === "00055/26" ? fixture03 : { result: [] }; });
  for (const v of ["55/2026", "00055/2026", "APL-TC 00055/26", "Acórdão APL-TC 55/26", "0000055/26", "55 / 26"]) {
    const out = await idx.verificarCitacao(null, v, "descumprimento injustificado");
    assert.ok(out.includes("Fonte do texto conferido: PORTAL") && !out.includes("Nenhuma decisão"), v + " → " + out.slice(0, 300));
  }
  assert.ok(enviados.every((p) => p.numeroAcordao === "00055/26"), JSON.stringify(enviados));
  enviados.length = 0;
  for (const ruim of ["55", "abc", "123456/26", "55/2"]) {
    const out = await idx.verificarCitacao(null, ruim, "descumprimento injustificado");
    assert.ok(out.includes("formato não reconhecido") && out.includes("Nenhuma requisição foi feita") && !out.includes("não cite"), out);
    assert.ok((await idx.obterAcordao(null, ruim, null, false)).includes("formato não reconhecido"));
    assert.ok((await idx.buscar(null, ruim, null, null, null, 1, 10, false, null)).includes("formato não reconhecido"));
  }
  assert.equal(enviados.length, 0);
  const vazio = await idx.verificarCitacao(null, "77/2025", "descumprimento injustificado");
  assert.ok(vazio.includes("Nenhuma decisão sob '77/2025' (consultado no portal como '00077/25')"), vazio);
  const vazioObter = await idx.obterAcordao(null, "APL-TC 77/25", null, false);
  assert.ok(vazioObter.includes("(consultado no portal como '00077/25')"), vazioObter);
  assert.ok(!(await idx.verificarCitacao(null, "00077/25", "descumprimento injustificado")).includes("consultado no portal como"));
  api(semRede);
});

test("verificar com sigla: confere só as decisões dessa sigla; sigla sem decisão confere todas com aviso", async () => {
  limparRecibos();
  const base = item98114.source;
  const dois = { result: [{ source: base }, { source: { ...base, idDecisao: 1, sigla: "AC1-TC", ementa: "Outra decisão sem o trecho." } }] };
  api(async () => dois);
  const s1 = await idx.verificarCitacao(null, "APL-TC 55/26", "descumprimento injustificado");
  assert.ok(s1.includes("Sigla informada APL-TC: conferidas só as 1 decisão(ões) com essa sigla, de 2 sob 00055/26") && !s1.includes("id 1 ·"), s1);
  const s2 = await idx.verificarCitacao(null, "AC2-TC 55/26", "descumprimento injustificado");
  assert.ok(s2.includes("⚠️ Nenhuma das 2 decisão(ões) sob 00055/26 tem a sigla AC2-TC") && s2.includes("id 1 ·"), s2);
  api(semRede);
});

// ---------------------------------------------------------------- 5. julgados_que_citam: outra sigla / processo com o mesmo número
const PORTAL_CITAM = {
  result: [
    { source: { idDecisao: 10, sigla: "APL-TC", numero: "00120/25", processo: "00999/24", ementa: "Ementa do próprio precedente, sem citar número." } },
    { source: { idDecisao: 11, sigla: "AC1-TC", numero: "00120/25", processo: "01001/24", dataSessao: "2026-01-02T00:00:00", ementa: "Nos termos do Acórdão APL-TC 00120/25, aplica-se a multa ao gestor omisso." } },
    { source: { idDecisao: 12, sigla: "AC2-TC", numero: "00777/25", processo: "00120/25", dataSessao: "2026-01-03T00:00:00", ementa: "Aplicado o Acórdão APL-TC 00120/25 do Pleno ao caso concreto." } },
    { source: { idDecisao: 13, sigla: "AC1-TC", numero: "00900/25", processo: "01002/24", dataSessao: "2026-01-04T00:00:00", ementa: "Conforme o Acórdão APL-TC 00120/25, julga-se irregular." } },
    { source: { idDecisao: 14, sigla: "AC2-TC", numero: "00500/25", processo: "00120/25", dataSessao: "2026-01-05T00:00:00", ementa: "Processo 00120/25. Embargos rejeitados." } },
  ],
};

test("julgados_que_citam com sigla: outra sigla com o mesmo número e decisão do processo homônimo entram como citação", async () => {
  limparRecibos();
  api(async () => PORTAL_CITAM);
  const s = await idx.julgadosQueCitam("APL-TC 00120/25", 10);
  assert.ok(s.includes("3 achado(s): 3 pelo texto que o portal indexa"), s.slice(0, 600));
  for (const id of ["id 11", "id 12", "id 13"]) assert.ok(s.includes(id), id + "\n" + s);
  assert.ok(!s.includes("id 10 ") && !s.includes("id 14 "), s);   // o próprio (sem número no texto) e a autorreferência "Processo 00120/25"
  assert.ok(!s.includes("MESMO NÚMERO"), s);
  api(semRede);
});

test("julgados_que_citam sem sigla: nada some calado — as colisões vão para um bloco à parte, fora da contagem", async () => {
  limparRecibos();
  api(async () => PORTAL_CITAM);
  const s = await idx.julgadosQueCitam("00120/25", 10);
  assert.ok(s.includes("1 achado(s): 1 pelo texto que o portal indexa"), s.slice(0, 600));   // só o id 13, sem colisão de número
  assert.ok(s.includes("⚠️ 2 decisão(ões) com o MESMO NÚMERO 00120/25") && s.includes('"APL-TC 00037/23"'), s);
  const bloco = s.slice(s.indexOf("**Mesmo número 00120/25"));
  assert.ok(bloco.includes("AC1-TC 00120/25 · id 11") && bloco.includes("AC2-TC 00777/25 · id 12"), bloco);
  assert.ok(!bloco.includes("id 14"), bloco);   // só autorreferência ("Processo 00120/25" no processo 00120/25): conta como próprio
  // tipo="processo": o processo 00120/25 é o próprio; o acórdão AC1-TC 00120/25 colide
  const sp = await idx.julgadosQueCitam("00120/25", 10, "processo");
  assert.ok(sp.includes("1 achado(s)") && sp.includes("AC1-TC 00120/25 · id 11") && !sp.includes("id 12 ·") && !sp.includes("AC2-TC 00777/25"), sp);
  assert.ok((await idx.julgadosQueCitam("APL-TC 00120/25", 10, "processo")).includes("Nenhuma requisição foi feita"));
  assert.ok((await idx.julgadosQueCitam("00120/25", 10, "qualquer")).includes("tipo inválido"));
  api(semRede);
});

test("julgados_que_citam nos recibos: o cabeçalho do próprio número (outra sigla) não vira citação", async () => {
  limparRecibos();
  // AC1-TC 00120/25 lido com PDF: o cabeçalho de página traz o próprio número; só o trecho "APL-TC 00120/25" é citação
  L.gravarReciboTcero({ idDecisao: 21, sigla: "AC1-TC", numero: "00120/25", processo: "01001/24", ementa: "Ementa sem número.", acordaoDescricao: "" },
    { textoPdf: "Acórdão AC1-TC 00120/25 referente ao processo 01001/24\n" + "x ".repeat(300) + "\nAplica-se o Acórdão APL-TC 00120/25 do Pleno.", textoPdfCompleto: true, gravadoEm: "2026-10-22T00:00:00-0400" });
  L.gravarReciboTcero({ idDecisao: 22, sigla: "AC2-TC", numero: "00120/25", processo: "01003/24", ementa: "Ementa sem número.", acordaoDescricao: "" },
    { textoPdf: "Acórdão AC2-TC 00120/25 referente ao processo 01003/24\nTexto sem citar nada.", textoPdfCompleto: true, gravadoEm: "2026-10-22T00:00:00-0400" });
  api(async () => ({ result: [] }));
  const s = await idx.julgadosQueCitam("APL-TC 00120/25", 10);
  assert.ok(s.includes("1 achado(s): 0 pelo texto que o portal indexa, 1 pelos recibos locais") && s.includes("id 21") && !s.includes("id 22"), s);
  assert.ok(s.includes("Aplica-se o Acórdão APL-TC 00120/25") && !s.includes("Acórdão AC1-TC 00120/25 referente"), s);
  api(semRede);
});

// ---------------------------------------------------------------- 6. reset do disjuntor só em pasta isolada
test("resetDisjuntorParaTeste recusa sem TCERO_MCP_DIR_ESTADO (nunca apaga a pasta real)", () => {
  const antes = process.env.TCERO_MCP_DIR_ESTADO;
  try {
    delete process.env.TCERO_MCP_DIR_ESTADO;
    assert.throws(() => L.resetDisjuntorParaTeste(), /não é pasta de estado isolada/);
  } finally {
    process.env.TCERO_MCP_DIR_ESTADO = antes;
  }
  L.resetDisjuntorParaTeste();   // com a pasta temporária, funciona
});
