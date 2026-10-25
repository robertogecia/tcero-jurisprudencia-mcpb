// 1.7.7 (não publicada) — porte das melhorias do TJRO 1.41.9 para o verificar_citacao_tcero. Cada teste falha na 1.7.6 e passa aqui.
//  1. selo de voz com evidência (✅ pleno só com voz da Corte; voto = VOZ NÃO CONFIRMADA; relatório/autuação = NÃO É VOZ DO ÓRGÃO);
//     guardas da voz da casa (certidão/autuação na "ementa do cadastro"; fala do relator entre o ACORDAM e o trecho);
//  2. DOUTRINA, DECISÃO/PARECER/DEFESA TRANSCRITA, OBITER DICTUM? por concessiva negativa, ALEGAÇÃO DA PARTE com sujeito do TCE;
//  3. FRAGMENTOS CURTOS na costura com [...];
//  4. hífen de quebra de linha, hífen invisível e milhar (números e negadores exatos; metade de "im- procedente" não casa);
//  5. relator vencido em grafias novas ("Relator vencido", "vencido o voto do Relator", "vencido o E. Relator").
// 100% offline e sintético (nomes inventados); estado e recibos em os.tmpdir(). Não importa index.js.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-portes2410-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NOME = "texto (recibo: ementa + dispositivo + PDF quando lido)";
const S = { idDecisao: "1", sigla: "APL-TC", numero: "00001/26" };
const FECHO =
  "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
  "Relator, Conselheiro Alfredo Bernardes Costa, por unanimidade, em:";

/** Acórdão sintético no molde do TCE-RO (o mesmo dos testes do red team de 22/10/2026). */
function acordao({ fecho = FECHO, itens = [], relatorio = [], voto = [] } = {}) {
  return [
    "PROCESSO: 01234/25", "ASSUNTO: Fiscalização de atos e contratos", "JURISDICIONADO: Município de Exemplópolis",
    "RELATOR: Conselheiro Alfredo Bernardes Costa", "SESSÃO: 3ª Sessão Ordinária do Pleno, de 9 a 13 de fevereiro de 2026.",
    "EMENTA: FISCALIZAÇÃO DE ATOS. DESCUMPRIMENTO DE DETERMINAÇÃO. MULTA.",
    "1. O descumprimento reiterado de determinação desta Corte sujeita o gestor à multa do art. 55 da lei orgânica.",
    "2. A dosimetria considera a reincidência e o valor de alçada, observado o art. 22 da LINDB.",
    "ACÓRDÃO",
    "Vistos, relatados e discutidos estes autos, que tratam de fiscalização de atos, como tudo dos autos consta.",
    fecho,
    "I - Multar o gestor em R$ 24.000,00 pelo descumprimento reiterado da determinação desta Corte.",
    ...itens,
    "II - Dar ciência ao gestor, na forma regimental, e arquivar os autos após o trânsito em julgado.",
    "RELATÓRIO",
    "1. Trata-se de fiscalização instaurada para verificar o cumprimento de determinação anterior desta Corte de Contas.",
    ...relatorio,
    "VOTO",
    "CONSELHEIRO ALFREDO BERNARDES COSTA",
    "A multa deve ser fixada em patamar suficiente para reprimir a conduta reiterada do gestor municipal omisso.",
    ...voto,
    "Ante o exposto, voto por multar o gestor, nos termos do item I.",
    "É como voto.",
    "Em 1º de outubro de 2026",
  ].join("\n");
}
const ver = (bruto, trecho) => L.verificarTrecho({ [NOME]: bruto }, trecho);
const selo = (bruto, trecho) => L.linhasVerificacaoItem(S, trecho, { [NOME]: bruto })[0];
const tem = (r, p) => r.alertas.some((a) => a.startsWith(p));

// ------------------------------------------------------------------ 1. selo de voz
test("1: ✅ pleno só no fecho/ementa; voto = VOZ NÃO CONFIRMADA; relatório = NÃO É VOZ DO ÓRGÃO", () => {
  const b = acordao();
  const fecho = selo(b, "Multar o gestor em R$ 24.000,00 pelo descumprimento reiterado");
  assert.ok(fecho.startsWith("✅ VÁLIDO ·"), fecho);                                  // pleno, sem qualificação
  const voto = selo(b, "A multa deve ser fixada em patamar suficiente para reprimir a conduta");
  assert.ok(voto.startsWith("✅ VÁLIDO, VOZ NÃO CONFIRMADA"), voto);
  const rel = selo(b, "Trata-se de fiscalização instaurada para verificar o cumprimento");
  assert.ok(rel.startsWith("✅ VÁLIDO, MAS NÃO É VOZ DO ÓRGÃO"), rel);
  const r = ver(b, "A multa deve ser fixada em patamar suficiente para reprimir a conduta");
  assert.equal(r.vozConfirmada, false);
});

test("1: guarda — certidão/autuação no dispositivo do cadastro não é 'ementa do cadastro' com voz confirmada", () => {
  // formato do recibo: ementa do cadastro + "\n\n" + dispositivo do cadastro (aqui, a certidão de julgamento) — sem cabeçalho de página
  const b = "FISCALIZAÇÃO. MULTA.\r\nO descumprimento de determinação sujeita o gestor à multa regimental prevista na lei orgânica.\n\n" +
    "CERTIDÃO DE JULGAMENTO SESSÃO VIRTUAL N. 003\n Órgão Julgador: 2ª Câmara\n Responsáveis: Fulano de Tal Beltrano – CPF n. ***.111.222-**, Sicrano de Tal\n" +
    " Assunto: Análise da legalidade da contratação emergencial realizada pelo órgão\n\n" +
    // 1ª página do PDF: o cabeçalho de página é o que a posição usa para saber onde acaba a "ementa do cadastro"
    "TRIBUNAL DE CONTAS DO ESTADO DE RONDÔNIA \nSecretaria de Processamento e Julgamento \nwww.tce.ro.gov.br \n1 de 7 \n" +
    "PROCESSO: 01234/25\nASSUNTO: Fiscalização\nJURISDICIONADO: Município de Exemplópolis\nRELATOR: Conselheiro Alfredo Bernardes Costa\n";
  const ok = ver(b, "O descumprimento de determinação sujeita o gestor à multa regimental");
  assert.ok(ok.vozConfirmada, JSON.stringify(ok));                                     // a ementa de verdade continua ✅ pleno
  const r = ver(b, "Fulano de Tal Beltrano – CPF n. ***.111.222-**, Sicrano de Tal");
  assert.ok(r.valido && !r.vozConfirmada && /certidão|autuação/.test(r.guardaVoz), JSON.stringify(r));
  assert.ok(selo(b, "Fulano de Tal Beltrano – CPF n. ***.111.222-**, Sicrano de Tal").includes("VOZ NÃO CONFIRMADA"));
});

test("1: guarda — fala do relator entre o ACORDAM e o trecho tira a confirmação do fecho", () => {
  const b = acordao({ itens: ["Diante do exposto, proponho ao Colegiado que se mantenha a multa aplicada ao gestor responsável pela omissão."] });
  const r = ver(b, "que se mantenha a multa aplicada ao gestor responsável pela omissão");
  assert.ok(r.valido && /acórdão\/fecho/.test(r.posicao) && !r.vozConfirmada && /proponho/.test(r.guardaVoz), JSON.stringify(r));
});

// ------------------------------------------------------------------ 2. alertas novos
test("2: DOUTRINA anunciada por dois-pontos, sem aspas", () => {
  const b = acordao({ voto: ["Como leciona Marçal Justen Filho:", "A licitação dispensada exige motivação concreta da emergência e da escolha do contratado, sob pena de nulidade do ajuste celebrado."] });
  const r = ver(b, "A licitação dispensada exige motivação concreta da emergência e da escolha do contratado");
  assert.ok(r.valido && tem(r, "DOUTRINA:"), JSON.stringify(r.alertas));
});

test("2: DECISÃO TRANSCRITA, PARECER TRANSCRITO (fundo do bloco, longe da palavra 'parecer') e DEFESA TRANSCRITA", () => {
  const longo = "O ajuste foi celebrado sem a demonstração da vantajosidade e sem pesquisa de preços com fornecedores do ramo, o que impede a aferição do preço justo pela Administração municipal.";
  const dec = acordao({ voto: ["Transcrevo trecho da Decisão Monocrática n. 0123/2025, que concedeu a tutela:", longo] });
  assert.ok(tem(ver(dec, "impede a aferição do preço justo pela Administração municipal"), "DECISÃO TRANSCRITA:"));
  const par = acordao({ voto: ["O Ministério Público de Contas, no Parecer n. 0456/2025, opinou nos seguintes termos:",
    longo + " Registre-se ainda que a documentação acostada não supre a lacuna, porque as cotações apresentadas são posteriores à contratação e foram obtidas de empresas ligadas."] });
  const rp = ver(par, "as cotações apresentadas são posteriores à contratação e foram obtidas de empresas ligadas");
  assert.ok(tem(rp, "PARECER TRANSCRITO:"), JSON.stringify(rp.alertas));
  const def = acordao({ voto: ["Em suas justificativas, o responsável apresentou os seguintes argumentos:",
    longo.replace("O ajuste foi celebrado sem", "Houve") + " Ressalte-se, por fim, que a situação emergencial decorreu de fatos imprevisíveis e alheios à vontade da gestão municipal naquele exercício."] });
  const rd = ver(def, "a situação emergencial decorreu de fatos imprevisíveis e alheios à vontade da gestão");
  assert.ok(tem(rd, "DEFESA TRANSCRITA:"), JSON.stringify(rd.alertas));
});

test("2: rótulo de autuação ('…de Professor\\nJURISDICIONADO:') não abre bloco de DOUTRINA", () => {
  const b = acordao().replace("ASSUNTO: Fiscalização de atos e contratos", "ASSUNTO: Aposentadoria Especial de Professor");
  const r = ver(b, "Município de Exemplópolis RELATOR: Conselheiro Alfredo Bernardes Costa");
  assert.ok(r.valido && !tem(r, "DOUTRINA"), JSON.stringify(r.alertas));
});

test("2: OBITER DICTUM? (concessiva negativa), com abreviatura no meio; o conectivo dentro do trecho não dispara", () => {
  const b = acordao({ voto: ["Ainda que não haja dano ao erário apurado nos termos do art. 16 da lei orgânica, a conduta configura infração grave à norma legal."] });
  const r = ver(b, "não haja dano ao erário apurado nos termos do art. 16 da lei orgânica");
  assert.ok(tem(r, "OBITER DICTUM? (concessiva)"), JSON.stringify(r.alertas));
  const c = ver(b, "Ainda que não haja dano ao erário apurado nos termos do art. 16 da lei orgânica, a conduta configura");
  assert.ok(!tem(c, "OBITER DICTUM? (concessiva)"), JSON.stringify(c.alertas));
  const pos = acordao({ voto: ["A multa é devida pela omissão reiterada do gestor, ainda que não tenha havido prejuízo financeiro ao Município. A reincidência agrava a sanção."] });
  assert.ok(tem(ver(pos, "não tenha havido prejuízo financeiro ao Município"), "OBITER DICTUM? (concessiva)"));
});

test("2: ALEGAÇÃO DA PARTE com sujeito do processo de contas e verbo que a regra antiga não tinha", () => {
  const b = acordao({ relatorio: ["2. O jurisdicionado afirma que o contrato foi executado integralmente conforme o cronograma físico-financeiro aprovado."] });
  const r = ver(b, "o contrato foi executado integralmente conforme o cronograma físico-financeiro aprovado");
  assert.ok(tem(r, "ALEGAÇÃO DA PARTE"), JSON.stringify(r.alertas));
  // a Corte refutando: "Ao contrário do que afirma o jurisdicionado, …" não é alegação
  const c = acordao({ voto: ["Ao contrário do que afirma o jurisdicionado, verifico que o contrato não foi executado conforme o cronograma aprovado."] });
  assert.ok(!tem(ver(c, "verifico que o contrato não foi executado conforme o cronograma aprovado"), "ALEGAÇÃO DA PARTE"));
});

// ------------------------------------------------------------------ 3. costura
test("3: FRAGMENTOS CURTOS — dois pedaços de 2 palavras, ou três sem nenhum de 5+; costura com fragmento longo não avisa", () => {
  const b = acordao();
  const r2 = ver(b, "descumprimento reiterado [...] dosimetria considera");
  assert.ok(r2.valido && tem(r2, "FRAGMENTOS CURTOS"), JSON.stringify(r2));
  assert.ok(selo(b, "descumprimento reiterado [...] dosimetria considera").includes("FRAGMENTOS CURTOS"));
  const r3 = ver(b, "O descumprimento reiterado de [...] sujeita o gestor à [...] dosimetria considera a reincidência");
  assert.ok(r3.valido && tem(r3, "FRAGMENTOS CURTOS"), JSON.stringify(r3));
  const ok = ver(b, "O descumprimento reiterado de determinação desta Corte [...] dosimetria considera a reincidência");
  assert.ok(ok.valido && !tem(ok, "FRAGMENTOS CURTOS"), JSON.stringify(ok.alertas));
});

// ------------------------------------------------------------------ 4. hífen de quebra, hífen invisível, milhar
test("4: 'con-\\ntrato' e hífen invisível casam com 'contrato'; '24000' casa com '24.000'; número diferente não", () => {
  const b = acordao({ voto: ["O con-\ntrato administrativo foi rescindido por inexecução parcial do objeto pactuado.",
    "A pror­rogação do ajuste dependia de justificativa prévia e escrita da autoridade competente."] });
  assert.ok(ver(b, "O contrato administrativo foi rescindido por inexecução parcial").valido);
  assert.ok(ver(b, "A prorrogação do ajuste dependia de justificativa prévia e escrita").valido);
  assert.ok(ver(b, "Multar o gestor em R$ 24000,00 pelo descumprimento reiterado").valido);
  assert.ok(!ver(b, "Multar o gestor em R$ 25000,00 pelo descumprimento reiterado").valido);
  // o trecho colado do PDF com a quebra ("con- trato") também
  assert.ok(ver(b, "O con- trato administrativo foi rescindido por inexecução parcial").valido);
});

test("4: metade de palavra depois de prefixo negativo partido ('im- procedente') não casa", () => {
  const b = acordao({ voto: ["Julgo im-\nprocedente o pedido de reconsideração formulado pelo gestor municipal."] });
  assert.ok(!ver(b, "procedente o pedido de reconsideração formulado pelo gestor").valido);
  assert.ok(ver(b, "improcedente o pedido de reconsideração formulado pelo gestor").valido);
});

// ------------------------------------------------------------------ 5. relator vencido
test("5: 'Relator vencido', 'vencido o voto do Relator' e 'vencido o E. Relator' marcam o relator vencido", () => {
  for (const f of [
    FECHO.replace("por unanimidade", "por maioria, Relator vencido"),
    FECHO.replace("por unanimidade", "por maioria, relator(a) vencido(a)"),
    FECHO.replace("por unanimidade", "vencido o voto do Relator"),
    FECHO.replace("por unanimidade", "por maioria, vencido o E. Relator"),
  ]) {
    const m = L.maioriaDoFecho(acordao({ fecho: f }));
    assert.ok(m.maioria && m.relatorVencido, `${f}: ${JSON.stringify(m)}`);
  }
  // "vencido em parte" não é relator vencido por inteiro
  const p = L.maioriaDoFecho(acordao({ fecho: FECHO.replace("por unanimidade", "por maioria, Relator vencido em parte") }));
  assert.ok(!p.relatorVencido, JSON.stringify(p));
});

import { guardaVozDaCasa } from "../server/voz_tc.js";
import { norm1 as norm1Tc } from "../server/atribuicao13.js";
test("1.7.7 (medição cega): certidão, qualificação e cabeçalho de página não são voz do colegiado", () => {
  const f = (t, tr, pos = "acórdão/fecho") => { const i = t.indexOf(tr); return guardaVozDaCasa(t, norm1Tc(t), i, pos, "", i + tr.length); };
  const base = "ACORDAM os Conselheiros, por unanimidade, em julgar regular a conta. Participaram do julgamento os Conselheiros Fulano e Beltrano. Porto Velho, 10 de abril de 2026.";
  assert.ok(f(base, "Participaram do julgamento os Conselheiros Fulano"));
  assert.ok(f(base, "Porto Velho, 10 de abril de 2026"));
  assert.ok(f("o responsável Fulano de Tal, CPF 000.000.000-00, e seu advogado, OAB/RO 1234, apresentaram defesa", "CPF 000.000.000-00, e seu advogado", "ementa (modelo antigo)"));
  assert.ok(f("fim do voto TRIBUNAL DE CONTAS DO ESTADO DE RONDÔNIA Secretaria de Processamento e Julgamento texto", "TRIBUNAL DE CONTAS DO ESTADO DE RONDÔNIA Secretaria", "ementa"));
  assert.equal(f("ACORDAM os Conselheiros, por unanimidade, em julgar regular a conta e dar quitação.", "julgar regular a conta e dar quitação"), "");
});

import { verificarTrecho } from "../server/lib.js";
test("1.7.7 (reataque): negação omitida pelo [...] entre dois fragmentos avisa", () => {
  const t = "EMENTA: RECURSO DE REVISÃO. O Recurso de Revisão, por sua natureza excepcional, não se presta para a rediscussão do mérito já decidido pela Corte.";
  const r = verificarTrecho({ ementa: t }, "O Recurso de Revisão [...] se presta para a rediscussão do mérito");
  assert.ok((r.alertas || []).some((a) => a.startsWith("NEGAÇÃO OMITIDA")), JSON.stringify(r.alertas));
  const ok = verificarTrecho({ ementa: t }, "O Recurso de Revisão [...] não se presta para a rediscussão do mérito");
  assert.ok(!(ok.alertas || []).some((a) => a.startsWith("NEGAÇÃO OMITIDA")));
});
test("1.7.7 (reataque): 'voto do Relator, vencido o Conselheiro X' não faz do relator o vencido", async () => {
  const { RE_RELATOR_VENCIDO_POS } = await import("../server/voz_tc.js");
  assert.equal(RE_RELATOR_VENCIDO_POS.test("em consonancia com o voto do relator, vencido o conselheiro benedito"), false);
  assert.equal(RE_RELATOR_VENCIDO_POS.test("relator vencido"), true);
});
