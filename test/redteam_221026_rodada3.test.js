// Red team 22/10/2026, RODADA 3 — a rechecagem independente da rodada 2 achou ALARMES FALSOS novos e três falhas remanescentes:
//  - REGRESSÃO 1: maioriaDoFecho lia todo "ACORDAM … por maioria, vencido o Conselheiro X" do texto, inclusive o fecho de acórdão ANTERIOR
//    transcrito no voto (formato real: 77649, l. 796) — julgamento unânime ganhava "JULGAMENTO POR MAIORIA" e o vogal X, que só convergiu,
//    ganhava "VOTO VENCIDO";
//  - REGRESSÃO 2: nos itens, "por maioria … vencid" a 250 caracteres disparava em item de acórdão unânime de RPPS ("por maioria absoluta do
//    Conselho Deliberativo … parcelas vencidas");
//  - (A) a 1ª linha do RELATÓRIO depois da autuação repetida saía como autuação (parte desconhecida) e relatório [...] voto passava ✅;
//    "autuação [...] ementa" também;
//  - (B) "vencido o Relator": o voto vencedor saía "não é o voto condutor" sem alerta nenhum;
//  - (C) "vencido o Conselheiro Silva" casava com qualquer Silva (98114 tem dois Franciscos ... da Silva).
// E sem reabrir o defeito original: fecho por maioria do PRÓPRIO acórdão continua dando VOTO VENCIDO / "confira".
// 100% offline e sintético (nomes inventados) + o PDF público 96141 das fixtures; estado em os.tmpdir().
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-rt221026-r3-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const P = await import("../server/posicao2.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NOME = "texto (recibo: ementa + dispositivo + PDF quando lido)";
const FECHO_MAIORIA =
  "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
  "Relator, Conselheiro Alfredo Bernardes Costa, por maioria, vencido o Conselheiro Substituto Gervásio Hilário Lacerda " +
  "(substituição em vacância), quanto ao valor da multa; e por unanimidade quanto aos demais itens, em:";
const FECHO_UNANIME =
  "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
  "Relator, Conselheiro Alfredo Bernardes Costa, por unanimidade, em:";
const ITENS = Array.from({ length: 14 }, (_, i) =>
  `${i + 2} - Determinar ao gestor que adote as providências de número ${i + 2}, informando a esta Corte no prazo regimental.`);
const VENCIDO_TXT =
  "Peço vênia ao relator para divergir quanto ao montante, pois a multa reduzida a um décimo do valor de alçada atende melhor a " +
  "finalidade pedagógica da sanção aplicada ao gestor.";
const TRECHO_VENCIDO = "a multa reduzida a um décimo do valor de alçada atende melhor a finalidade pedagógica da sanção";
const TRECHO_RELATOR = "A multa deve ser fixada em patamar suficiente para reprimir a conduta reiterada do gestor municipal";
const VOGAL_CONVERGE = ["CONSELHEIRO MARCELO NUNES PEREIRA",
  "Convirjo com o relator, pois as determinações foram reiteradas e o gestor não apresentou qualquer justificativa para o " +
  "descumprimento, o que autoriza a multa no patamar proposto pelo eminente relator."];
const TRECHO_VOGAL = "as determinações foram reiteradas e o gestor não apresentou qualquer justificativa";
// o voto de acompanhamento transcreve o acórdão ANTERIOR, julgado por maioria com o mesmo Pleno (formato do 77649, l. 796)
const TRANSCRICAO = [
  "2. Transcrevo o Acórdão APL-TC 00035/24, que deu origem às determinações:",
  "ACÓRDÃO",
  "Vistos, relatados e discutidos estes autos, que tratam de análise de edital, como tudo dos autos consta.",
  "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, por maioria, vencido o Conselheiro Marcelo Nunes Pereira, em:",
  "I - Determinar ao gestor que se abstenha de prorrogar os contratos derivados do certame anulado;",
];

/** Acórdão SINTÉTICO no formato do TCE-RO (mesmo molde dos testes das rodadas 1 e 2). */
function acordao({ fecho = FECHO_MAIORIA, itensExtra = [], tituloVencido = ["VOTO", "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"],
  vencidoTxt = VENCIDO_TXT, vogal = null, fundamentacaoExtra = [], ementaExtra = [], autuacaoRepetida = false, comTituloAcordao = true } = {}) {
  const autuacao = ["PROCESSO: 01234/25", "ASSUNTO: Fiscalização de atos e contratos", "JURISDICIONADO: Município de Exemplópolis",
    "RELATOR: Conselheiro Alfredo Bernardes Costa", "SESSÃO: 3ª Sessão Ordinária do Pleno, realizada de forma virtual, de 9 a 13 de",
    "fevereiro de 2026."];
  return [
    ...autuacao,
    "EMENTA: FISCALIZAÇÃO DE ATOS. DESCUMPRIMENTO DE DETERMINAÇÃO. MULTA.",
    "1. O descumprimento reiterado de determinação desta Corte sujeita o gestor à multa do art. 55 da lei orgânica.",
    ...ementaExtra,
    "2. A dosimetria considera a reincidência e o valor de alçada, observado o art. 22 da LINDB.",
    ...(comTituloAcordao ? ["ACÓRDÃO"] : []),
    "Vistos, relatados e discutidos estes autos, que tratam de fiscalização de atos, como tudo dos autos consta.",
    fecho,
    "I - Multar o gestor em R$ 24.000,00 pelo descumprimento de determinação.",
    ...itensExtra,
    ...ITENS,
    ...(autuacaoRepetida ? autuacao : []),
    "RELATÓRIO",
    "1. Trata-se de fiscalização instaurada para verificar o cumprimento de determinação anterior desta Corte de Contas.",
    "VOTO",
    "CONSELHEIRO ALFREDO BERNARDES COSTA",
    TRECHO_RELATOR + " omisso.",
    ...fundamentacaoExtra,
    "3. O valor de alçada orienta a dosimetria, observadas as circunstâncias do art. 22 da LINDB e a reincidência.",
    "É como voto.",
    ...(vogal || []),
    ...tituloVencido,
    ...(vencidoTxt ? [vencidoTxt] : []),
    "Em 1º de outubro de 2026",
  ].join("\n");
}
const ver = (bruto, trecho) => L.verificarTrecho({ [NOME]: bruto }, trecho);
const temVencido = (r) => r.alertas.some((a) => a.startsWith("VOTO VENCIDO:"));
const temMaioria = (r) => r.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA"));
const semAlertaDeMaioria = (r) => !r.alertas.some((a) => /^(VOTO VENCIDO|JULGAMENTO POR MAIORIA|RELATOR VENCIDO)/.test(a));

// ------------------------------------------------------------------ regressão 1: fecho transcrito
test("rodada 3: fecho de acórdão ANTERIOR transcrito no voto não vira julgamento por maioria deste acórdão (unânime)", () => {
  const bruto = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "", fundamentacaoExtra: TRANSCRICAO, vogal: VOGAL_CONVERGE });
  assert.equal(L.maioriaDoFecho(bruto).maioria, false, JSON.stringify(L.maioriaDoFecho(bruto)));
  const rRel = ver(bruto, TRECHO_RELATOR);
  assert.ok(rRel.valido && rRel.posicao.startsWith("fundamentação do voto condutor"), rRel.posicao);
  assert.ok(semAlertaDeMaioria(rRel), JSON.stringify(rRel.alertas));
  // o vogal Marcelo, vencido no acórdão ANTERIOR, só convergiu neste: nada de "VOTO VENCIDO … não cite como entendimento da Corte"
  const rVog = ver(bruto, TRECHO_VOGAL);
  assert.ok(rVog.valido && rVog.posicao.startsWith("VOTO de outro conselheiro (título: «CONSELHEIRO MARCELO NUNES PEREIRA"), rVog.posicao);
  assert.ok(semAlertaDeMaioria(rVog), JSON.stringify(rVog.alertas));
  // o fecho lido é o do próprio acórdão (o 1º ACORDAM depois do título ACÓRDÃO e antes do RELATÓRIO)
  const proprios = L.fechosPropriosTc(bruto);
  assert.equal(proprios.length, 1);
  assert.ok(bruto.slice(proprios[0].index, proprios[0].index + 200).includes("por unanimidade"));
});

test("rodada 3: sem reabrir o defeito original — fecho PRÓPRIO por maioria continua alertando, mesmo com fecho unânime transcrito no voto", () => {
  const transcricaoUnanime = TRANSCRICAO.map((l) => l.replace("por maioria, vencido o Conselheiro Marcelo Nunes Pereira", "por unanimidade"));
  const bruto = acordao({ fundamentacaoExtra: transcricaoUnanime, vogal: VOGAL_CONVERGE });
  const f = L.maioriaDoFecho(bruto);
  assert.ok(f.maioria, JSON.stringify(f));
  assert.deepEqual(f.vencidos, [["gervasio", "hilario", "lacerda"]]);
  assert.ok(temVencido(ver(bruto, TRECHO_VENCIDO)));
  assert.ok(semAlertaDeMaioria(ver(bruto, TRECHO_VOGAL)), "o vogal que convergiu não é o vencido");
  // a ementa que cita precedente julgado por maioria também não conta como fecho deste acórdão
  const ementaCita = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "",
    ementaExtra: ["Precedente: ACORDAM os Conselheiros, por maioria, vencido o Conselheiro Fulano Beltrano, em: aplicar multa."] });
  assert.equal(L.maioriaDoFecho(ementaCita).maioria, false);
  assert.ok(semAlertaDeMaioria(ver(ementaCita, TRECHO_RELATOR)));
  // sem o título ACÓRDÃO (formato fora do padrão): lê os fechos de fora do relatório/voto, como antes — o maioria do fecho próprio continua valendo
  const semTitulo = acordao({ comTituloAcordao: false, tituloVencido: [], fundamentacaoExtra: ["2. " + VENCIDO_TXT] });
  assert.ok(L.maioriaDoFecho(semTitulo).maioria);
  assert.ok(temMaioria(ver(semTitulo, TRECHO_VENCIDO)));
});

// ------------------------------------------------------------------ regressão 2: "por maioria" no vocabulário dos itens
test("rodada 3: item de acórdão UNÂNIME com 'por maioria absoluta' e 'parcelas vencidas' (RPPS) não é julgamento por maioria", () => {
  const casos = [
    "II - Determinar ao Instituto que comprove a aprovação da política de investimentos por maioria absoluta do Conselho Deliberativo e o pagamento das parcelas vencidas do parcelamento;",
    "II - Alertar que, vencido o prazo o Relator poderá aplicar a multa prevista em lei;",
    "II - Encaminhar cópia ao gestor, vencido o prazo concedido pelo Conselheiro Relator, para as providências;",
  ];
  for (const item of casos) {
    const bruto = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "", itensExtra: [item] });
    assert.equal(L.maioriaDoFecho(bruto).maioria, false, item);
    assert.ok(semAlertaDeMaioria(ver(bruto, TRECHO_RELATOR)), item);
  }
  // o sinal estrito continua valendo nos itens: "por maioria, vencido(s), em parte, o(s) Conselheiro(s) …"
  for (const item of ["II - Fixar a multa do item I por maioria, vencido o Conselheiro Substituto Gervásio Hilário Lacerda, que a reduzia;",
    "II - Fixar a multa do item I, vencidos, em parte, os Conselheiros Gervásio Hilário Lacerda e Marcelo Nunes Pereira;"]) {
    const bruto = acordao({ fecho: FECHO_UNANIME.replace(", por unanimidade", ""), itensExtra: [item] });
    const f = L.maioriaDoFecho(bruto);
    assert.ok(f.maioria && f.vencidos.some((v) => v.join(" ") === "gervasio hilario lacerda"), `${item}: ${JSON.stringify(f)}`);
    assert.ok(temVencido(ver(bruto, TRECHO_VENCIDO)), item);
  }
});

// ------------------------------------------------------------------ (A) fronteira autuação × RELATÓRIO / ementa
test("rodada 3: a 1ª linha do RELATÓRIO depois da autuação repetida é RELATÓRIO; relatório [...] voto e autuação [...] ementa viram 🟠", () => {
  const bruto = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "", autuacaoRepetida: true });
  const r1 = ver(bruto, "Trata-se de fiscalização instaurada para verificar o cumprimento de determinação anterior");
  assert.ok(r1.valido && r1.posicao.startsWith("RELATÓRIO"), r1.posicao);
  const ementa1 = ver(bruto, "O descumprimento reiterado de determinação desta Corte sujeita o gestor");
  assert.ok(ementa1.posicao.startsWith("ementa"), ementa1.posicao);
  const juncao = ver(bruto, "Trata-se de fiscalização instaurada para verificar o cumprimento [...] " + TRECHO_RELATOR);
  assert.ok(!juncao.valido && juncao.distante && juncao.tipo === "partes", JSON.stringify(juncao));
  assert.ok(juncao.motivo.includes("relatório × voto condutor"), juncao.motivo);
  const aut = ver(bruto, "JURISDICIONADO: Município de Exemplópolis [...] O descumprimento reiterado de determinação desta Corte");
  assert.ok(!aut.valido && aut.tipo === "partes" && aut.motivo.includes("autuação × ementa"), JSON.stringify(aut));
  // e a autuação com ela mesma (linha de continuação "fevereiro de 2026.") continua ✅
  const autAut = ver(bruto, "SESSÃO: 3ª Sessão Ordinária do Pleno [...] fevereiro de 2026");
  assert.ok(autAut.valido, JSON.stringify(autAut));
});

test("rodada 3, PDF público 96141: '1. Trata-se de apreciação… [...] a saber: 20 anos' (relatório × voto, vão ~2.579) deixa de dar ✅", async () => {
  const idx = await import("../server/index.js");
  const semRede = async () => { throw new Error("o teste da rodada 3 não pode tocar a rede"); };
  idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });
  const t = (await idx.extrairTextoPdf(fs.readFileSync(path.join(AQUI, "fixtures", "pdf", "96141.pdf")))).texto;
  const r = L.verificarTrecho({ [NOME]: t }, "1. Trata-se de apreciação, para fins de registro, do ato [...] os demais requisitos, a saber: 20 anos");
  assert.ok(!r.valido && r.distante && r.tipo === "partes", JSON.stringify(r).slice(0, 600));
  const linha = L.verificarTrecho({ [NOME]: t }, "1. Trata-se de apreciação, para fins de registro, do ato de concessão de aposentadoria");
  assert.ok(linha.valido && linha.posicao.startsWith("RELATÓRIO"), linha.posicao);
});

// ------------------------------------------------------------------ (B) relator vencido
test("rodada 3: 'vencido o Relator' — o trecho no voto de outro conselheiro ganha 'RELATOR VENCIDO' (pode ser o voto vencedor)", () => {
  const bruto = acordao({ fecho: FECHO_MAIORIA.replace("vencido o Conselheiro Substituto Gervásio Hilário Lacerda (substituição em vacância)", "vencido o Relator") });
  const r = ver(bruto, TRECHO_VENCIDO);
  assert.ok(r.valido && r.posicao.startsWith("VOTO de outro conselheiro"), r.posicao);
  assert.ok(r.alertas.some((a) => a.startsWith("RELATOR VENCIDO:") && a.includes("voto VENCEDOR")), JSON.stringify(r.alertas));
  assert.ok(!temVencido(r), "não pode afirmar que o voto do outro conselheiro é o vencido");
  // o trecho do relator continua com o 'confira … entre eles o RELATOR'
  const rRel = ver(bruto, TRECHO_RELATOR);
  assert.ok(rRel.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") && a.includes("o RELATOR")), JSON.stringify(rRel.alertas));
});

// ------------------------------------------------------------------ (C) sobrenome ambíguo
test("rodada 3: 'vencido o Conselheiro Silva' com dois Silvas no acórdão não afirma VOTO VENCIDO de nenhum — sai o 'confira'", () => {
  const vogais = ["CONSELHEIRO FRANCISCO JOAQUIM RAMOS DA SILVA", "Convirjo com o relator quanto a todos os itens do dispositivo, sem ressalvas, acompanhando integralmente a fundamentação do voto condutor."];
  const fecho = FECHO_MAIORIA.replace("vencido o Conselheiro Substituto Gervásio Hilário Lacerda (substituição em vacância)", "vencido o Conselheiro Silva");
  const dois = acordao({ fecho, vogal: vogais, tituloVencido: ["CONSELHEIRO FRANCISCO CARVALHO DA SILVA"] });
  const rVog = ver(dois, "Convirjo com o relator quanto a todos os itens do dispositivo");
  assert.ok(!temVencido(rVog) && temMaioria(rVog), JSON.stringify(rVog.alertas));
  const rVen = ver(dois, TRECHO_VENCIDO);
  assert.ok(!temVencido(rVen) && temMaioria(rVen), JSON.stringify(rVen.alertas));
  // com um Silva só, o sobrenome decide: VOTO VENCIDO no voto dele, nada no vogal de outro nome
  const um = acordao({ fecho, vogal: VOGAL_CONVERGE, tituloVencido: ["CONSELHEIRO FRANCISCO CARVALHO DA SILVA"] });
  assert.ok(temVencido(ver(um, TRECHO_VENCIDO)));
  assert.ok(semAlertaDeMaioria(ver(um, TRECHO_VOGAL)));
  // grafia curta × longa do MESMO conselheiro não é ambiguidade
  const mesmo = acordao({ fecho: fecho.replace("Conselheiro Silva", "Conselheiro Lacerda"), vogal: ["CONSELHEIRO GERVÁSIO LACERDA", "Registro presença."],
    tituloVencido: ["CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"] });
  assert.ok(temVencido(ver(mesmo, TRECHO_VENCIDO)));
  assert.equal(P.linhasConselheiroTc(mesmo).length >= 2, true);
});
