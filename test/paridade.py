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
PY_SOURCE = "/tmp/servidor_tcero_v121.py"


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
    if dif_estrutural:
        dif += 1
        natureza["recibo_campos"] = f"campos estruturais divergem: {dif_estrutural}"
        print("DIFERE recibo_campos:", dif_estrutural)
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

    total = len(CASOS_BUSCA) + 2 + 2 + 1  # buscas + obter(2) + verificar(2) + recibo
    print(f"\ncasos {total} · divergentes reais {dif}")
    if natureza:
        print("Natureza de cada item com diferença (real ou cosmética):")
        for k, v in natureza.items():
            print(f"  - {k}: {v}")
    sys.exit(1 if dif else 0)


if __name__ == "__main__":
    main()
