// Red team 22/10/2026 — os dois achados de gravidade ALTA do TCE-RO:
//  1. voto vencido (título só "CONSELHEIRO NOME", sem a palavra VOTO) saía como "fundamentação do voto condutor", sem alerta;
//  2. `[...]` juntava ementa e voto vencido a dezenas de milhares de caracteres e devolvia ✅ VÁLIDO.
// 100% offline: texto sintético (nomes inventados) + o PDF público já usado nos outros testes (98114); estado e recibos em pasta temporária.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-rt221026-"));
process.env.TCERO_MCP_DIR_ESTADO = path.join(TMP, "estado");
process.env.TCERO_MCP_DIR_RECIBOS = path.join(TMP, "recibos");
process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";

const L = await import("../server/lib.js");
const V = await import("../server/v160.js");
const P = await import("../server/posicao2.js");
const idx = await import("../server/index.js");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const semRede = async () => { throw new Error("o teste do red team não pode tocar a rede"); };
idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });

const ENCHIMENTO = Array.from({ length: 14 }, (_, i) =>
  `${i + 2} - Determinar ao gestor que adote as providências de número ${i + 2}, informando a esta Corte no prazo regimental.`).join("\n");

// Acórdão SINTÉTICO no formato do TCE-RO (nomes inventados): relator vence; um conselheiro substituto fica vencido quanto à multa.
function acordao({ fecho, vogais = true, vencidoSemTitulo = false } = {}) {
  const vencido =
    "Convirjo com relator, com ressalva de entendimento. Peço vênia ao relator para divergir quanto ao montante, pois a multa " +
    "reduzida a um décimo do valor de alçada atende melhor a finalidade pedagógica da sanção aplicada ao gestor.";
  return [
    "PROCESSO: 01234/25",
    "ASSUNTO: Fiscalização de atos e contratos",
    "JURISDICIONADO: Município de Exemplópolis",
    "RELATOR: Conselheiro Alfredo Bernardes Costa",
    "SESSÃO: 3ª Sessão Ordinária",
    "",
    "",
    "",
    "EMENTA: FISCALIZAÇÃO DE ATOS. DESCUMPRIMENTO DE DETERMINAÇÃO. MULTA.",
    "O descumprimento reiterado de determinação desta Corte sujeita o gestor à multa do art. 55 da lei orgânica.",
    "ACÓRDÃO",
    "Vistos, relatados e discutidos estes autos, que tratam de fiscalização de atos, como tudo dos autos consta.",
    fecho ??
      "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
        "Relator, Conselheiro Alfredo Bernardes Costa, por maioria, vencido o Conselheiro Substituto Gervásio Hilário Lacerda " +
        "(substituição em vacância), quanto ao valor da multa; e por unanimidade quanto aos demais itens, em:",
    "I - Multar o gestor em R$ 24.000,00 pelo descumprimento de determinação.",
    ENCHIMENTO,
    "RELATÓRIO",
    "1. Trata-se de fiscalização instaurada para verificar o cumprimento de determinação anterior desta Corte de Contas.",
    "VOTO",
    "CONSELHEIRO ALFREDO BERNARDES COSTA",
    "2. A multa deve ser fixada em patamar suficiente para reprimir a conduta reiterada do gestor municipal omisso.",
    "3. O valor de alçada orienta a dosimetria, observadas as circunstâncias do art. 22 da LINDB e a reincidência.",
    ...(vencidoSemTitulo ? ["4. " + vencido] : []),
    "É como voto.",
    ...(vogais
      ? [
          "CONSELHEIRO MARCELO NUNES PEREIRA",
          "Convirjo com relator.",
          "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA (substituição em vacância)",
          vencido,
        ]
      : []),
    "Em 1º de outubro de 2026",
  ].join("\n");
}
const TRECHO_VENCIDO = "a multa reduzida a um décimo do valor de alçada atende melhor a finalidade pedagógica da sanção";
const TRECHO_RELATOR = "A multa deve ser fixada em patamar suficiente para reprimir a conduta reiterada do gestor municipal";
const NOME = "texto (recibo: ementa + dispositivo + PDF quando lido)";

test("achado 1: voto de vogal vencido com título 'CONSELHEIRO NOME' não sai como voto condutor; o fecho por maioria vira alerta", () => {
  const bruto = acordao();
  const r = L.verificarTrecho({ [NOME]: bruto }, TRECHO_VENCIDO);
  assert.ok(r.valido, JSON.stringify(r));
  assert.ok(r.posicao.startsWith("VOTO de outro conselheiro (título: «CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA"), r.posicao);
  assert.ok(!r.posicao.includes("fundamentação do voto condutor"), r.posicao);
  const venc = r.alertas.filter((a) => a.startsWith("VOTO VENCIDO:"));
  assert.equal(venc.length, 1, JSON.stringify(r.alertas));
  assert.ok(venc[0].includes("Gervásio Hilário Lacerda") && venc[0].includes("posição da minoria"), venc[0]);
  assert.deepEqual(r.notas, []);   // nunca VOZ DA CASA para voto vencido
  const linhas = L.linhasVerificacaoItem({ idDecisao: 1, sigla: "APL-TC", numero: "00001/26" }, TRECHO_VENCIDO, { [NOME]: bruto });
  assert.ok(linhas.some((l) => l.includes("⚠️") && l.includes("VOTO VENCIDO")), linhas.join("\n"));

  // o voto do relator continua sendo o condutor e, como o vencido tem voto com título, não há ressalva genérica
  const rRel = L.verificarTrecho({ [NOME]: bruto }, TRECHO_RELATOR);
  assert.ok(rRel.valido && rRel.posicao.startsWith("fundamentação do voto condutor"), JSON.stringify(rRel));
  assert.ok(!rRel.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") || a.startsWith("VOTO VENCIDO")), JSON.stringify(rRel.alertas));
  // vogal que só converge: voto de outro conselheiro, mas sem alerta de vencido (não está no rol do fecho)
  const rConv = L.verificarTrecho({ [NOME]: bruto }, "CONSELHEIRO MARCELO NUNES PEREIRA Convirjo com relator");
  assert.ok(rConv.valido && !rConv.alertas.some((a) => a.startsWith("VOTO VENCIDO")), JSON.stringify(rConv));

  // a segunda linha do título do próprio relator ("VOTO\nCONSELHEIRO FULANO") não abre voto de outro conselheiro
  assert.ok(!V.estruturaPdfTcero(bruto).some(([r, , t]) => r === "VOTO de outro conselheiro" && t.includes("ALFREDO")), JSON.stringify(V.estruturaPdfTcero(bruto)));
  const est = V.estruturaPdfTcero(bruto).filter(([r]) => r === "VOTO de outro conselheiro").map(([, , t]) => t);
  assert.deepEqual(est, ["CONSELHEIRO MARCELO NUNES PEREIRA", "CONSELHEIRO SUBSTITUTO GERVÁSIO HILÁRIO LACERDA (substituição em vacância)"]);
});

test("achado 1: maioria sem voto vencido separável → 'confira'; unanimidade → nada; relator vencido → 'confira'", () => {
  // o texto do vencido está colado no voto do relator, sem título: a ferramenta não separa → ressalva conservadora
  const semTitulo = acordao({ vogais: false, vencidoSemTitulo: true });
  const r = L.verificarTrecho({ [NOME]: semTitulo }, TRECHO_VENCIDO);
  assert.ok(r.valido && r.posicao.startsWith("fundamentação do voto condutor"), JSON.stringify(r));
  assert.ok(r.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") && a.includes("Gervásio Hilário Lacerda")), JSON.stringify(r.alertas));
  // unanimidade: nenhum alerta de maioria
  const unan = acordao({
    vogais: false,
    vencidoSemTitulo: true,
    fecho: "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, em consonância com o Voto do " +
      "Relator, Conselheiro Alfredo Bernardes Costa, por unanimidade, em:",
  });
  const rU = L.verificarTrecho({ [NOME]: unan }, TRECHO_RELATOR);
  assert.ok(rU.valido && !rU.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") || a.startsWith("VOTO VENCIDO")), JSON.stringify(rU.alertas));
  // relator vencido: "voto condutor" do relator não se sustenta → ressalva, mesmo com todos os votos titulados
  const relVenc = acordao({
    fecho: "ACORDAM os Senhores Conselheiros do Pleno do Tribunal de Contas do Estado de Rondônia, por maioria, vencido o Relator, " +
      "Conselheiro Alfredo Bernardes Costa, nos termos do voto do Conselheiro Marcelo Nunes Pereira, em:",
  });
  const rR = L.verificarTrecho({ [NOME]: relVenc }, TRECHO_RELATOR);
  assert.ok(rR.valido && rR.alertas.some((a) => a.startsWith("JULGAMENTO POR MAIORIA") && a.includes("RELATOR")), JSON.stringify(rR.alertas));
  // maioriaDoFecho lê os nomes, sem o parêntese
  const f = L.maioriaDoFecho(acordao());
  assert.ok(f.maioria && !f.relatorVencido, JSON.stringify(f));
  assert.deepEqual(f.vencidos, [["gervasio", "hilario", "lacerda"]]);
});

test("achado 1: o detector de divergência pega 'Peço vênia ao relator para divergir', ressalva de entendimento e 'Reformulo meu voto'", () => {
  for (const t of [
    "Peço vênia ao relator para divergir apenas quanto ao valor.",
    "Peço vênia ao eminente relator para divergir.",
    "Convirjo com relator, com ressalva de entendimento.",
    "Reformulo meu voto proferido anteriormente.",
    "peço vênia para divergir do relator.",
  ]) assert.equal(L.excertosRaw(t, L.RE_DIVERGENCIA_RAW).length, 1, t);
  assert.equal(L.excertosRaw("Convirjo com o relator.", L.RE_DIVERGENCIA_RAW).length, 0);
  const tri = V.alertasDeTriagem(acordao());
  assert.ok(tri.some(([r]) => r.startsWith("voto divergente")), JSON.stringify(tri));
});

test("achado 2: `[...]` entre partes distantes (ementa × voto vencido) não dá ✅; sai 🟠 CONFIRA com a posição de cada fragmento", () => {
  const bruto = acordao();
  const juncao = "O descumprimento reiterado de determinação desta Corte sujeita o gestor [...] " + TRECHO_VENCIDO;
  const r = L.verificarTrecho({ [NOME]: bruto }, juncao);
  assert.equal(r.valido, false, JSON.stringify(r));
  assert.equal(r.distante, true);
  assert.equal(r.fragmentos.length, 2);
  assert.ok(r.fragmentos[0].posicao.startsWith("ementa"), JSON.stringify(r.fragmentos));
  assert.ok(r.fragmentos[1].posicao.startsWith("VOTO de outro conselheiro"), JSON.stringify(r.fragmentos));
  const linhas = L.linhasVerificacaoItem({ idDecisao: 1, sigla: "APL-TC", numero: "00001/26" }, juncao, { [NOME]: bruto });
  assert.ok(linhas[0].startsWith("🟠 CONFIRA (fragmentos em partes diferentes)") && !linhas.some((l) => l.includes("✅")), linhas.join("\n"));
  assert.ok(linhas.some((l) => l.startsWith("   fragmento 1:")) && linhas.some((l) => l.startsWith("   fragmento 2:")), linhas.join("\n"));

  // elipse dentro da mesma passagem continua ✅
  const perto = L.verificarTrecho({ [NOME]: bruto }, "A multa deve ser fixada em patamar suficiente [...] observadas as circunstâncias do art. 22 da LINDB");
  assert.ok(perto.valido && !perto.distante, JSON.stringify(perto));
  // o 1º fragmento aparece longe E perto do 2º: vale o par mais próximo (✅), não o primeiro que casa
  const dup = "o valor de alçada orienta a dosimetria. " + "x ".repeat(2000) + "o valor de alçada orienta a dosimetria, observada a reincidência específica do gestor.";
  const rDup = L.verificarTrecho({ ementa: dup }, "o valor de alçada orienta a dosimetria [...] observada a reincidência específica do gestor");
  assert.ok(rDup.valido, JSON.stringify(rDup));
  // fragmento que falta continua ❌ (não vira 🟠)
  const falta = L.verificarTrecho({ [NOME]: bruto }, "A multa deve ser fixada em patamar suficiente [...] frase que não existe em parte alguma do acórdão");
  assert.ok(!falta.valido && !falta.distante && falta.faltando.length === 1, JSON.stringify(falta));
});

test("98114 (PDF público das fixtures), pelo recibo: voto vencido com alerta e `[...]` ementa × p. 23 sem ✅", async () => {
  const fx = (nome) => JSON.parse(fs.readFileSync(path.join(AQUI, "fixtures", nome), "utf-8"));
  const s = fx("03_busca_idDecisao.json").result.find((i) => i.source.idDecisao === 98114).source;
  const pdf = fs.readFileSync(path.join(AQUI, "fixtures", "pdf", "98114.pdf"));
  idx._setDepsParaTeste({
    consultarApi: async (p) => { if (String(p.IdDecisao) === "98114") return { result: [{ source: s }] }; throw new Error("sem rede"); },
    baixarPdf: async () => pdf,
  });
  idx._limparCachesParaTeste();
  try {
    await idx.obterAcordao(98114, null, null, true);
    idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });   // a verificação lê só o recibo
    const t1 = await idx.verificarCitacao("98114", null,
      "Assim entendo que 10% do valor, que é R$ 8.100,00, torna-se mais justo para efeito pedagógico, que constitui a principal finalidade da multa");
    assert.ok(t1.includes("✅ VÁLIDO") && t1.includes("VOTO VENCIDO") && t1.includes("OMAR PIRES DIAS"), t1);
    assert.ok(!t1.includes("fundamentação do voto condutor"), t1);
    const t2 = await idx.verificarCitacao("98114", null,
      "a redução da multa de R$ 24.300,00 para R$ 8.100,00, aplicável aos Prefeitos de Nova União-RO");
    assert.ok(t2.includes("VOTO VENCIDO") && t2.includes("FRANCISCO CARVALHO DA SILVA") && !t2.includes("fundamentação do voto condutor"), t2);
    const t3 = await idx.verificarCitacao("98114", null,
      "O descumprimento injustificado de determinação expedida pelo Tribunal de Contas [...] torna-se mais justo para efeito pedagógico, que constitui a principal finalidade da multa");
    assert.ok(t3.includes("🟠 CONFIRA (fragmentos em partes diferentes)") && !t3.includes("✅"), t3);
    assert.ok(t3.includes("fragmento 1:") && t3.includes("p. ~23 de 23"), t3);
  } finally {
    idx._setDepsParaTeste({ baixarPdf: semRede, consultarApi: semRede });
  }
});

test("linhasConselheiroTc: só linha inteira em caixa alta com nome; assinatura 'CONSELHEIRO SUBSTITUTO' sozinha não conta", () => {
  const t = "VOTO\nCONSELHEIRO JOSÉ DA SILVA\ntexto\nCONSELHEIRO SUBSTITUTO\nConselheiro Paulo Souza Lima\nCONSELHEIRO-SUBSTITUTO ANA MARIA ROCHA (em substituição\n";
  const l = P.linhasConselheiroTc(t);
  assert.deepEqual(l.map(([, n, c]) => [n, c]), [["JOSÉ DA SILVA", true], ["ANA MARIA ROCHA", false]]);
});
