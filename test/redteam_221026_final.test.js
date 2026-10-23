// Red team 22/10/2026, RODADA FINAL — a rechecagem da rodada 3 achou:
//  - FALSO NEGATIVO NOVO: RE_VENCIDO_CONS_N1 só aceitava "eminente/nobre" antes de "Conselheiro" — "Por maioria, vencido o Excelentíssimo
//    Conselheiro Substituto X" (maioria só nos itens) voltava ao falso "confere" do defeito original;
//  - ALARME FALSO NOVO: ",?" depois de "vencid" e "relator" sem fronteira ("Relatoria") em item de acórdão UNÂNIME;
//  - ALARME FALSO QUE CONTINUA: "vencido" adjetivo ("o prazo vencido o Conselheiro Relator") em item unânime;
//  - ALARME FALSO NOVO: "vencido o Conselheiro Substituto X, divergindo do Relator quanto à multa" marcava o RELATOR como vencido.
// E o defeito original (voto vencido sem alerta) continua fechado. 100% offline e sintético (nomes inventados); estado em os.tmpdir().
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-rt221026-final-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
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


const FECHO_SEM_MAIORIA = FECHO_UNANIME.replace(", por unanimidade", "");
const GERVASIO = (f) => f.vencidos.some((v) => v.join(" ").endsWith("gervasio hilario lacerda"));

// ------------------------------------------------------------------ (1) título livre antes de "Conselheiro"
test("final (1): 'Por maioria, vencido o Excelentíssimo/Senhor Conselheiro …' só nos itens continua dando VOTO VENCIDO", () => {
  for (const item of [
    "II - Por maioria, vencido o Excelentíssimo Conselheiro Substituto Gervásio Hilário Lacerda, reduzir a multa;",
    "II - Por maioria, vencido o Senhor Conselheiro Substituto Gervásio Hilário Lacerda, reduzir a multa;",
    "II - Por maioria, vencido o Excelentíssimo Senhor Conselheiro Substituto Gervásio Hilário Lacerda, reduzir a multa;",
    "II - Por maioria, vencido o eminente Conselheiro Substituto Gervásio Hilário Lacerda, reduzir a multa;",
  ]) {
    const bruto = acordao({ fecho: FECHO_SEM_MAIORIA, itensExtra: [item] });
    const f = L.maioriaDoFecho(bruto);
    assert.ok(f.maioria && GERVASIO(f) && !f.relatorVencido, `${item}: ${JSON.stringify(f)}`);
    const r = ver(bruto, TRECHO_VENCIDO);
    assert.ok(temVencido(r), `${item}: ${JSON.stringify(r.alertas)}`);
  }
});

// ------------------------------------------------------------------ (2) vírgula depois de "vencid" e "Relatoria"
test("final (2): 'uma vez vencido, o Relator' e 'a Relatoria' em item de acórdão UNÂNIME não disparam", () => {
  for (const item of [
    "II - Determinar que, uma vez vencido, o Relator seja informado do descumprimento;",
    "II - Determinar o recolhimento das contribuições vencidas, a Relatoria acompanhará o cumprimento;",
    "II - Determinar ao gestor que, prazos vencidos, a Relatoria seja comunicada;",
  ]) {
    const bruto = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "", itensExtra: [item] });
    assert.equal(L.maioriaDoFecho(bruto).maioria, false, item);
    assert.ok(semAlertaDeMaioria(ver(bruto, TRECHO_RELATOR)), item);
  }
  // a vírgula antes do advérbio de extensão continua aceita
  const bruto = acordao({ fecho: FECHO_SEM_MAIORIA,
    itensExtra: ["II - Fixar a multa do item I, vencidos, em parte, os Conselheiros Gervásio Hilário Lacerda e Marcelo Nunes Pereira;"] });
  assert.ok(GERVASIO(L.maioriaDoFecho(bruto)));
});

// ------------------------------------------------------------------ (3) "vencido" adjetivo
test("final (3): 'vencido' adjetivo do substantivo anterior em item de acórdão UNÂNIME não dispara", () => {
  for (const item of [
    "II - Alertar que o prazo vencido o Conselheiro Relator poderá aplicar nova multa;",
    "II - Cientificar que débitos vencidos o Conselheiro Relator poderá executar;",
    "II - Determinar que as parcelas vencidas a Conselheiros Fiscais sejam pagas;",
    "II - Alertar que, vencido o prazo o Relator poderá aplicar a multa prevista em lei;",
  ]) {
    const bruto = acordao({ fecho: FECHO_UNANIME, tituloVencido: [], vencidoTxt: "", itensExtra: [item] });
    assert.equal(L.maioriaDoFecho(bruto).maioria, false, item);
    assert.ok(semAlertaDeMaioria(ver(bruto, TRECHO_RELATOR)), item);
  }
});

// ------------------------------------------------------------------ (4) "divergindo do Relator" não é relator vencido
test("final (4): '… vencido o Conselheiro Substituto X, divergindo/acompanhando em parte o Relator' não marca o RELATOR como vencido", () => {
  const VOGAL = ["CONSELHEIRO MARCELO NUNES PEREIRA",
    "Convirjo com o relator, pois as determinações foram reiteradas e o gestor não apresentou qualquer justificativa para o " +
    "descumprimento, o que autoriza a multa no patamar proposto."];
  const TRECHO_VOGAL = "as determinações foram reiteradas e o gestor não apresentou qualquer justificativa";
  for (const cauda of ["divergindo do Relator quanto à multa", "acompanhando em parte o Relator", "que divergiu do Relator"]) {
    const fecho = "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, por maioria, vencido o " +
      `Conselheiro Substituto Gervásio Hilário Lacerda, ${cauda}, em:`;
    const bruto = acordao({ fecho, vogal: VOGAL });
    const f = L.maioriaDoFecho(bruto);
    assert.ok(f.maioria && GERVASIO(f) && !f.relatorVencido, `${cauda}: ${JSON.stringify(f)}`);
    const rVog = ver(bruto, TRECHO_VOGAL);
    assert.ok(!rVog.alertas.some((a) => a.startsWith("RELATOR VENCIDO")) && !temVencido(rVog), `${cauda}: ${JSON.stringify(rVog.alertas)}`);
    assert.ok(temVencido(ver(bruto, TRECHO_VENCIDO)), cauda);
  }
  // "vencido o Relator" e "vencida a Relatora" de verdade continuam marcando
  for (const fr of ["por maioria, vencido o Relator, em:", "por maioria, vencida a Relatora, em:",
    "por maioria, vencidos o Conselheiro Substituto Gervásio Hilário Lacerda e o Relator, em:"]) {
    const f = L.maioriaDoFecho(acordao({ fecho: "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, " + fr }));
    assert.ok(f.maioria && f.relatorVencido, `${fr}: ${JSON.stringify(f)}`);
  }
});

// ------------------------------------------------------------------ defeito original
test("final: o defeito original continua fechado — fecho por maioria → VOTO VENCIDO no vencido, relator sem alerta; unânime → nada", () => {
  const bruto = acordao();
  const f = L.maioriaDoFecho(bruto);
  assert.ok(f.maioria && GERVASIO(f) && !f.relatorVencido, JSON.stringify(f));
  const r = ver(bruto, TRECHO_VENCIDO);
  assert.ok(r.valido && r.posicao.startsWith("VOTO de outro conselheiro") && temVencido(r), `${r.posicao} ${JSON.stringify(r.alertas)}`);
  assert.ok(semAlertaDeMaioria(ver(bruto, TRECHO_RELATOR)));
  const un = acordao({ fecho: FECHO_UNANIME });
  assert.equal(L.maioriaDoFecho(un).maioria, false);
  assert.ok(semAlertaDeMaioria(ver(un, TRECHO_VENCIDO)));
});
