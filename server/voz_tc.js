// voz_tc.js (1.7.7, não publicada) — porte para o TCE-RO das melhorias de "de quem é a frase" do TJRO 1.41.9 (server/voz.js e
// server/verificar.js de lá), adaptadas ao vocabulário do Tribunal de Contas. Funções puras sobre norm1 (1:1 com o bruto), sem rede.
// O que entrou:
//  - selo de voz com evidência (guardas da "voz da casa": cabeçalho/autuação/página antes do trecho na ementa do cadastro; título de
//    RELATÓRIO/VOTO ou fala do relator entre o ACORDAM e o trecho no fecho);
//  - ALEGAÇÃO DA PARTE estrutural com os sujeitos do TCE (jurisdicionado, responsável, defendente, justificante, gestor…);
//  - DOUTRINA / DECISÃO TRANSCRITA / PARECER TRANSCRITO / DEFESA TRANSCRITA anunciadas por dois-pontos;
//  - OBITER DICTUM? por concessiva negativa ("ainda que não…, …");
//  - FRAGMENTOS CURTOS: piso por tamanho de fragmento para a costura com [...] (o corpus local de recibos é pequeno demais para
//    uma tabela de raridade como a do TJRO, calculada sobre 6.555 recibos);
//  - grafias de relator vencido que o fecho não lia.
import { norm1, inicioDaFrase } from "./atribuicao13.js";

// ------------------------------------------------------------------ guardas da voz da casa ---
// Ementa do cadastro: o recibo é ementa + "\n\n" + dispositivo do cadastro + "\n\n" + PDF, e a posição chama de "ementa do cadastro"
// tudo o que vem antes do 1º cabeçalho de página reconhecido. Na cópia dos recibos, em 3 de 36 o dispositivo do cadastro é a CERTIDÃO
// DE JULGAMENTO (órgão, sessão, "Responsáveis: Fulano – CPF…"), e o PDF da 1ª página também cai ali quando o cabeçalho dela não é
// reconhecido. Autuação, título de peça ou cabeçalho de página ANTES do trecho = já não é a ementa: a voz não é confirmada.
const RE_GUARDA_CADASTRO = /(?:^|\n)[ \t]*(?:PROCESSO|PROC\.|RESPONS[ÁA]VE|ASSUNTO|INTERESSAD|JURISDICIONAD|RELATOR|SESS[ÃA]O|[ÓO]RG[ÃA]O JULGADOR|ADVOGAD|UNIDADE|EXERC[ÍI]CIO|CERTID[ÃA]O|RELAT[ÓO]RIO|VOTO|PROPOSTA DE DECIS[ÃA]O|FUNDAMENTA[ÇC][ÃA]O|AC[ÓO]RD[ÃA]O\b|EMENTA\b|TRIBUNAL DE CONTAS DO ESTADO)/i;
// Fecho: entre o ACORDAM e o trecho, um título de RELATÓRIO/VOTO/PROPOSTA em linha própria, ou a fala do relator, quer dizer que o
// "fecho" lido pela posição avançou para dentro do corpo (formato fora do padrão).
const RE_GUARDA_FECHO_TIT = /\n[ \t]*(?:[IVX]{1,4}[ \t]*[–.-]+[ \t]*)?(?:RELAT[ÓO]RIO|VOTO|PROPOSTA DE DECIS[ÃA]O|FUNDAMENTA[ÇC][ÃA]O|FUNDAMENTOS)\b/;
const RE_GUARDA_FECHO_FALA = /(?<![a-z0-9])(?:e o (?:breve )?relatorio|e o que basta relatar|e o necessario a relatar|feito o breve relato|breve relato|pois bem|passo ao (?:exame|merito|julgamento)|proponho|submeto|e como voto|passo a (?:analisar|examinar|decidir|apreciar)|decido)(?![a-z0-9])/;

/** A "voz da casa" do trecho que começa em `ini` (bruto/norm1) é contestada por alguma guarda? `posicao` é o rótulo de posição;
 * `campo` = nome do texto conferido (no portal, "ementa"/"dispositivo (acordaoDescricao)"). Devolve o motivo ou "". */
// Medição cega + reataque Fable (25/10/2026): certidão de julgamento no fecho ("Participaram do julgamento…", "Porto Velho, 10 de abril de
// 2026", assinatura), qualificação de parte/advogado (CPF, OAB, "na qualidade de"), autuação ("Sessão Ordinária Virtual") e cabeçalho de página
// DENTRO do trecho (não só no meio) não são a palavra do colegiado: 29 de 36 recibos tinham certidão que saía "✅ VÁLIDO" pleno.
const RE_CERTIDAO_TC = /(?<![a-z0-9])(?:participaram do julgamento|porto velho,? *(?:\d|em )|assinad[oa] eletronicamente|documento assinado|conselheiro[- ]presidente|presidente (?:da|do) (?:\d.? ?)?(?:camara|tribunal|pleno)|procurador(?:a)?(?: do ministerio publico de contas)?|ministerio publico de contas,? representado)(?![a-z0-9])/;
const RE_QUALIFICACAO_TC = /(?<![a-z0-9])(?:cpf|cnpj|oab ?\/ ?[a-z]{2}|advogad[oa]s?|na qualidade de|sessao (?:ordinaria|extraordinaria) virtual|responsaveis?: )(?![a-z0-9])/;
const RE_CABECALHO_PAGINA_TC = /tribunal de contas do estado de rondonia|secretaria de processamento e julgamento|secretaria de processamento|av\.? presidente dutra|bairro: ?[a-z ]*cep|cep: ?\d{5}/;
export function guardaVozDaCasa(bruto, tn, ini, posicao, campo = "", fim = ini) {
  const p = posicao || "";
  const c = norm1(campo || "");
  const trechoTn = tn.slice(ini, Math.max(ini, fim));
  if (RE_QUALIFICACAO_TC.test(trechoTn)) return "o trecho qualifica parte, advogado ou sessão (CPF, OAB, \"na qualidade de\", autuação) — é identificação, não a palavra do colegiado";
  if (RE_CABECALHO_PAGINA_TC.test(trechoTn)) return "o trecho atravessa o cabeçalho de página do PDF — não é a palavra do colegiado";
  if (RE_CERTIDAO_TC.test(trechoTn)) return "o trecho é certidão de julgamento, composição ou assinatura — registro da sessão, não a palavra do colegiado";
  if (p.startsWith("acórdão/fecho")) {
    const ac0 = tn.lastIndexOf("acordam", ini);
    if (ac0 >= 0 && RE_CERTIDAO_TC.test(tn.slice(ac0, ini))) return "entre o ACORDAM e o trecho há certidão de julgamento (composição, data ou assinatura) — o trecho já é registro da sessão";
  }
  if (p.startsWith("ementa do cadastro") || (!p && c.startsWith("ementa"))) {
    const m = RE_GUARDA_CADASTRO.exec(bruto.slice(0, ini));
    if (m) return `antes do trecho há «${m[0].trim().slice(0, 40)}» — o trecho já não está na ementa do cadastro (certidão, autuação ou 1ª página do PDF)`;
    return "";
  }
  if (p.startsWith("acórdão/fecho")) {
    const ac = tn.lastIndexOf("acordam", ini);
    if (ac < 0) return "o ACORDAM do fecho não foi localizado antes do trecho";
    const entre = bruto.slice(ac, ini);
    const t = RE_GUARDA_FECHO_TIT.exec(entre);
    if (t) return `entre o ACORDAM e o trecho há o título «${t[0].trim()}» — o trecho pode estar no corpo, não no fecho`;
    const f = RE_GUARDA_FECHO_FALA.exec(tn.slice(ac, ini));
    if (f) return `entre o ACORDAM e o trecho há «${f[0]}», fala do relator — o trecho pode estar no voto, não no fecho`;
    return "";
  }
  if (c.startsWith("dispositivo")) {
    const t = RE_GUARDA_FECHO_TIT.exec("\n" + bruto.slice(0, ini));
    if (t) return `antes do trecho há o título «${t[0].trim()}»`;
  }
  return "";
}

/** Posição em que a frase NÃO é voz do órgão (narração/relato/cabeçalho). */
export const naoEVozDoOrgao = (posicao) => /^(?:RELAT[ÓO]RIO|cabeçalho)/.test(posicao || "");

// ------------------------------------------------------------------ ALEGAÇÃO DA PARTE (sujeitos do TCE) ---
// A regra antiga (lib.js, RE_ALEGACAO_PARTE) olha só o verbo nos 200 caracteres anteriores e não tem "afirma", "assevera", "pugna",
// "requer", "justifica". Aqui: verbo de relato conjugado com SUJEITO do processo de contas (jurisdicionado, responsável, defendente…)
// na mesma frase, antes do trecho, sem marca de voz do relator entre o verbo e o trecho.
const RE_SUJEITO_TC = /(?<![a-z0-9])(?:jurisdicionad[oa]s?|responsave(?:l|is)|defendentes?|justificantes?|gestor(?:a|es|as)?|interessad[oa]s?|recorrentes?|embargantes?|requerentes?|representantes?|denunciantes?|peticionantes?|ex-prefeit[oa]|prefeit[oa]|secretari[oa]|a defesa|as? defesas?|o advogado|os? patronos?|em (?:suas|sua) (?:razoes|justificativas?|defesas?|manifestac(?:ao|oes))|nas razoes(?: recursais)?)(?![a-z0-9])/;
const RE_VERBO_TC = /(?<![a-z0-9])(?:alega(?:m|ram|ndo)?|alegou|sustent(?:a|am|ou|aram|ando)|aduz(?:em|iu|iram|indo)?|argument(?:a|am|ou|aram|ando)|afirma(?:m|ram|ndo)?|afirmou|assever(?:a|am|ou|aram|ando)|pugn(?:a|am|ou|aram|ando)|requer(?:em|eu|eram|endo)?|pleite(?:ia|iam|ou|aram|ando)|argui(?:u|ram|ndo)?|arguem|justific(?:a|am|ou|aram|ando)|defende(?:m|u|ram|ndo)?|insist(?:e|em|iu|indo)|postul(?:a|am|ou)|reiter(?:a|am|ou))(?![a-z0-9])/g;
const RE_VOZ_RELATOR_TC = /(?<![a-z0-9])(?:contudo|todavia|entretanto|no entanto|ocorre que|porem|com efeito|sem razao|nao assiste|nao merece|nao prospera|verifico|observo|constato|entendo|tenho que|ante o exposto|diante do exposto|pelo exposto|dessa forma|desta forma|assim,|portanto|no caso|in casu|corpo tecnico|unidade tecnica|ministerio publico de contas|ao contrario|por mim|reputei|reputo|deferi|indeferi|concedi|acolhi)(?![a-z0-9])/;
/** O trecho [ini0, fim) (norm1) é o relato do que a parte/defesa diz? */
export function alegacaoTc(tn, ini0, fim, bruto) {
  const cabeca = ini0 + Math.trunc((fim - ini0) * 0.4);
  const frase0 = inicioDaFrase(bruto, tn, Math.max(0, ini0 - 500), cabeca);
  const frase = tn.slice(frase0, cabeca);
  let ok = false;
  for (const m of frase.matchAll(RE_VERBO_TC)) {
    const pos = frase0 + m.index, fimV = pos + m[0].length;
    if (tn.slice(fimV, fimV + 3) === "-se") continue;                                       // "alega-se", "requer-se"
    if (/(?:^|[^a-z0-9])(?:nao|nem|jamais)\s+(?:se\s+)?$/.test(tn.slice(Math.max(frase0, pos - 12), pos))) continue;
    if (/(?:ao contrario|diferentemente|diversamente)\s+(?:do|ao)\s+que\s+(?:[a-z]+\s+){0,2}$/.test(tn.slice(Math.max(frase0, pos - 40), pos))) continue;
    const antes = tn.slice(Math.max(frase0, pos - 160), pos), depois = tn.slice(fimV, fimV + 50).split(/[,.;]| que /)[0];
    if (!RE_SUJEITO_TC.test(antes) && !RE_SUJEITO_TC.test(depois)) continue;
    if (fimV > ini0 + 3) continue;                                                           // o verbo está no próprio trecho: quem cita vê
    ok = !RE_VOZ_RELATOR_TC.test(tn.slice(fimV, Math.max(fimV, ini0))) &&
      !/(?<![a-z0-9])(?:por mim|reputei|reputo|deferi|indeferi|concedi|acolhi)(?![a-z0-9])/.test(tn.slice(fimV, fim));   // 1ª pessoa do relator no trecho
  }
  return ok;
}

// ------------------------------------------------------------------ texto anunciado por dois-pontos ---
// "Como leciona Marçal Justen Filho:", "Transcrevo trecho da Decisão Monocrática n. …:", "O Ministério Público de Contas opinou nos
// seguintes termos:", "A defesa apresentou as seguintes justificativas:". O bloco começa nos dois-pontos e vai até a 1ª marca de
// retomada do relator, a referência da obra entre parênteses, um título de peça ou INTRODUZIDA_MAX caracteres.
const RE_INTRO_DOUTRINA = /(?<![a-z0-9])(?:lecion(?:a|am|ou)|prelecion(?:a|am|ou)|ensin(?:a|am|ou)|ensinamentos?|licao|licoes|magisterio|escolio|nas\s+palavras\s+d[eoa]s?|na\s+visao\s+d[eoa]s?|pontifica|doutrinador[a]?|doutrina\s+(?:de|do|da|que)|jurista|professor[a]?|prof\.|autor[a]?\s+citad[oa])(?![a-z0-9])(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,140}:/g;
const RE_INTRO_DECISAO = /(?<![a-z0-9])(?:(?:trecho|trechos|excerto|parte|fundamentos?|fundamentacao|dispositivo|teor)\s+(?:d[ao]s?\s+)?(?:r\.?\s*|douta\s+|respeitavel\s+)?(?:decisao\s+(?:monocratica|recorrida|combatida|embargada|agravada|de origem|singular)|dm\b|acordao\s+(?:recorrido|combatido|embargado|vergastado|guerreado|impugnado))|(?:a|da|na|pela)\s+(?:decisao\s+(?:monocratica|recorrida|combatida|embargada)|acordao\s+(?:recorrido|combatido|embargado|vergastado))(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,60}(?<![a-z0-9])(?:consignou|assentou|registrou|asseverou|destacou|fundamentou|dispos|decidiu|pontuou|esclareceu|restou assim|nos seguintes (?:moldes|termos)|in verbis|verbis))(?![a-z0-9])(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,140}:/g;
const RE_INTRO_PARECER = /(?<![a-z0-9])(?:(?:o|a|do|da|no|na)\s+(?:ministerio publico de contas|mpc|parquet de contas|procurador(?:a)?(?:-geral)?(?: de contas)?|corpo tecnico|unidade tecnica|equipe tecnica|secretaria geral de controle externo|sgce|coordenadoria)(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,120}(?<![a-z0-9])(?:opinou|manifestou|concluiu|assim se pronunciou|se pronunciou|asseverou|registrou|pontuou|consignou|propos|destacou|nos seguintes termos|in verbis|verbis)|(?:parecer|relatorio tecnico|relatorio de (?:auditoria|instrucao|analise))\s+(?:n\.?\s*[\d./]+\s*)?(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,100}(?<![a-z0-9])(?:in verbis|verbis|nos seguintes termos|assim (?:dispos|concluiu|se manifestou)|transcrevo|colaciono))(?![a-z0-9])(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,140}:/g;
const RE_INTRO_DEFESA = /(?<![a-z0-9])(?:(?:a|da|na)\s+defesa|(?:o|do)\s+(?:jurisdicionado|responsavel|defendente|justificante|gestor|recorrente|embargante)|(?:as|nas|suas)\s+(?:justificativas|razoes(?: recursais)?|alegacoes de defesa))(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,120}(?<![a-z0-9])(?:alegou|aduziu|sustentou|argumentou|justificou|asseverou|afirmou|defendeu|apresentou (?:as|os) seguintes|assim se manifestou)(?![a-z0-9])(?:[^.:;']|(?<=(?:^|[^a-z])(?:n|no|nos|art|arts|fl|fls|lc|lce|res|in|cf|inc|p))\.|\.(?=\s?\d)){0,140}:/g;
const RE_FIM_INTRODUZIDA = /(?<![a-z0-9])(?:pois bem|como se ve|como visto|portanto|destarte|desse modo|dessa forma|desta forma|logo,|assim,|verifica-se|constata-se|nota-se|ve-se|infere-se|depreende-se|e o relatorio|e como voto|ante o exposto|diante do exposto|pelo exposto|proponho|submeto|decido|entendo|com efeito|nesse sentido|neste sentido|no caso dos autos|in casu|jurisprudencia|sumula|precedentes?)(?![a-z0-9])|'/g;
const RE_REF_OBRA = /\([^()]{0,240}?(?:(?<![0-9])(?:19|20)\d\d(?![0-9])|(?<![a-z0-9])p\.\s*\d|(?<![a-z0-9])in(?![a-z0-9])|ed\.)[^()]{0,120}\)/g;
export const INTRODUZIDA_MAX = 2500, INTRODUZIDA_MIN = 60;
const LETRA = /[A-Za-zÀ-ÿ0-9]/;
function recuarAteFronteira(bruto, de, teto) {
  if (teto >= bruto.length || !LETRA.test(bruto[teto] || "") || !LETRA.test(bruto[teto - 1] || "")) return teto;
  let k = teto;
  while (k > de && LETRA.test(bruto[k - 1])) k--;
  while (k > de && /\s/.test(bruto[k - 1])) k--;
  return k > de ? k : teto;
}
/** Faixas [ini, fim, tipo] anunciadas por dois-pontos, sem aspas: "DOUTRINA" | "DECISÃO TRANSCRITA" | "PARECER TRANSCRITO" | "DEFESA TRANSCRITA". */
export function faixasIntroduzidasTc(tn, bruto) {
  const achados = [];
  for (const [re, tipo] of [[RE_INTRO_DECISAO, "DECISÃO TRANSCRITA"], [RE_INTRO_PARECER, "PARECER TRANSCRITO"], [RE_INTRO_DEFESA, "DEFESA TRANSCRITA"], [RE_INTRO_DOUTRINA, "DOUTRINA"]]) {
    for (const m of tn.matchAll(new RegExp(re.source, "g"))) {
      if (/passa\w* a (?:vigorar|ter)|seguinte redacao|leia-se|onde se le/.test(m[0])) continue;
      // a defesa "analisada pela Unidade Técnica" ou "sujeita à multa do art. 55, in verbis" anuncia a análise técnica ou a lei, não a defesa
      if (tipo === "DEFESA TRANSCRITA" && /(?<![a-z0-9])(?:unidade tecnica|corpo tecnico|equipe tecnica|sgce|ministerio publico|art|arts|lei|lc|lce|codigo|regimento)(?![a-z0-9])/.test(m[0])) continue;
      // rótulo de autuação ("…Aposentadoria Especial de Professor\nJURISDICIONADO:"): os dois-pontos fecham um RÓTULO, não anunciam texto
      if (/[A-ZÀ-Ý]{4,}[ \t]*:$/.test(bruto.slice(m.index, m.index + m[0].length))) continue;
      achados.push([m.index + m[0].length, tipo]);
    }
  }
  achados.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [ini, tipo] of achados) {
    if (out.length && ini < out[out.length - 1][1]) continue;
    const abre = bruto.slice(ini, ini + 8).replace(/^\s+/, "");
    if (!/^[A-ZÀ-Ý]/.test(abre)) continue;                      // abre com aspas (ENTRE ASPAS cuida), lista ou número: fora
    let fimB = Math.min(bruto.length, ini + INTRODUZIDA_MAX);
    if (fimB === ini + INTRODUZIDA_MAX) fimB = recuarAteFronteira(bruto, ini, fimB);
    const rf0 = new RegExp(RE_FIM_INTRODUZIDA.source, "g"); rf0.lastIndex = ini;
    const mf0 = rf0.exec(tn);
    if (mf0 && mf0.index < ini + 40) continue;                 // o relator resumindo, não transcrevendo
    const inicioFrase = (p) => { let r = -1; for (const m of bruto.slice(ini, p + 1).matchAll(/[.;\])][\s"”']+(?=[A-ZÀ-Ý])/g)) if (!/(?:^|[^a-z])(?:art|arts|n|fl|fls|p|pag|inc|cons|min|rel|dr|dra)$/i.test(bruto.slice(Math.max(ini, ini + m.index - 5), ini + m.index))) r = ini + m.index + 1; return r > ini ? r : p; };
    const rf = new RegExp(RE_FIM_INTRODUZIDA.source, "g"); rf.lastIndex = ini + 40;
    const mf = rf.exec(tn);
    if (mf && mf.index < fimB) fimB = inicioFrase(mf.index);
    const rg = /\((?:sem )?(?:grifos?|destaques?|negritos?)[^()]{0,40}\)|\(grifou-se\)|\(grifo nosso\)/gi; rg.lastIndex = ini;
    const mg = rg.exec(bruto);
    if (mg && mg.index < fimB) fimB = mg.index + mg[0].length;
    const ro = new RegExp(RE_REF_OBRA.source, "g"); ro.lastIndex = ini;
    const mo = ro.exec(tn);
    if (mo && mo.index < fimB) fimB = mo.index + mo[0].length;
    const cab = bruto.slice(ini, fimB).search(/\n[ \t]*(?:[IVX]{1,4}[ \t]*[–.-]+[ \t]*)?(?:VOTO|EMENTA|AC[ÓO]RD[ÃA]O|RELAT[ÓO]RIO|DISPOSITIVO|FUNDAMENTA[ÇC][ÃA]O)\b/);
    if (cab >= 0) fimB = ini + cab;
    if (fimB - ini >= INTRODUZIDA_MIN) out.push([ini, fimB, tipo]);
  }
  return out;
}

// ------------------------------------------------------------------ concessiva negativa (espelho do TJRO 1.41.9) ---
// "Ainda que não haja dano ao erário, a conduta configura…": a Corte ADMITE o ponto e decide apesar dele. O conteúdo da concessiva
// citado sozinho parece apoiar o resultado oposto. Só a concessiva NEGATIVA; o "." de abreviatura (art., n., fls.) ou de número
// (1.000) não fecha a frase; a pós-posta ("…, ainda que não haja…", também depois de "e"/"ou"/"nem") termina no ponto.
const RE_CONCESSIVA_NEG = /(?<![a-z0-9])(ainda que|embora|mesmo que|conquanto|em que pese|nao obstante|apesar de|a despeito de|se bem que)\s+((?:[a-z-]+\s+){0,2}?)(?:nao|nem|jamais|nunca)(?![a-z0-9])/g;
const CONCESSIVA_MAX = 260;
export function concessivaNegativa(tn, ini0, fim) {
  const r = new RegExp(RE_CONCESSIVA_NEG.source, "g");
  r.lastIndex = Math.max(0, ini0 - CONCESSIVA_MAX);
  for (let m; (m = r.exec(tn)) && m.index < ini0;) {
    if (/(?:ad|id)[oa]s?\s/.test(m[2])) continue;
    if (m[1] === "ainda que" && !/(?:^|[,;:.(\[—–-]|(?<![a-z0-9])(?:e|mas|que|pois|porque|ou|porem|todavia|contudo|entretanto|mesmo|assim|portanto|logo))\s*$/.test(tn.slice(Math.max(0, m.index - 30), m.index))) continue;
    const naoIni = m.index + m[0].length - m[0].split(/\s+/).pop().length;
    const resto = tn.slice(naoIni, naoIni + CONCESSIVA_MAX);
    const posposta = /(?:,|(?<![a-z0-9])(?:e|ou|nem))\s*$/.test(tn.slice(Math.max(0, m.index - 4), m.index)) && /[a-z]{3,}[^.;:!?]*[,\s]$/.test(tn.slice(Math.max(0, m.index - 200), m.index).split(/[.;:!?]\s/).pop());
    const ps = [...resto.matchAll(/[,.;:!?]/g)].filter((x) => !(x[0] === "." && (/\d$/.test(resto.slice(0, x.index)) && /^\d/.test(resto.slice(x.index + 1)) || /(?:^|[^a-z])(?:pag|pags|art|arts|fl|fls|n|no|inc|par|p|v|ss|cf|dr|dra|sr|sra|cons|min|exmo|exma|ob|op|cit|ex|etc|rel|lc|lce|res|in)$/.test(resto.slice(0, x.index))))).map((x) => x.index);
    if (!ps.length) continue;
    let v = -1;
    if (resto[ps[0]] === ",") {
      v = ps[0];
      const seg = ps.length > 2 && resto[ps[1]] === "," ? resto.slice(ps[0] + 1, ps[1]).trim() : "";
      const nPal = seg ? seg.split(/\s+/).length : 0;
      if (nPal >= 1 && nPal <= 4 && resto[ps[2]] === ",") v = ps[2];
    } else if (posposta && /[.;!?]/.test(resto[ps[0]])) v = ps[0];
    if (v < 0) continue;
    const a = m.index, b = naoIni + v;
    if (ini0 < m.index + m[1].length) continue;
    const dentro = Math.max(0, Math.min(fim, b) - Math.max(ini0, naoIni));
    if (dentro * 2 > fim - ini0) {
      if (resto[v] !== ",") { const pi = Math.max(0, m.index - 120); return { marca: m[0], a, b, posposta: true, pi, pf: m.index }; }
      return { marca: m[0], a, b, posposta: false, pi: b + 1, pf: b + 121 };
    }
  }
  return null;
}

// ------------------------------------------------------------------ costura de fragmentos curtos ---
// No TJRO a medida é a raridade (bits) calculada sobre 6.555 recibos. Aqui a cópia local tem 36 recibos: tabela de frequência com
// N = 36 não separa palavra comum de rara. Fica o piso por tamanho (os mesmos limiares do TJRO, sem os bits) e a palavra vazia:
//  - fragmento de 1 palavra, ou só de palavras vazias ("é que a", "de que");
//  - nenhum fragmento com 3+ palavras;
//  - 3+ fragmentos e nenhum com 5+ palavras.
// (O piso de 15 caracteres por fragmento, já existente, continua barrando "a cobrança [...] é [...] devida".)
const VAZIAS = new Set("a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre e ou nem mas que se ao aos a as e ja nao sim mais menos muito pouco ha foi era sao ser sera seja esta este esse essa isso isto aquele aquela tal como quando onde qual quais cujo cuja ele ela eles elas lhe lhes seu sua seus suas nosso nossa me te nos vos tambem so apenas ainda".split(" "));
export const FRAGMENTO_LONGO_PALAVRAS = 3, FRAGMENTO_LONGO_3MAIS = 5;
/** `frags`: lista de listas de palavras (normalizadas). → lista de motivos ou null. */
export function costuraCurtaTc(frags) {
  if (frags.length < 2) return null;
  const motivos = [];
  const curtos = frags.filter((ws) => ws.length < 2 || ws.every((w) => VAZIAS.has(w)));
  if (curtos.length) motivos.push(`fragmento(s) de 1 palavra ou só de palavras vazias: ${curtos.map((ws) => `«${ws.join(" ")}»`).join(", ")}`);
  if (!frags.some((ws) => ws.length >= FRAGMENTO_LONGO_PALAVRAS)) motivos.push(`nenhum fragmento com ${FRAGMENTO_LONGO_PALAVRAS}+ palavras`);
  if (frags.length >= 3 && !frags.some((ws) => ws.length >= FRAGMENTO_LONGO_3MAIS)) motivos.push(`${frags.length} fragmentos e nenhum com ${FRAGMENTO_LONGO_3MAIS}+ palavras`);
  return motivos.length ? motivos : null;
}

// ------------------------------------------------------------------ hífen de quebra, hífen invisível, milhar ---
// Na comparação do TCE-RO o hífen já vira espaço dos dois lados ("Trata- se" = "Trata-se"). O que faltava: "contrato" contra
// "con-\ntrato" (quebra de sílaba do PDF) ou "con\u00adtrato" (hífen invisível), e "1000" contra "1.000". A 2ª tentativa (só quando a
// 1ª não acha) junta a quebra e tira o ponto de milhar nos dois lados; números e negadores continuam exatos.
const RE_MILHAR = /(?<![\dA-Za-zÀ-ÿ.,])\d{1,3}(?:\.\d{3})+(?!\d|[.,]?[A-Za-zÀ-ÿ]|[.]\d)/g;
export function relaxarTexto(s) {
  return String(s || "").replace(/\u00ad/g, "").replace(/([a-zà-ÿ])-[ \t]*\r?\n[ \t]*([a-zà-ÿ])/g, "$1$2").replace(RE_MILHAR, (m) => m.replace(/\./g, ""));
}
export function relaxarTrecho(s) {
  return String(s || "").replace(/\u00ad/g, "").replace(/([a-zà-ÿ])-\s+([a-zà-ÿ])/g, "$1$2").replace(RE_MILHAR, (m) => m.replace(/\./g, ""));
}
export const precisaRelaxar = (texto, trecho) => /\u00ad/.test(texto) || /\u00ad/.test(trecho) || /[a-zà-ÿ]-[ \t]*\r?\n[ \t]*[a-zà-ÿ]/.test(texto) || /[a-zà-ÿ]-\s+[a-zà-ÿ]/.test(trecho) || /\d{4}/.test(trecho) || new RegExp(RE_MILHAR.source).test(texto);
// metade final de palavra partida depois de PREFIXO NEGATIVO ("im- procedente", "não-incidência"): "procedente" não casa ali.
/** Conjunto das palavras (normalizadas) que, no texto, aparecem como metade depois de prefixo negativo partido por hífen. */
export function metadesNegativas(tn) {
  const s = new Set();
  for (const m of tn.matchAll(/(?<![a-z0-9])(?:(?:in|im|i|ir|des|dis|nao)-\s+|nao-)([a-z0-9]+)/g)) s.add(m[1]);
  return s;
}

// ------------------------------------------------------------------ relator vencido, mais grafias ---
// "Relator vencido", "relator(a) vencido(a)" (pós-posto) e "vencido o voto do relator" / "vencido o e. relator".
export const RE_RELATOR_VENCIDO_POS = /(?<![a-z0-9])(?<!voto d[oa] )(?<!voto do e\. )(?<!voto do ilustre )(?<!voto do eminente )relator(?:a)?(?:\s*\(\s*a\s*\))?,?\s+vencid[oa](?:\s*\(\s*a\s*\))?(?![a-z0-9])(?!\s+(?:em parte|parcialmente))/;
export const RE_VOTO_RELATOR_VENCIDO = /(?<![a-z0-9])vencid[oa]s?\s+o\s+voto\s+d[oa]\s+(?:(?:e\.|eminente|ilustre)\s+)?(?:conselheir[oa]\s+)?relator(?:a)?(?![a-z0-9])/;
