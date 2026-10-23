// Red team 22/10/2026, RODADA 2 — o revisor independente reatacou as correções da rodada 1 do TCE-RO:
//  - REGRESSÃO: o corte fixo de 500 caracteres no `[...]` rebaixava a 🟠 elipses legítimas dentro da mesma parte do julgado (ementa com
//    ementa, voto com voto), e deixava passar junção CURTA entre partes vizinhas (fim da ementa [...] "Vistos, relatados…" do acórdão);
//  - VARIANTES do voto vencido: título em duas linhas logo depois do relator, nome abreviado/encurtado, "VOTO DIVERGENTE" com o nome na
//    linha seguinte, "ACORDAM os Conselheiros" sem "Senhores", "por maioria, vencido…" dentro dos itens, título em caixa mista.
// 100% offline e sintético (nomes inventados); estado e recibos em pasta temporária de os.tmpdir().
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-rt221026-r2-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const V = await import("../server/v160.js");
const P = await import("../server/posicao2.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NOME = "texto (recibo: ementa + dispositivo + PDF quando lido)";
const FECHO_PADRAO =
  "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
  "Relator, Conselheiro Alfredo Bernardes Costa, por maioria, vencido o Conselheiro Substituto Gervásio Hilário Lacerda " +
  "(substituição em vacância), quanto ao valor da multa; e por unanimidade quanto aos demais itens, em:";
const ITENS = Array.from({ length: 14 }, (_, i) =>
  `${i + 2} - Determinar ao gestor que adote as providências de número ${i + 2}, informando a esta Corte no prazo regimental.`);
const VENCIDO_TXT =
  "Peço vênia ao relator para divergir quanto ao montante, pois a multa reduzida a um décimo do valor de alçada atende melhor a " +
  "finalidade pedagógica da sanção aplicada ao gestor.";
const TRECHO_VENCIDO = "a multa reduzida a um décimo do valor de alçada atende melhor a finalidade pedagógica da sanção";
const TRECHO_RELATOR = "A multa deve ser fixada em patamar suficiente para reprimir a conduta reiterada do gestor municipal";

/** Acórdão SINTÉTICO no formato do TCE-RO. `tituloVencido`: linhas do título do voto vencido; `vogal`: linhas do vogal antes dele. */
function acordao({ fecho = FECHO_PADRAO, itensExtra = [], tituloVencido = ["VOTO", "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"],
  vogal = null, tituloRelator = ["VOTO", "CONSELHEIRO ALFREDO BERNARDES COSTA"], fundamentacaoExtra = [] } = {}) {
  return [
    "PROCESSO: 01234/25",
    "ASSUNTO: Fiscalização de atos e contratos",
    "JURISDICIONADO: Município de Exemplópolis",
    "RELATOR: Conselheiro Alfredo Bernardes Costa",
    "SESSÃO: 3ª Sessão Ordinária",
    "",
    "EMENTA: FISCALIZAÇÃO DE ATOS. DESCUMPRIMENTO DE DETERMINAÇÃO. MULTA.",
    "1. O descumprimento reiterado de determinação desta Corte sujeita o gestor à multa do art. 55 da lei orgânica.",
    "2. A dosimetria considera a reincidência e o valor de alçada, observado o art. 22 da LINDB.",
    "ACÓRDÃO",
    "Vistos, relatados e discutidos estes autos, que tratam de fiscalização de atos, como tudo dos autos consta.",
    fecho,
    "I - Multar o gestor em R$ 24.000,00 pelo descumprimento de determinação.",
    ...itensExtra,
    ...ITENS,
    "RELATÓRIO",
    "1. Trata-se de fiscalização instaurada para verificar o cumprimento de determinação anterior desta Corte de Contas.",
    ...tituloRelator,
    TRECHO_RELATOR + " omisso.",
    ...fundamentacaoExtra,
    "3. O valor de alçada orienta a dosimetria, observadas as circunstâncias do art. 22 da LINDB e a reincidência.",
    "É como voto.",
    ...(vogal || []),
    ...tituloVencido,
    VENCIDO_TXT,
    "Em 1º de outubro de 2026",
  ].join("\n");
}
const ver = (bruto, trecho) => L.verificarTrecho({ [NOME]: bruto }, trecho);
const temVencido = (r) => r.alertas.some((a) => a.startsWith("VOTO VENCIDO:"));
const temMaioria = (r) => r.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA"));

// ------------------------------------------------------------------ achado 1, variantes
test("rodada 2: voto vencido com título em DUAS linhas logo depois do relator (sem vogal no meio) → voto de outro + VOTO VENCIDO", () => {
  for (const primeira of ["VOTO", "VOTO-VISTA", "VOTO DIVERGENTE"]) {
    const bruto = acordao({ tituloVencido: [primeira, "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"] });
    const r = ver(bruto, TRECHO_VENCIDO);
    assert.ok(r.valido, JSON.stringify(r));
    assert.ok(r.posicao.startsWith(`VOTO de outro conselheiro (título: «${primeira} CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA`), `${primeira}: ${r.posicao}`);
    assert.ok(!r.posicao.includes("voto condutor (dispositivo"), r.posicao);
    assert.ok(temVencido(r), `${primeira}: ${JSON.stringify(r.alertas)}`);
    assert.deepEqual(r.notas, []);
    // o voto do relator (também em duas linhas) continua condutor e sem ruído
    const rRel = ver(bruto, TRECHO_RELATOR);
    assert.ok(rRel.posicao.startsWith("fundamentação do voto condutor"), rRel.posicao);
    assert.ok(!temVencido(rRel) && !temMaioria(rRel), JSON.stringify(rRel.alertas));
    // a estrutura do PDF não lista a 2ª linha do título como voto à parte
    const est = V.estruturaPdfTcero(bruto).filter(([rot]) => rot === "VOTO de outro conselheiro");
    assert.equal(est.length, 1, JSON.stringify(V.estruturaPdfTcero(bruto)));
  }
});

test("rodada 2: nome abreviado no fecho ou encurtado no título ainda casa (subsequência; sobrenome final quando há uma palavra só)", () => {
  const abreviado = acordao({ fecho: FECHO_PADRAO.replace("Gervásio Hilário Lacerda", "Gervásio H. Lacerda") });
  assert.ok(temVencido(ver(abreviado, TRECHO_VENCIDO)));
  const tituloCurto = acordao({ tituloVencido: ["CONSELHEIRO SUBSTITUTO GERVÁSIO LACERDA"], vogal: ["CONSELHEIRO MARCELO NUNES PEREIRA", "Convirjo com o relator."] });
  const r = ver(tituloCurto, TRECHO_VENCIDO);
  assert.ok(r.posicao.startsWith("VOTO de outro conselheiro (título: «CONSELHEIRO SUBSTITUTO GERVÁSIO LACERDA"), r.posicao);
  assert.ok(temVencido(r), JSON.stringify(r.alertas));
  const soSobrenome = acordao({ fecho: FECHO_PADRAO.replace("Substituto Gervásio Hilário Lacerda", "Lacerda") });
  assert.ok(temVencido(ver(soSobrenome, TRECHO_VENCIDO)));
  // casamento de nomes: não confunde conselheiros diferentes
  assert.equal(L.mesmoNomeTc(["gervasio", "lacerda"], ["gervasio", "hilario", "lacerda"]), true);
  assert.equal(L.mesmoNomeTc(["lacerda"], ["gervasio", "hilario", "lacerda"]), true);
  assert.equal(L.mesmoNomeTc(["gervasio"], ["gervasio", "hilario", "lacerda"]), false);
  assert.equal(L.mesmoNomeTc(["marcelo", "pereira"], ["gervasio", "hilario", "lacerda"]), false);
  // "vencido parcialmente o Conselheiro …": o advérbio não entra no nome
  const f = L.maioriaDoFecho(acordao({ fecho: FECHO_PADRAO.replace("vencido o Conselheiro", "vencido parcialmente o Conselheiro") }));
  assert.deepEqual(f.vencidos, [["gervasio", "hilario", "lacerda"]]);
});

test("rodada 2: 'ACORDAM os Conselheiros' (sem 'Senhores') e 'por maioria, vencido…' dentro dos itens também contam", () => {
  const semSenhores = acordao({ fecho: FECHO_PADRAO.replace("ACORDAM os Senhores Conselheiros", "ACORDAM os Conselheiros"),
    tituloVencido: [], fundamentacaoExtra: ["2. " + VENCIDO_TXT] });
  const r1 = ver(semSenhores, TRECHO_VENCIDO);
  assert.ok(r1.posicao.startsWith("fundamentação do voto condutor"), r1.posicao);
  assert.ok(temMaioria(r1), "sem 'Senhores' o voto vencido sem título voltava a ser 'voto condutor' sem alerta: " + JSON.stringify(r1.alertas));

  const noItem = acordao({
    fecho: "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do Relator, em:",
    itensExtra: ["II - Fixar a multa do item I por maioria, vencido o Conselheiro Substituto Gervásio Hilário Lacerda, que a reduzia;"],
  });
  const f = L.maioriaDoFecho(noItem);
  assert.ok(f.maioria, JSON.stringify(f));
  assert.deepEqual(f.vencidos, [["gervasio", "hilario", "lacerda"]]);
  assert.ok(temVencido(ver(noItem, TRECHO_VENCIDO)));

  // e o sinal nos itens é estrito: "prazo vencido"/"título vencido" não é julgamento por maioria
  const falso = acordao({
    fecho: "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, por unanimidade, em:",
    itensExtra: ["II - Determinar a cobrança do título vencido e a regularização do prazo vencido em 2025;"],
    tituloVencido: [], fundamentacaoExtra: ["2. " + VENCIDO_TXT],
  });
  assert.equal(L.maioriaDoFecho(falso).maioria, false);
  assert.ok(!temMaioria(ver(falso, TRECHO_RELATOR)));
});

test("rodada 2: título em caixa mista depois de um vogal — não vira VOTO VENCIDO do vogal, mas sai o 'confira'", () => {
  const bruto = acordao({
    vogal: ["CONSELHEIRO MARCELO NUNES PEREIRA", "Convirjo com o relator."],
    tituloVencido: ["Conselheiro Substituto Gervásio Hilário Lacerda"],
  });
  const r = ver(bruto, TRECHO_VENCIDO);
  assert.ok(r.valido, JSON.stringify(r));
  // a posição não separa o voto em caixa mista (limite conhecido): fica no segmento do vogal, mas o alerta conservador aparece
  assert.ok(r.posicao.startsWith("VOTO de outro conselheiro (título: «CONSELHEIRO MARCELO NUNES PEREIRA"), r.posicao);
  assert.ok(!temVencido(r) && temMaioria(r), JSON.stringify(r.alertas));
  // com o vencido titulado em caixa alta, o vogal que só converge continua sem alerta nenhum de maioria
  const ok = acordao({ vogal: ["CONSELHEIRO MARCELO NUNES PEREIRA", "Convirjo com o relator."], tituloVencido: ["CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"] });
  const rConv = ver(ok, "CONSELHEIRO MARCELO NUNES PEREIRA Convirjo com o relator");
  assert.ok(rConv.valido && !temVencido(rConv) && !temMaioria(rConv), JSON.stringify(rConv.alertas));
});

test("rodada 2: o alerta depende do SEGMENTO que a posição atribui ao vencido, não de existir uma linha com o nome dele", () => {
  // o texto do vencido está colado no voto do relator; o nome dele só aparece numa linha de assinatura em caixa alta no fim, sem texto
  // próprio: isso não é voto separado, e o trecho no "voto condutor" recebe o 'confira'
  const bruto = acordao({ tituloVencido: [], fundamentacaoExtra: ["2. " + VENCIDO_TXT] })
    .replace("Em 1º de outubro", "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA\nEm 1º de outubro");
  const r = ver(bruto, TRECHO_VENCIDO);
  assert.ok(r.posicao.startsWith("fundamentação do voto condutor"), r.posicao);
  assert.ok(temMaioria(r), JSON.stringify(r.alertas));
  // a 2ª linha do título do RELATOR nunca vira voto de outro conselheiro
  const outros = P.votosOutrosTc(acordao());
  assert.deepEqual(outros.map((s) => s.nome), [["gervasio", "hilario", "lacerda"]]);
});

// ------------------------------------------------------------------ achado 2, regressão do corte fixo
test("rodada 2: elipse longa DENTRO da mesma parte volta a ser ✅ (com nota); junção curta entre partes vizinhas vira 🟠", () => {
  // ementa com itens longos: pular um item (vão entre 500 e o teto) é elipse legítima
  const itens = Array.from({ length: 6 }, (_, i) => `${i + 1}. ` + `Item ${i + 1} da ementa sobre a dosimetria da multa e o dever de cumprir as determinações da Corte de Contas. `.repeat(3));
  const bruto = [
    "PROCESSO: 01234/25", "ASSUNTO: Fiscalização", "JURISDICIONADO: Município de Exemplópolis", "RELATOR: Conselheiro Alfredo Bernardes Costa", "",
    "EMENTA: FISCALIZAÇÃO. MULTA.", ...itens,
    "7. A reincidência específica agrava a sanção pecuniária aplicada ao gestor omisso.",
    "ACÓRDÃO",
    "Vistos, relatados e discutidos estes autos, que tratam de fiscalização de atos, como tudo dos autos consta.",
    "ACORDAM os Senhores Conselheiros do Pleno, por unanimidade, em:",
    "I - Multar o gestor em R$ 24.000,00 pelo descumprimento de determinação.",
    "RELATÓRIO", "1. Trata-se de fiscalização.", "VOTO", "CONSELHEIRO ALFREDO BERNARDES COSTA", "2. Texto do voto.", "É como voto.",
  ].join("\n");
  const longa = "Item 1 da ementa sobre a dosimetria da multa [...] A reincidência específica agrava a sanção pecuniária aplicada ao gestor omisso";
  const r = ver(bruto, longa);
  assert.ok(r.valido && !r.distante, JSON.stringify(r));
  assert.ok(r.notas.some((n) => n.startsWith("ELIPSE LONGA") && n.includes("(ementa)")), JSON.stringify(r.notas));
  const linhas = L.linhasVerificacaoItem({ idDecisao: 1, sigla: "APL-TC", numero: "00001/26" }, longa, { [NOME]: bruto });
  assert.ok(linhas[0].startsWith("✅ VÁLIDO") && linhas.some((l) => l.includes("ℹ ELIPSE LONGA")), linhas.join("\n"));
  // elipse curta na mesma parte: ✅ sem nota
  const curta = ver(bruto, "A reincidência específica agrava [...] aplicada ao gestor omisso");
  assert.ok(curta.valido && !curta.notas.some((n) => n.startsWith("ELIPSE")), JSON.stringify(curta));
  // fim da ementa [...] "Vistos, relatados…" do ACÓRDÃO: vão curtíssimo, partes diferentes → 🟠
  const juncao = "agrava a sanção pecuniária aplicada ao gestor omisso [...] Vistos, relatados e discutidos estes autos";
  const rj = ver(bruto, juncao);
  assert.ok(!rj.valido && rj.distante && rj.tipo === "partes", JSON.stringify(rj));
  assert.ok(rj.motivo.includes("PARTES DIFERENTES") && rj.motivo.includes("ementa × acórdão/fecho"), rj.motivo);
  const lj = L.linhasVerificacaoItem({ idDecisao: 1, sigla: "APL-TC", numero: "00001/26" }, juncao, { [NOME]: bruto });
  assert.ok(lj[0].startsWith("🟠 CONFIRA (fragmentos em partes diferentes)") && !lj.some((l) => l.includes("✅")), lj.join("\n"));
  // ementa [...] item I do dispositivo: idem
  const rItem = ver(bruto, "agrava a sanção pecuniária aplicada ao gestor omisso [...] I - Multar o gestor em R$ 24.000,00");
  assert.ok(!rItem.valido && rItem.tipo === "partes", JSON.stringify(rItem));
});

test("rodada 2: mesma parte (ou parte desconhecida) com vão acima do teto continua 🟠; abaixo, ✅ com nota", () => {
  const corpo = (n) => "frase de enchimento sem estrutura nenhuma. ".repeat(n);
  const perto = "O gestor descumpriu a determinação expedida pela Corte. " + corpo(30) + "A multa foi fixada no patamar mínimo legal.";
  const r = L.verificarTrecho({ ementa: perto }, "O gestor descumpriu a determinação expedida [...] A multa foi fixada no patamar mínimo legal");
  assert.ok(r.valido && r.notas.some((n) => n.startsWith("ELIPSE LONGA: a ferramenta não localizou")), JSON.stringify(r));
  const longe = "O gestor descumpriu a determinação expedida pela Corte. " + corpo(100) + "A multa foi fixada no patamar mínimo legal.";
  const rl = L.verificarTrecho({ ementa: longe }, "O gestor descumpriu a determinação expedida [...] A multa foi fixada no patamar mínimo legal");
  assert.ok(!rl.valido && rl.distante && rl.tipo === "longe", JSON.stringify(rl));
  assert.ok(rl.motivo.includes(String(L.TETO_ELIPSE_MESMA_PARTE)), rl.motivo);
  const ll = L.linhasVerificacaoItem({ idDecisao: 1, sigla: "APL-TC", numero: "00001/26" }, "O gestor descumpriu a determinação expedida [...] A multa foi fixada no patamar mínimo legal", { ementa: longe });
  assert.ok(ll[0].startsWith("🟠 CONFIRA (fragmentos distantes)"), ll.join("\n"));
});

test("rodada 2: entre várias cadeias, vale a que fica numa parte só (frase repetida na ementa e no voto vencido)", () => {
  // o 1º fragmento existe na ementa E no voto vencido; o 2º só no voto vencido, logo depois: a junção é legítima dentro do voto vencido
  const bruto = acordao({ tituloVencido: ["CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"], vogal: ["CONSELHEIRO MARCELO NUNES PEREIRA", "Convirjo."] })
    .replace(VENCIDO_TXT, "O descumprimento reiterado de determinação desta Corte sujeita o gestor à multa. " + VENCIDO_TXT);
  const r = ver(bruto, "O descumprimento reiterado de determinação desta Corte sujeita o gestor [...] " + TRECHO_VENCIDO);
  assert.ok(r.valido, JSON.stringify(r));
  assert.ok(r.posicao.startsWith("VOTO de outro conselheiro (título: «CONSELHEIRO SUBSTITUTO GERVÁSIO"), r.posicao);
  assert.ok(temVencido(r), JSON.stringify(r.alertas));
});

test("rodada 2, PDFs públicos das fixtures: a elipse da ementa do 77649 volta a ✅; ementa [...] 'Vistos, relatados' do 98114 vira 🟠", async () => {
  const idx = await import("../server/index.js");
  const semRede = async () => { throw new Error("o teste da rodada 2 não pode tocar a rede"); };
  idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });
  const AQUI = path.dirname(new URL(import.meta.url).pathname);
  const texto = async (id) => (await idx.extrairTextoPdf(fs.readFileSync(path.join(AQUI, "fixtures", "pdf", `${id}.pdf`)))).texto;
  const t77649 = await texto(77649);
  // exemplo real do revisor: os dois fragmentos na ementa (p. ~1), vão de ~573 — a rodada 1 dava 🟠 "a junção NÃO é frase do acórdão"
  const r = L.verificarTrecho({ [NOME]: t77649 },
    "CONJUNTO ESTRATÉGICO DE FISCALIZAÇÕES DEFINIDAS PELO TRIBUNAL DE CONTAS POR MEIO DA [...] subsidiar as contas anuais do Poder Executivo Municipal");
  assert.ok(r.valido && !r.distante, JSON.stringify(r));
  assert.ok(r.posicao.startsWith("ementa") && r.notas.some((n) => n.startsWith("ELIPSE LONGA") && n.includes("(ementa)")), JSON.stringify(r));
  const t98114 = await texto(98114);
  const rj = L.verificarTrecho({ [NOME]: t98114 },
    "preservar a autoridade das decisões do Tribunal [...] Vistos, relatados e discutidos estes autos, que tratam de processo autuado");
  assert.ok(!rj.valido && rj.distante && rj.tipo === "partes", JSON.stringify(rj));
});
