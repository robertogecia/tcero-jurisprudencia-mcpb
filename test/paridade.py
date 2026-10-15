#!/usr/bin/env python3
"""Paridade Node x Python -- servidor TCE-RO, sobre fixtures reais, ZERO REDE.

    ~/MCP/tcero-jurisprudencia/.venv/bin/python test/paridade.py

Carrega o Python congelado em `/tmp/servidor_tcero_v121.py` (commit e7d8592, v1.2.0 + red team
22/09/2026-b — gerado com `git show e7d8592:servidor_tcero.py > /tmp/servidor_tcero_v121.py`; se
o arquivo não existir, regenera sozinho a partir do commit) como módulo, com `_consultar_api` e
`_baixar_pdf` mockados
com as fixtures reais em `fixtures/` (zero rede). Chama as funções puras da ferramenta
(`_buscar`/`_obter_acordao`/`_verificar_citacao`) — as mesmas que o Node expõe via
`_setDepsParaTeste` em `server/index.js` — com os MESMOS argumentos dos dois lados, e compara a
saída byte a byte. O recibo de custódia gravado em disco (JSON + os dois hashes) também é
comparado.

Onde a extração de PDF (PyMuPDF × pdfjs-dist) diverge em espaçamento/quebra de linha, a
comparação da SEÇÃO do PDF é feita depois de normalizar espaço em branco dos dois lados (mesma
normalização que `_verificar_trecho`/`normalizarCasamento` já aplicam para decidir uma citação) —
e o relatório diz o tamanho da diferença bruta antes de normalizar.
"""
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(AQUI, "fixtures")
LIB_JS = os.path.join(os.path.dirname(AQUI), "server", "lib.js")
INDEX_JS = os.path.join(os.path.dirname(AQUI), "server", "index.js")
# 06/10/2026 (v1.3.0): Python e Node mudaram juntos (regras do TJRO); a paridade passa a ser contra o servidor ATUAL.
# Para comparar com o congelado de setembro: TCERO_PY_SOURCE=/tmp/servidor_tcero_v121.py
PY_SOURCE = os.environ.get("TCERO_PY_SOURCE") or os.path.expanduser("~/MCP/tcero-jurisprudencia/servidor_tcero.py")


def _garantir_fonte_python():
    if os.path.isfile(PY_SOURCE):
        return
    repo = os.path.expanduser("~/MCP/tcero-jurisprudencia")
    saida = subprocess.run(["git", "show", "e7d8592:servidor_tcero.py"], cwd=repo,
                            capture_output=True, text=True)
    if saida.returncode:
        sys.exit("não foi possível extrair e7d8592:servidor_tcero.py — " + saida.stderr)
    with open(PY_SOURCE, "w", encoding="utf-8") as f:
        f.write(saida.stdout)


def _ler_fixture(nome):
    with open(os.path.join(FIXTURES, nome), encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
# Mock de rede — mesmo mapa dos dois lados (chave = o filtro que distingue a   #
# consulta; o resultado é sempre o array `result` completo da fixture real —  #
# ordenar/detalhar/grupos são pós-processamento no cliente sobre esse mesmo    #
# array, então reusar a fixture independente desses parâmetros reflete o      #
# comportamento real).                                                        #
# --------------------------------------------------------------------------- #
FIX_PROCESSO = _ler_fixture("01_busca_numeroProcesso.json")
FIX_ACORDAO = _ler_fixture("02_busca_numeroAcordao.json")
FIX_ID = _ler_fixture("03_busca_idDecisao.json")

PDF_98114 = os.path.join(FIXTURES, "pdf", "98114.pdf")


def _rotear_mock(params):
    if params.get("numeroProcesso") == "02603/22":
        return FIX_PROCESSO
    if params.get("numeroAcordao") == "00055/26":
        return FIX_ACORDAO
    if params.get("IdDecisao") == "98114":
        return FIX_ID
    raise AssertionError(f"mock sem rota para params={params!r}")


# --------------------------------------------------------------------------- #
# Casos — mesmos argumentos nos dois lados, na mesma ordem.                    #
# --------------------------------------------------------------------------- #
CASOS_BUSCA = [
    # (nome, texto_livre, numero_acordao, numero_processo, relator, orgao_julgador, pagina,
    #  por_pagina, detalhar, grupos, ordenar)
    ("busca_data_simples", "", None, "02603/22", None, None, 1, 10, False, None, "data"),
    ("busca_relevancia_sem_grupos", "multa reincidência", None, "02603/22", None, None, 1, 10, False, None, "relevancia"),
    ("busca_detalhar", "", None, "02603/22", None, None, 1, 10, True, None, "data"),
    ("busca_grupos_data", "", None, "02603/22", None, None, 1, 2, False, [["licitação", "licitações"], ["reincidência"]], "data"),
    ("busca_grupos_relevancia", "", None, "02603/22", None, None, 1, 2, False, [["licitação", "licitações"], ["reincidência"]], "relevancia"),
    ("busca_por_numero_acordao", "", "00055/26", None, None, None, 1, 10, False, None, "data"),
    ("busca_ordenar_invalido", "", None, "02603/22", None, None, 1, 10, False, None, "xyz"),
    # red team 22/09/2026-b, achado 5: relevância pedida mas sem termo de texto (só numero_processo)
    # não pode se rotular "por relevância" no cabeçalho nem imprimir "termos casados".
    ("busca_relevancia_sem_termo", "", None, "02603/22", None, None, 1, 10, False, None, "relevancia"),
]

CASO_OBTER_SEM_PDF = ("obter_sem_pdf", 98114, None, None, False)
CASO_OBTER_COM_PDF = ("obter_com_pdf", 98114, None, None, True)
CASO_VERIFICAR_PORTAL = ("verificar_via_portal", 98114, None, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS")
CASO_VERIFICAR_RECIBO = ("verificar_via_recibo", 98114, None, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS")


def _normalizar_espaco(t):
    return re.sub(r"\s+", " ", t or "").strip()


def _diff_pos(a, b):
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n


def _relatar_diferenca(nome, a, b, normalizando=False):
    k = _diff_pos(a, b)
    tag = " (após normalizar espaço)" if normalizando else ""
    print(f"DIFERE {nome}{tag} @ {k} (len node={len(a)} py={len(b)})")
    print(f"  node: {a[max(0, k - 80):k + 120]!r}")
    print(f"  py:   {b[max(0, k - 80):k + 120]!r}")


# --------------------------------------------------------------------------- #
# Lado Python                                                                  #
# --------------------------------------------------------------------------- #
def rodar_lado_python(dir_recibos):
    _garantir_fonte_python()
    os.environ["TCERO_MCP_SEM_AVISO_ATUALIZACAO"] = "1"
    os.environ["TCERO_MCP_DIR_RECIBOS"] = dir_recibos

    spec = importlib.util.spec_from_file_location("servidor_tcero_v121", PY_SOURCE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    async def _consultar_mock(params, operacao):
        return _rotear_mock(params)

    async def _baixar_pdf_mock(url):
        with open(PDF_98114, "rb") as f:
            return f.read()

    m._consultar_api = _consultar_mock
    m._baixar_pdf = _baixar_pdf_mock

    saida = {}
    for nome, texto_livre, numero_acordao, numero_processo, relator, orgao_julgador, pagina, por_pagina, detalhar, grupos, ordenar in CASOS_BUSCA:
        saida[nome] = asyncio.run(m._buscar(texto_livre, numero_acordao, numero_processo, relator,
                                             orgao_julgador, pagina, por_pagina, detalhar, grupos, ordenar))

    nome, id_decisao, numero_acordao, numero_processo, ler_inteiro_teor = CASO_OBTER_SEM_PDF
    saida[nome] = asyncio.run(m._obter_acordao(id_decisao, numero_acordao, numero_processo, ler_inteiro_teor))

    nome, id_decisao, numero_acordao, numero_processo, ler_inteiro_teor = CASO_OBTER_COM_PDF
    saida[nome] = asyncio.run(m._obter_acordao(id_decisao, numero_acordao, numero_processo, ler_inteiro_teor))
    # a essa altura o recibo de 98114 já tem o PDF — recibo local passa a responder verificar
    recibo_caminho = os.path.join(dir_recibos, "98114.json")
    with open(recibo_caminho, encoding="utf-8") as f:
        saida["recibo_98114"] = json.load(f)

    nome, id_decisao, numero_acordao, trecho = CASO_VERIFICAR_RECIBO
    saida[nome] = asyncio.run(m._verificar_citacao(id_decisao, numero_acordao, trecho))

    # verificar SEM recibo: roda antes de qualquer obter_acordao, em diretório de recibo separado
    os.environ["TCERO_MCP_DIR_RECIBOS"] = dir_recibos + "_vazio"
    os.makedirs(dir_recibos + "_vazio", exist_ok=True)
    m.DIR_RECIBOS = dir_recibos + "_vazio"
    nome, id_decisao, numero_acordao, trecho = CASO_VERIFICAR_PORTAL
    saida[nome] = asyncio.run(m._verificar_citacao(id_decisao, numero_acordao, trecho))

    return saida


# --------------------------------------------------------------------------- #
# Lado Node — subprocesso, importa server/index.js + server/lib.js.           #
# DIR_RECIBOS em lib.js é uma const lida UMA VEZ, no import (mesma disciplina  #
# do Python — variável de ambiente fixa a config do processo inteiro, nunca    #
# muda em runtime). Por isso rodam-se DOIS subprocessos Node, cada um com o    #
# env var já certo ANTES do import: um para o caminho normal (busca/obter/     #
# verificar via recibo) e outro, com diretório de recibos vazio, só para       #
# verificar_via_portal — mesma separação que o lado Python faz reatribuindo    #
# `m.DIR_RECIBOS` em memória (mais barato lá porque o Python resolve globals   #
# do módulo a cada chamada; em Node é `const`, então o processo é que muda).   #
# --------------------------------------------------------------------------- #
NODE_SCRIPT_PRINCIPAL = r"""
import fs from "node:fs";
import path from "node:path";
import * as idx from "%(index)s";

const FIXTURES = %(fixtures_json)s;
const PDF_98114 = %(pdf_json)s;
const DIR_RECIBOS = %(dir_recibos_json)s;

function rotear(params) {
  if (params.numeroProcesso === "02603/22") return FIXTURES.proc;
  if (params.numeroAcordao === "00055/26") return FIXTURES.ac;
  if (params.IdDecisao === "98114") return FIXTURES.id;
  throw new Error("mock sem rota para params=" + JSON.stringify(params));
}

idx._setDepsParaTeste({
  consultarApi: async (params) => rotear(params),
  baixarPdf: async () => fs.readFileSync(PDF_98114),
});

const casos = %(casos_busca_json)s;
const saida = {};
for (const c of casos) {
  saida[c.nome] = await idx.buscar(c.texto_livre, c.numero_acordao, c.numero_processo, c.relator,
                                    c.orgao_julgador, c.pagina, c.por_pagina, c.detalhar, c.grupos, c.ordenar);
}

saida["obter_sem_pdf"] = await idx.obterAcordao(98114, null, null, false);
saida["obter_com_pdf"] = await idx.obterAcordao(98114, null, null, true);
saida["recibo_98114"] = JSON.parse(fs.readFileSync(path.join(DIR_RECIBOS, "98114.json"), "utf-8"));
saida["verificar_via_recibo"] = await idx.verificarCitacao(98114, null, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS");

process.stdout.write(JSON.stringify(saida));
"""

NODE_SCRIPT_PORTAL = r"""
import * as idx from "%(index)s";

const FIXTURES = %(fixtures_json)s;
function rotear(params) {
  if (params.IdDecisao === "98114") return FIXTURES.id;
  throw new Error("mock sem rota para params=" + JSON.stringify(params));
}
idx._setDepsParaTeste({ consultarApi: async (params) => rotear(params) });

const saida = {};
saida["verificar_via_portal"] = await idx.verificarCitacao(98114, null, "DESCUMPRIMENTO DE DETERMINAÇÃO DO TRIBUNAL DE CONTAS");
process.stdout.write(JSON.stringify(saida));
"""


def _rodar_node_script(script_tpl, dir_recibos, **extra):
    args = {
        "index": "file://" + INDEX_JS,
        "fixtures_json": json.dumps({"proc": FIX_PROCESSO, "ac": FIX_ACORDAO, "id": FIX_ID}),
        "pdf_json": json.dumps(PDF_98114),
        "dir_recibos_json": json.dumps(dir_recibos),
    }
    args.update(extra)
    script = script_tpl % args
    env = dict(os.environ)
    env["TCERO_MCP_SEM_AVISO_ATUALIZACAO"] = "1"
    env["TCERO_MCP_DIR_RECIBOS"] = dir_recibos
    r = subprocess.run(["node", "--input-type=module", "-e", script], input="", capture_output=True,
                        text=True, cwd=AQUI, env=env)
    if r.returncode:
        sys.exit("Node falhou:\n" + r.stderr)
    return json.loads(r.stdout)


def rodar_lado_node(dir_recibos, dir_recibos_vazio):
    casos_busca = [
        {
            "nome": nome, "texto_livre": texto_livre, "numero_acordao": numero_acordao,
            "numero_processo": numero_processo, "relator": relator, "orgao_julgador": orgao_julgador,
            "pagina": pagina, "por_pagina": por_pagina, "detalhar": detalhar, "grupos": grupos,
            "ordenar": ordenar,
        }
        for nome, texto_livre, numero_acordao, numero_processo, relator, orgao_julgador, pagina, por_pagina, detalhar, grupos, ordenar in CASOS_BUSCA
    ]
    principal = _rodar_node_script(NODE_SCRIPT_PRINCIPAL, dir_recibos, casos_busca_json=json.dumps(casos_busca, ensure_ascii=False))
    portal = _rodar_node_script(NODE_SCRIPT_PORTAL, dir_recibos_vazio)
    principal.update(portal)
    return principal


# --------------------------------------------------------------------------- #
# v1.6.0 — buscar_recibos, diário, linha do tempo, sugerir termos, triagem,     #
# alertas que dizem onde. MESMOS casos nos dois lados; zero rede.               #
# Texto do PDF: as funções puras recebem o MESMO texto (extraído pelo Python)   #
# para isolar o algoritmo da diferença PyMuPDF x pdfjs-dist.                    #
# --------------------------------------------------------------------------- #
import gzip
import random

ESTADO_FIXO = "/tmp/_paridade_estado_tcero"
SANITIZAR = ['falhou em "texto da busca" e \'outro trecho longo\' a@b.com 0123456/2026',
             "GET https://papyrus.tcero.tc.br/api/espelho/buscar?textoLivre=X&r=1 falhou",
             "https://tcero.tc.br/AbrirPdfConvidado/abcdef0123456789abcdef falhou 987654321", ""]
ARGS = [{"texto_livre": "abc", "grupos": [["a", "b"], ["c"]], "pagina": 2, "detalhar": True, "modo": "triagem", "id_decisao": 98114, "relator": "Fulano", "limite": 0},
        {"grupos": ["x", "y"], "ordenar": "data", "dias": 30}]
MSGS = ["[LEITURA DE PDF NÃO REALIZADA — x]", "PDF sem texto extraível", "[EXTRAÇÃO PARCIAL — t]", "formato inesperado", "O portal respondeu HTTP 503 de x",
        "ReadTimeout: x", "Muitas consultas em pouco tempo", "ECONNRESET", "nada"]
SAIDAS = ["[LEITURA DE PDF NÃO REALIZADA — x]", "Erro na consulta ao TCE-RO: y", "Erro na consulta ao TCE-RO: x\n\nVersão: 1.6.0", "Erro ao consultar o portal do TCE-RO (K): z",
          "PDF sem texto extraível (p)", "ok", "a\n[EXTRAÇÃO PARCIAL — t]\nb\n\nVersão: 1"]
ENTRADAS = [
    {"quando": "2026-10-10T12:00:00+00:00", "versao": "1.6.0", "ferramenta": "buscar_jurisprudencia_tcero", "tipo": "timeout", "http": None, "parcial": False, "ms": 900, "args": {"pagina": 2}, "limitador": "nível 1/5, livre", "mensagem": "m1 | x"},
    {"quando": "2026-10-11T12:00:00+00:00", "versao": "1.5.3", "ferramenta": "buscar_jurisprudencia_tcero", "tipo": "timeout", "http": None, "parcial": True, "ms": 100, "args": {}, "limitador": "nível 1/5, livre", "mensagem": "m2"},
    {"quando": "2026-10-12T12:00:00+00:00", "versao": "1.6.0", "ferramenta": "obter_acordao_tcero", "tipo": "pdf_falha", "http": "404", "parcial": False, "ms": None, "args": {"modo": "triagem"}, "limitador": "nível 1/5, livre", "mensagem": "m3"},
    {"quando": "2026-10-13T12:00:00+00:00", "versao": "1.6.0", "ferramenta": "x", "tipo": "formato_inesperado", "http": None, "parcial": False, "ms": 5, "args": {"grupos": "2 grupo(s), 3 termo(s)"}, "limitador": "nível 2/5, BLOQUEADO", "mensagem": "m4"},
    {"quando": "2026-10-14T12:00:00+00:00", "versao": "1.6.0", "ferramenta": "x", "tipo": "http_503", "http": "503", "parcial": False, "ms": 5, "args": {}, "limitador": "nível 1/5, livre", "mensagem": "m5"},
]
QUERIES_REC = [("licitação", None, None, None, 10), ("multa*", None, None, None, 1), ('"aplicadas ao gestor"', None, None, None, 10), ("", [["improcedentes", "x"], ["multas"]], None, None, 10),
               ("multa", None, "sintetica", None, 10), ("", None, None, "pleno", 10), ("", None, None, None, 10), ("de", None, None, None, 10), ("ZZXQWIA", None, None, None, 10),
               ("licitatório", None, None, "Pleno", 1), ("determinação tribunal", None, None, None, 20), ("reincidência", [["multa", "multas"]], None, "2ª Câmara", 5)]
ITENS_LT = [{"source": {"idDecisao": i, "dataSessao": f"{a}-03-01T00:00:00", "orgaoJulgador": o, "sigla": "AC1-TC", "numero": f"{i:05d}/{str(a)[2:]}",
            "ementa": f"multa {'reincidência' if i % 2 else ''} tema{i}", "linkArquivo": f"//tce.ro.gov.br/AbrirPdfConvidado/h{i}"}}
            for i, (a, o) in enumerate([(2020, "Pleno"), (2020, "1ª Câmara"), (2020, "Pleno"), (2021, "Pleno"), (2022, "2ª Câmara"), (2022, "2ª Câmara"), (2022, "Pleno"), (2022, "Pleno"), (2022, "1ª Câmara")], start=1)]
ITENS_LT.append({"source": {"idDecisao": 99, "ementa": "multa reincidência sem sessão", "orgaoJulgador": "Pleno"}})
LT_E2E = [(None, [["reincidência"], ["multa"]], None, None, None, None), ("licitação", None, None, "Pleno", 2020, 2024), ("multa", None, None, None, None, None), ("", None, None, None, None, None), ("multa", None, None, None, "abc", None)]
SUG_E2E = [("reincidência multa", None), (None, [["reincidência"], ["multa"]]), ("licitação direcionamento fraude", None), ("zzxxyy", None), ("aposentadoria tempo contribuição", None)]
SINT = {"idDecisao": 11111, "sigla": "AC2-TC", "numero": "00001/26", "processo": "00001/26", "relator": "MARIA SINTETICA", "orgaoJulgador": "2ª Câmara", "dataSessao": "2026-02-02T00:00:00",
        "linkArquivo": "//tce.ro.gov.br/AbrirPdfConvidado/aaa", "ementa": "Julgados IMPROCEDENTES os pedidos. Multas aplicadas ao gestor; reincidência afastada.",
        "acordaoDescricao": "<p>Aplicar multa de R$ 1.000,00 ao responsável.</p>", "informacoesAdicionais": "<p>ZZXQWIA texto de IA.</p>"}


def _sem_sistema(t):
    return "\n".join(l for l in t.split("\n") if "Sistema:" not in l and "Relatar o problema" not in l)


def _trechos(textos):
    rnd = random.Random(160)
    out = []
    for nome, t in textos.items():
        ps = t.split()
        for _ in range(70):
            i = rnd.randrange(0, max(1, len(ps) - 30)); n = rnd.randrange(8, 25)
            a = " ".join(ps[i:i + n])
            if rnd.random() < 0.25:
                j = rnd.randrange(i + n, max(i + n + 1, len(ps) - 12)); a += " [...] " + " ".join(ps[j:j + 8])
            out.append([nome, a])
    return out


NODE_V160 = r"""
import fs from "node:fs";
const base = %(base)s;
const L = await import(base + "lib.js"), V = await import(base + "v160.js"), idx = await import(base + "index.js"), P = await import(base + "posicao2.js");
const IN = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const C2 = IN.c2; const out = {};
class RuntimeError extends Error {}
out.sanitizar = IN.sanitizar.map((x) => V.sanitizarErro(x));
out.args = IN.args.map((x) => V.descreverArgs(x));
out.tipo = IN.msgs.map((x) => V.tipoDoErroDiario(x));
out.falha = IN.saidas.map((x) => [V.falhaNaSaida(x), V.linhaDaFalha(x)]);
out.resumo = [V.resumirErros(IN.entradas, 30, false), V.resumirErros(IN.entradas, 30, true), V.resumirErros([], 7, false)];
out.diag = [0, "x", 400].map((x) => V.diagnosticoErros(x));
const e = V.registrarErro("obter_acordao_tcero", { erro: new RuntimeError("Falha https://a.b/c?q=SEG 'trecho longo' 0123/26 HTTP 502 x"), args: IN.args[0], ms: 7, agora: 1760500000000 });
const f = JSON.parse(fs.readFileSync(V.arquivoErros(), "utf-8").trim().split("\n").pop());
delete e.sistema; delete f.sistema; out.registrar = [e, f];
out.recibos = IN.queries.map((q) => V.buscarRecibos(q[0], q[1], q[2], q[3], q[4], IN.dirRec));
out.ltpura = [V.linhaDoTempo(IN.itens, ["multa", "reincidência"], null, null, "f", 50), V.linhaDoTempo(IN.itens, ["multa"], 2021, 2022)];
idx._setDepsParaTeste({ consultarApi: async () => C2 });
out.lt = []; for (const q of IN.lt) out.lt.push(await idx.linhaDoTempoAsync(...q));
out.sug = []; for (const q of IN.sug) out.sug.push(await idx.sugerirTermosAsync(...q));
const dec = { 98114: IN.s98114 };
idx._setDepsParaTeste({ consultarApi: async () => ({ result: [{ source: IN.s98114 }] }), baixarPdf: async () => fs.readFileSync(IN.pdf98114) });
out.tri0 = await idx.obterAcordao(98114, null, null, false, "triagem");
out.tri1 = await idx.obterAcordao(98114, null, null, true, "triagem");
out.pdf = {};
for (const [n, t] of Object.entries(IN.textos)) {
  const res = { sem_texto: false, paginas: 9, parcial: false };
  out.pdf[n] = { est: V.estruturaPdfTcero(t), fecho: V.fechoDoPdf(t), al: V.alertasDeTriagem(t), lin: V.linhasTriagemPdf(t, res), pos: [0, 500, 20000, 60000].map((p) => [P.posicaoTcero(t, Math.min(p, t.length - 1)), L.paginaPdfTcero(t, Math.min(p, t.length - 1))]) };
}
out.trechos = IN.trechos.map(([n, tr]) => { const r = L.verificarTrecho({ t: IN.textos[n] }, tr); return [r.valido, r.alertas, r.posicao || "", r.pagina || ""]; });
process.stdout.write(JSON.stringify(out));
"""


def paridade_v160(tmp):
    """Devolve (casos, divergentes, natureza)."""
    sys.dont_write_bytecode = True
    _garantir_fonte_python()
    est = os.path.join(tmp, "estado_v160"); dir_rec = os.path.join(tmp, "rec_v160"); os.makedirs(dir_rec)
    fundo = os.path.expanduser("~/MCP/tcero-jurisprudencia/fundo_vocabulario.json")
    for k, v in (("TCERO_MCP_DIR_ESTADO", est), ("TCERO_MCP_DIR_RECIBOS", dir_rec), ("TCERO_MCP_SEM_AVISO_ATUALIZACAO", "1"), ("TCERO_MCP_FUNDO_VOCAB", fundo)):
        os.environ[k] = v
    spec = importlib.util.spec_from_file_location("servidor_tcero_v160", PY_SOURCE)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m._ARQUIVO_ESTADO_DISJUNTOR = os.path.join(tmp, "disj_py.json")
    c2 = json.loads(gzip.open(os.path.join(FIXTURES, "exp_C2_controle_or.json.gz")).read().decode("utf-8"))
    s98114 = next(i["source"] for i in FIX_ID["result"] if i["source"]["idDecisao"] == 98114)
    s96141 = next(i["source"] for i in _ler_fixture("02_busca_numeroAcordao.json")["result"] if i["source"]["idDecisao"] == 96141)
    pdfs = {s98114["linkArquivo"]: PDF_98114, s96141["linkArquivo"]: os.path.join(FIXTURES, "pdf", "96141.pdf")}
    decs = {"98114": s98114, "96141": s96141}

    async def api(params, op):
        return {"result": [{"source": decs[str(params["IdDecisao"])]}]}

    async def baixar(url):
        for l, p in pdfs.items():
            if m._corrigir_link_pdf(l) == url:
                return open(p, "rb").read()
        raise AssertionError(url)
    m._consultar_api, m._baixar_pdf = api, baixar
    for i in (98114, 96141):
        asyncio.run(m._obter_acordao(i, None, None, True))
    m._gravar_recibo_tcero(SINT)
    textos = {}
    for n in ("98114", "96141", "77649", "85572"):
        textos[n] = m._extrair_texto_pdf(open(os.path.join(FIXTURES, "pdf", n + ".pdf"), "rb").read())["texto"]
    py = {}
    py["sanitizar"] = [m._sanitizar_erro(x) for x in SANITIZAR]
    py["args"] = [m._descrever_args(x) for x in ARGS]
    py["tipo"] = [m._tipo_do_erro_diario(x) for x in MSGS]
    py["falha"] = [[m._falha_na_saida(x), m._linha_da_falha(x)] for x in SAIDAS]
    py["resumo"] = [m._resumir_erros(ENTRADAS, 30, False), m._resumir_erros(ENTRADAS, 30, True), m._resumir_erros([], 7, False)]
    py["diag"] = [m._diagnostico_erros(x) for x in (0, "x", 400)]
    m._estado_limitador_resumo = lambda agora=None: "nível 1/5, livre"
    e = m._registrar_erro("obter_acordao_tcero", erro=type("RuntimeError", (Exception,), {})("Falha https://a.b/c?q=SEG 'trecho longo' 0123/26 HTTP 502 x") if False else RuntimeError("Falha https://a.b/c?q=SEG 'trecho longo' 0123/26 HTTP 502 x"), args=ARGS[0], ms=7, agora=1760500000)
    f = json.loads(open(m._arquivo_erros(), encoding="utf-8").read().strip().split("\n")[-1])
    e.pop("sistema"); f.pop("sistema"); py["registrar"] = [e, f]
    py["recibos"] = [m._buscar_recibos(*q, pasta=dir_rec) for q in QUERIES_REC]
    py["ltpura"] = [m._linha_do_tempo(ITENS_LT, ["multa", "reincidência"], None, None, "f", 50), m._linha_do_tempo(ITENS_LT, ["multa"], 2021, 2022)]

    async def api_c2(params, op):
        return c2
    m._consultar_api = api_c2
    py["lt"] = [asyncio.run(m._linha_do_tempo_async(*q)) for q in LT_E2E]
    py["sug"] = [asyncio.run(m._sugerir_termos_async(*q)) for q in SUG_E2E]
    m._consultar_api = api
    m.DIR_RECIBOS = os.path.join(tmp, "rec_tri"); m._cache_limpar(); m._cache_pdf_limpar()
    py["tri0"] = asyncio.run(m._obter_acordao(98114, None, None, False, "triagem"))
    py["tri1"] = asyncio.run(m._obter_acordao(98114, None, None, True, "triagem"))
    py["pdf"] = {}
    for n, t in textos.items():
        res = {"sem_texto": False, "paginas": 9, "parcial": False}
        py["pdf"][n] = {"est": m._estrutura_pdf_tcero(t), "fecho": m._fecho_do_pdf(t), "al": m._alertas_de_triagem(t), "lin": m._linhas_triagem_pdf(t, res),
                        "pos": [[m._posicao_tcero(t, min(p, len(t) - 1)), m._pagina_pdf_tcero(t, min(p, len(t) - 1))] for p in (0, 500, 20000, 60000)]}
    trechos = _trechos(textos)
    py["trechos"] = []
    for n, tr in trechos:
        r = m._verificar_trecho({"t": textos[n]}, tr)
        py["trechos"].append([r["valido"], r["alertas"], r.get("posicao") or "", r.get("pagina") or ""])

    entrada = {"sanitizar": SANITIZAR, "args": ARGS, "msgs": MSGS, "saidas": SAIDAS, "entradas": ENTRADAS, "queries": QUERIES_REC, "dirRec": dir_rec, "itens": ITENS_LT,
               "lt": LT_E2E, "sug": SUG_E2E, "c2": c2, "s98114": s98114, "pdf98114": PDF_98114, "textos": textos, "trechos": trechos}
    arq_in = os.path.join(tmp, "in_v160.json"); arq_js = os.path.join(tmp, "v160.mjs")
    json.dump(entrada, open(arq_in, "w", encoding="utf-8"), ensure_ascii=False)
    open(arq_js, "w", encoding="utf-8").write(NODE_V160 % {"base": json.dumps("file://" + os.path.dirname(INDEX_JS) + "/")})
    env = dict(os.environ); env["TCERO_MCP_DIR_ESTADO"] = est; env["TCERO_MCP_DIR_RECIBOS"] = os.path.join(tmp, "rec_node")
    r = subprocess.run(["node", arq_js, arq_in], capture_output=True, text=True, env=env)
    if r.returncode:
        sys.exit("Node v160 falhou:\n" + r.stderr)
    nd = json.loads(r.stdout)

    dif, natureza, total = 0, {}, 0
    for chave in py:
        if chave == "pdf":
            itens = [(f"pdf[{n}].{k}", nd["pdf"][n][k], py["pdf"][n][k]) for n in py["pdf"] for k in py["pdf"][n]]
        elif isinstance(py[chave], list):
            itens = [(f"{chave}[{i}]", nd[chave][i], v) for i, v in enumerate(py[chave])]
        else:
            itens = [(chave, nd[chave], py[chave])]
        for nome, a, b in itens:
            total += 1
            if chave == "resumo":
                a, b = (_sem_sistema(a), _sem_sistema(b)) if isinstance(a, str) else (a, b)
            if chave == "tri1":
                a, b = sem_g(a), sem_g(b)
                if a != b and _normalizar_espaco(a) != _normalizar_espaco(b):
                    natureza[nome] = "esperado - triagem com PDF depende do texto extraido (PyMuPDF x pdfjs); algoritmo conferido com texto identico em pdf[*]"
                    continue
            if chave == "tri0":
                a, b = sem_g(a), sem_g(b)
            if json.dumps(a, ensure_ascii=False, sort_keys=True) != json.dumps(b, ensure_ascii=False, sort_keys=True):
                dif += 1; natureza[nome] = "DIVERGENTE"
                print("DIFERE", nome); print("  node:", json.dumps(a, ensure_ascii=False)[:500]); print("  py:  ", json.dumps(b, ensure_ascii=False)[:500])
    return total, dif, natureza


def sem_g(t):
    return re.sub(r"gravado em \d{4}-\d{2}-\d{2}T[\d:+\-]+", "gravado em <ts>", t or "")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        dir_py = os.path.join(tmp, "recibos_py")
        dir_node = os.path.join(tmp, "recibos_node")
        dir_node_vazio = os.path.join(tmp, "recibos_node_vazio")
        os.makedirs(dir_py, exist_ok=True)
        os.makedirs(dir_node, exist_ok=True)
        os.makedirs(dir_node_vazio, exist_ok=True)

        py = rodar_lado_python(dir_py)
        node = rodar_lado_node(dir_node, dir_node_vazio)
        tot160, dif160, nat160 = paridade_v160(tmp)

    dif = 0
    natureza = {}

    # gravado_em varia (timestamp real da execução) nos dois lados — normaliza antes de comparar
    # texto e recibo, mesmo campo que o próprio Python já documenta como não determinístico.
    def sem_gravado_em(t):
        return re.sub(r"gravado em \d{4}-\d{2}-\d{2}T[\d:+\-]+", "gravado em <ts>", t or "")

    for nome, *_ in CASOS_BUSCA:
        a, b = sem_gravado_em(node.get(nome, "")), sem_gravado_em(py.get(nome, ""))
        if a != b:
            dif += 1
            natureza[nome] = "busca: saída difere"
            _relatar_diferenca(nome, a, b)

    for nome in ("obter_sem_pdf",):
        a, b = sem_gravado_em(node.get(nome, "")), sem_gravado_em(py.get(nome, ""))
        if a != b:
            dif += 1
            natureza[nome] = "obter_acordao (sem PDF): saída difere"
            _relatar_diferenca(nome, a, b)

    # obter_com_pdf: contém o texto extraído do PDF — PyMuPDF x pdfjs-dist podem divergir em
    # espaçamento. Compara bruto primeiro; se divergir, compara normalizado e classifica.
    a, b = sem_gravado_em(node.get("obter_com_pdf", "")), sem_gravado_em(py.get("obter_com_pdf", ""))
    if a != b:
        an, bn = _normalizar_espaco(a), _normalizar_espaco(b)
        if an == bn:
            natureza["obter_com_pdf"] = (
                f"cosmético — só espaçamento/quebra de linha da extração do PDF (bruto difere em "
                f"{sum(1 for x, y in zip(a, b) if x != y) or abs(len(a) - len(b))} posição(ões); "
                "idêntico depois de normalizar espaço em branco)"
            )
        elif (("TRECHO DO MEIO OMITIDO" in a or "TRECHO DO MEIO OMITIDO" in b)
              and an[:min(len(an), len(bn)) // 2] == bn[:min(len(an), len(bn)) // 2]):
            # (07/10/2026) ESPERADO: o PyMuPDF devolve mais espaço em branco que o pdf.js, então o mesmo PDF grande gasta o
            # orçamento de caracteres em pontos diferentes e o miolo omitido (sempre dito) começa em lugar diferente. Igualar exigiria
            # normalizar o texto do PDF (mudaria o hash dos recibos e o texto em que a POSIÇÃO foi medida) — decisão: registrar.
            natureza["obter_com_pdf"] = ("esperado — orçamento de caracteres: o espaço extra do PyMuPDF muda onde o miolo é omitido "
                                         "(sempre dito); o começo é idêntico depois de normalizar espaço")
        else:
            dif += 1
            natureza["obter_com_pdf"] = "SUBSTANTIVO — difere mesmo depois de normalizar espaço"
            _relatar_diferenca("obter_com_pdf", a, b)
            _relatar_diferenca("obter_com_pdf", an, bn, normalizando=True)

    for nome in ("verificar_via_portal", "verificar_via_recibo"):
        a, b = sem_gravado_em(node.get(nome, "")), sem_gravado_em(py.get(nome, ""))
        if a != b:
            an, bn = _normalizar_espaco(a), _normalizar_espaco(b)
            if nome == "verificar_via_recibo" and an == bn:
                natureza[nome] = "cosmético — mesmo motivo do obter_com_pdf (texto do recibo inclui o PDF)"
            else:
                dif += 1
                natureza[nome] = "verificar_citacao: saída difere"
                _relatar_diferenca(nome, a, b)

    # recibo: compara campo a campo, tratando 'texto' (que carrega o PDF) e os dois hashes à
    # parte — hash depende de 'texto', então diverge em cascata se o PDF divergir.
    ry, rn = py.get("recibo_98114", {}), node.get("recibo_98114", {})
    campos_estruturais = [k for k in ry.keys() if k not in ("texto", "sha256", "sha256_campos", "gravado_em")]
    dif_estrutural = [k for k in campos_estruturais if ry.get(k) != rn.get(k)]
    # (07/10/2026) excertos tirados do texto do PDF (texto_parecer_mpc etc.) herdam o espaçamento da extração
    # e a janela do excerto é medida em caracteres BRUTOS: com mais espaço, cabe uma palavra a menos (um é prefixo do outro)
    def _mesmo_excerto(x, y):
        nx, ny = _normalizar_espaco(str(x)), _normalizar_espaco(str(y))
        curto, longo = sorted((nx, ny), key=len)
        return longo.startswith(curto) and len(longo) - len(curto) <= 40
    cosmet = [k for k in dif_estrutural if k.startswith("texto_") and isinstance(ry.get(k), list) and isinstance(rn.get(k), list)
              and len(ry[k]) == len(rn[k]) and all(_mesmo_excerto(x, y) for x, y in zip(ry[k], rn[k]))]
    if cosmet:
        natureza["recibo_excertos"] = (f"cosmético — {cosmet}: mesmos excertos; a janela em caracteres brutos pega uma palavra a "
                                       "menos no lado com mais espaço (PyMuPDF)")
        dif_estrutural = [k for k in dif_estrutural if k not in cosmet]
    if dif_estrutural:
        dif += 1
        natureza["recibo_campos"] = f"campos estruturais divergem: {dif_estrutural}"
        print("DIFERE recibo_campos:", dif_estrutural)
        for k in dif_estrutural:
            vy, vn = ry.get(k), rn.get(k)
            if isinstance(vy, list) and isinstance(vn, list):
                print(f"   {k}: py {len(vy)} itens, node {len(vn)} itens")
                for x in vy:
                    if x not in vn: print("     só no py:", json.dumps(x, ensure_ascii=False)[:400])
                for x in vn:
                    if x not in vy: print("     só no node:", json.dumps(x, ensure_ascii=False)[:400])
            else:
                print("   py:", json.dumps(vy, ensure_ascii=False)[:300]); print("   node:", json.dumps(vn, ensure_ascii=False)[:300])
    texto_py, texto_node = ry.get("texto", ""), rn.get("texto", "")
    if texto_py != texto_node:
        if _normalizar_espaco(texto_py) == _normalizar_espaco(texto_node):
            natureza["recibo_texto"] = "cosmético — texto do PDF difere só em espaçamento (PyMuPDF x pdfjs-dist)"
            natureza["recibo_hashes"] = (
                "CONSEQUÊNCIA do acima — sha256/sha256_campos divergem porque 'texto' não é "
                "byte-idêntico (a normalização de espaço não é aplicada ao hash, nem no Python nem "
                "no Node — o hash é sobre o texto bruto, de propósito, para detectar qualquer "
                "adulteração; o corpo de recibo em si é honesto sobre isso)."
            )
        else:
            dif += 1
            natureza["recibo_texto"] = "SUBSTANTIVO"
            _relatar_diferenca("recibo_texto", texto_node, texto_py)
    else:
        if ry.get("sha256") != rn.get("sha256") or ry.get("sha256_campos") != rn.get("sha256_campos"):
            dif += 1
            natureza["recibo_hashes"] = "texto idêntico mas hash difere — bug de serialização, investigar"

    dif += dif160
    natureza.update({"v160:" + k: v for k, v in nat160.items()})
    total = len(CASOS_BUSCA) + 2 + 2 + 1 + tot160  # buscas + obter(2) + verificar(2) + recibo + v1.6.0
    print(f"\ncasos {total} · divergentes reais {dif}")
    if natureza:
        print("Natureza de cada item com diferença (real ou cosmética):")
        for k, v in natureza.items():
            print(f"  - {k}: {v}")
    sys.exit(1 if dif else 0)


if __name__ == "__main__":
    main()
