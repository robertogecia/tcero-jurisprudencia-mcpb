# Jurisprudência TCE-RO — instalador `.mcpb` para o Claude Desktop

Código-fonte do pacote `Jurisprudencia-TCERO.mcpb` publicado nas
[releases do servidor Python](https://github.com/robertogecia/tcero-jurisprudencia-mcp/releases/latest),
que é a **fonte de verdade** (README completo, como pesquisar bem, segurança, como reportar erro e
apoiar o projeto estão lá). Instalar: baixe o `.mcpb` na release → Claude Desktop → Configurações →
Extensões → arraste o arquivo. Não precisa instalar Node: o Claude Desktop traz o runtime.

Empacotar a partir deste código:

```bash
npm install && npm test
npx -y @anthropic-ai/mcpb@latest pack . Jurisprudencia-TCERO.mcpb
```

Licença MIT · Autor: Roberto Grécia Bessa (OAB/RO 7865-A) · integração não-oficial com o portal
ePapyrus do TCE-RO.

---

# Jurisprudência TCE-RO (.mcpb)

Porte Node do `~/MCP/tcero-jurisprudencia` (Python, fonte de verdade congelada no commit
`d8c024b`, v1.2.0 — porte inicial foi sobre `6dcd631`/v1.1.0, atualizado com o delta de
ranking/panorama) para instalar com dois cliques no Claude Desktop. Mesmas 4 ferramentas, mesmas
strings de saída, mesmo contrato de recibo de custódia (mesmos campos e mesma serialização; o hash de um
recibo gravado por este pacote NÃO é igual ao de um gravado pelo Python para o mesmo acórdão,
porque a extração de texto do PDF — pdfjs-dist × PyMuPDF — difere no espaçamento; cada recibo é
internamente consistente e o lint confere o hash contra o próprio arquivo).

## v1.2.0 (delta d8c024b) — `ordenar`, Panorama, `_orgao_do_fecho` com múltiplos fechos

- `ordenar` (novo parâmetro de `buscar_jurisprudencia_tcero`): `"relevancia"` é o PADRÃO quando há
  `texto_livre`/`grupos` — pontua cada decisão offline (núcleo ementa+dispositivo pesa 2 por termo
  distinto casado, informações adicionais de IA pesam 1) e ordena por isso, desempatando por data;
  sem termo nenhum, comporta-se como `"data"`. Cada item ganha a linha `termos casados: N/M`;
  `ordenar` inválido é recusado ANTES de qualquer requisição. Portado em `lib.js`
  (`termosDaConsulta`, `pontuarRelevancia`, `ordenarPorRelevancia`) e ligado em `index.js`.
- **Panorama**: bloco offline no fim da página 1 quando há 3+ decisões (`lib.js`:
  `blocoPanorama`) — órgão, ano, sigla, natureza, top-5 relatores.
- `orgaoDoFecho` agora devolve `null` quando o PDF tem fechos de **órgãos diferentes** (típico de
  embargos que transcrevem o acórdão embargado) — antes só pegava o primeiro match.
- `VERSAO` → `1.2.0` em `lib.js`, `manifest.json`, `package.json`.

### Red team 22/09/2026-b (commit `e7d8592`, mesma `VERSAO` 1.2.0)

- `"frase exata"` entre aspas no `texto_livre` vira UM termo do ranking (antes virava pedaços com
  aspas grudadas que nunca casavam); palavras vazias (`de`, `do`, `da`, `ao`, `à`, `e`, `o`, `a`...
  — lista exata em `PALAVRAS_VAZIAS_RELEVANCIA`, `lib.js`) e termos de 1 letra não contam mais —
  `\bde` casava o núcleo de 5.047/5.052 decisões do snapshot do Python e só inflava o denominador.
- Linha `termos casados: N/M` ganha `· +K só em informações adicionais (IA)` quando algum termo só
  bateu no campo de IA (não no núcleo ementa+dispositivo).
- Cabeçalho da busca não diz mais "por relevância" quando não há termo nenhum para pontuar (só
  relator/órgão/número) — nesse caso diz "por data... sem termo de texto para pontuar relevância".
- `blocoPanorama` tolera `orgaoJulgador`/`sigla`/etc. em lista ou `None` (`campoPanorama`), conta
  o mesmo relator uma vez mesmo com caixa diferente, e o cabeçalho diz quando cobre só o que casou
  todos os `grupos` ("que casaram todos os grupos" em vez de "desta busca").
- `orgaoDoFecho` reconhece "Tribunal Pleno"/"Primeira Câmara"/"Segunda Câmara" como sinônimos de
  "Pleno"/"1ª Câmara"/"2ª Câmara" (`SINONIMOS_ORGAO_FECHO`) — sem isso, duas grafias do MESMO
  órgão no mesmo PDF (comum: acórdão + embargos) davam falso conflito (`null`).

- `server/lib.js` — lógica pura: normalização (`_fold`, `_padronizar_numero`, `_html_para_texto`,
  `_ementa_limpa`, `_corrigir_link_pdf`), montagem de resumo/detalhe e orçamentos de saída,
  `grupos` (E entre grupos, OU dentro do grupo, filtrado no cliente), conferência literal por
  PALAVRA INTEIRA (`_verificar_trecho`/`_achar_palavras`) com alertas de atribuição (PARECER DO
  MPC/CORPO TÉCNICO, ALEGAÇÃO DA PARTE, TRANSCRIÇÃO, NEGAÇÃO, ENTRE ASPAS), recibo de custódia
  (sha256 do texto + sha256 dos campos, gravação atômica 0600/0700), corte do PDF preservando
  começo e fim, e o disjuntor de ritmo em arquivo (compartilhado entre processos via lockfile).
  Organizado para receber a v1.2.0 (ranking/panorama) sem mexer em `index.js`.
- `server/index.js` — protocolo MCP por stdio, rede (`fetch` nativo, timeout 90s na busca,
  redirect seguido + allowlist de host para o PDF, teto de 20 MB), extração de PDF com
  `pdfjs-dist` (ver escolha da lib abaixo), resolução de relator/órgão, checagem de versão nova
  em segundo plano.
- Estado do disjuntor em `server/.disjuntor_estado_tcero.json` (ao lado do módulo, como o
  Python); recibos em `~/.tcero-jurisprudencia-recibos/` (ou `TCERO_MCP_DIR_RECIBOS`).

## Por que `pdfjs-dist` (não `pdf-parse`, não binário nativo)

O Python usa PyMuPDF (`fitz`), que não existe em Node. Entre as alternativas puramente-JS:

- **`pdf-parse`** é mais simples (uma chamada, todo o texto), mas concatena o documento inteiro
  antes de devolver — não dá acesso página a página. O servidor precisa de contagem de páginas e
  de checagem de "caracteres não-espaço por página" página por página (`LIMIAR_CHARS_POR_PAGINA`,
  a mesma heurística que decide "PDF sem texto extraível") e de um corte cooperativo por página
  (`TETO_PAGINAS_PDF`, checado a cada página, não só no fim). `pdf-parse` também empacota
  `pdfjs-dist` por baixo — usar `pdfjs-dist` direto evita uma camada e dá o controle por página
  que o porte fiel do Python exige.
- **`pdfjs-dist` (legacy build)** é puro JavaScript (sem binário nativo, sem compilação, nada de
  rede durante `npm install` além do registry do npm), dá acesso a `getPage(i).getTextContent()`
  por página, e é o motor de referência para leitura de PDF em Node/browser (mesmo projeto do
  Firefox). É a escolha deste porte.

Divergência conhecida e aceita: PyMuPDF e pdfjs-dist não extraem espaçamento/quebra de linha
byte-a-byte igual (ordem de glifos, hifenização, colunas). A comparação de citação
(`_verificar_trecho`/`normalizarCasamento`) já normaliza espaço em branco antes de comparar, então
uma citação válida nos dois motores continua válida nos dois; o que pode variar é a contagem exata
de caracteres extraídos e o texto bruto guardado no recibo (`texto_pdf_completo`) — quando isso
importar (comparação byte a byte via `test/paridade.py`), normalize os dois lados por espaço antes
de comparar, como o próprio lint da peticao-rg já faz para a citação.

## Empacotar e instalar

```bash
npm install && npm test
npx -y @anthropic-ai/mcpb@latest pack . Jurisprudencia-TCERO.mcpb
```

Instalar: Claude Desktop → Configurações → Extensões → arrastar `Jurisprudencia-TCERO.mcpb`
(cópia em `~/MCP/`).

## Smoke test (22/09/2026, via stdio, rede real)

`tools/list` → 4 ferramentas. `buscar_jurisprudencia_tcero(numero_processo="02603/22",
por_pagina=3)` → 4 decisões reais, citação `(TCE-RO - APL-TC 00055/26, Rel. JOSÉ EULER POTYGUARA
PEREIRA DE MELLO, Pleno, j. 22/06/2026, DOe 07/07/2026)`. `obter_acordao_tcero(id_decisao=98114,
ler_inteiro_teor=true)` → PDF real baixado e extraído, linha `Verificação: "inteiro teor lido
(PDF)"` presente, recibo gravado em `~/.tcero-jurisprudencia-recibos/98114.json` com permissão
0600 (diretório 0700). `verificar_citacao_tcero(id_decisao=98114, trecho="DESCUMPRIMENTO DE
DETERMINAÇÃO DO TRIBUNAL DE CONTAS")` → ✅ VÁLIDO, **zero requisição** (via recibo local).

Achado corrigido durante o smoke test: `pdfjs-dist` escreve avisos (`Warning: ...`) em
`console.log` por padrão — no transporte MCP por stdio isso corrompe o JSON-RPC (stdout precisa
carregar só mensagens do protocolo). Corrigido com `verbosity: 0` em `getDocument()`
(`server/index.js`, função `extrairTextoPdf`).

## Duas implementações, uma fonte de verdade

Mudança de comportamento entra primeiro no Python (que tem os red teams de 13, 14 e 22/09/2026 —
ver `../tcero-jurisprudencia/references/`), depois aqui, com o teste correspondente.

## `test/paridade.py` — harness real, zero rede

```bash
~/MCP/tcero-jurisprudencia/.venv/bin/python test/paridade.py
```

Carrega o Python congelado (`/tmp/servidor_tcero_v121.py`, gerado sozinho a partir do commit
`e7d8592` se não existir) como módulo, com `_consultar_api` e `_baixar_pdf` monkey-patchados para
responder com as fixtures reais em `test/fixtures/` (zero requisição) — e roda o mesmo mock em
Node via `_setDepsParaTeste`, exportado por `server/index.js` só para teste (`buscar`,
`obterAcordao`, `verificarCitacao` também são exportados por essa mesma razão; o transporte MCP
por stdio só conecta quando o arquivo é executado diretamente, não quando importado). Compara 13
casos byte a byte: 8 páginas de busca (ordenar data/relevância, com/sem grupos, detalhar, ordenar
inválido, relevância sem termo de texto), obter com/sem inteiro teor, verificar via recibo e via
portal, e o recibo (JSON + os dois hashes).

**Resultado (22/09/2026, revalidado contra o red team 22/09/2026-b/e7d8592): 11 de 13 casos byte a
byte idênticos.** Os 2 restantes têm todos a MESMA causa raiz, já esperada e descrita na seção
anterior — pdfjs-dist e PyMuPDF não extraem espaço em branco de um PDF de forma idêntica:
- `obter_com_pdf` — divergência residual depois de normalizar espaço: o total de caracteres NÃO
  bate por causa da diferença de espaçamento (a contagem de caracteres NÃO-espaço,
  `chars_nao_espaco`, bate exatamente: 57.475 dos dois lados), e como o documento (36 páginas)
  está perto do teto de 45.000 caracteres, um lado corta (`TRECHO DO MEIO OMITIDO`) e o outro não
  — efeito cascata do mesmo espaçamento, não um bug novo.
- `recibo_texto`/`recibo_hashes` — o campo `texto` do recibo carrega o texto do PDF: idêntico
  depois de normalizar espaço, mas os hashes (`sha256`/`sha256_campos`) são calculados sobre o
  texto BRUTO de propósito (para detectar adulteração) — então divergem em cascata, por desenho,
  não por bug.
- `recibo_campos` (`texto_parecer_mpc`) — os excertos brutos (`_excertos_raw`) são recortados por
  posição de caractere no texto bruto; com o texto bruto ligeiramente diferente em comprimento, a
  janela do excerto pode incluir/excluir um caractere na borda. Mesma causa raiz.

`recibo_texto`/`recibo_hashes` continuam divergindo por desenho (mesmo motivo), mas não somam ao
total de "divergentes reais" — só o texto bruto do PDF (e o hash que depende dele) muda; nenhuma
das 13 comparações revelou um bug de LÓGICA (grupos, ordenar — incluindo frase exata/palavras
vazias/rótulo IA/cabeçalho sem termo do red team 22/09/2026-b —, panorama, citação, recibo
estrutural, sinônimo de órgão do fecho) — só o efeito conhecido e documentado da extração de PDF. Corrigido nesta rodada, a
partir do harness: a junção dos itens de texto do pdfjs-dist usava `.join(" ")` entre TODO item,
duplicando/triplicando espaços que o item já carregava (`"Secretaria de   Processamento"` em vez
de `"Secretaria de Processamento"`) e não distinguia fim de linha; trocado por concatenação direta
com quebra de linha em `item.hasEOL`, que aproximou MUITO o resultado do PyMuPDF (a saída bruta
antes desse ajuste divergia já no cabeçalho da 1ª página; depois, só no meio de um documento de 36
páginas). Também corrigido: `ordenar` inválido usava `JSON.stringify` (aspas duplas) onde o
Python usa `repr()` (aspas simples) — criada `pyRepr()` em `lib.js` e usada em toda mensagem de
erro que ecoa um valor do usuário (`relator`, `orgao_julgador`, `id`/`numero` não encontrado).

## O que NÃO foi portado nesta rodada

- **Testes de PDF sintético** (`--selftest` do Python gera PDFs em memória com `fitz.new_page()` +
  `insert_text()` para testar página em branco, PDF "misto", PDF digitalizado com carimbo de
  assinatura, e 60 páginas sintéticas com teto de 10): `pdfjs-dist` só LÊ PDF, não escreve, então
  esses casos não têm porte direto. O teste Node usa o PDF real `test/fixtures/pdf/98114.pdf` para
  confirmar que a extração funciona ponta a ponta; a lógica de corte/teto/limiar em si
  (`LIMIAR_CHARS_POR_PAGINA`, `TETO_PAGINAS_PDF`, `TETO_SEGUNDOS_PDF`) foi portada linha a linha
  para `extrairTextoPdf` em `server/index.js`, mas não tem teste automatizado equivalente ao dos
  PDFs sintéticos do Python.
- **Fuso horário do `diagnostico_ritmo_tcero`**: o Python formata os incidentes com
  `time.localtime` (hora local da máquina); o Node formata em UTC (`toISOString`). Cosmético (só
  aparece no histórico de incidentes do diagnóstico), mas é uma divergência real de texto — não
  corrigido nesta rodada.
- **Espaçamento/quebra de linha do texto extraído do PDF**: ver a seção do harness — reduzido
  muito nesta rodada (troca de `.join(" ")` por concatenação com `hasEOL`), mas não é garantia de
  byte a byte contra PyMuPDF em todo PDF; documentos perto do teto de orçamento do PDF
  (`ORCAMENTO_PDF`) podem cortar num ponto ligeiramente diferente entre os dois motores.

## Apoie o projeto

O pacote é gratuito e de código aberto, e é mantido no tempo livre de um advogado: cada mudança
do portal do TCE-RO exige diagnóstico, correção, testes e versão nova. Se ele economiza o seu
tempo, você pode apoiar a continuidade do trabalho com qualquer valor, por **Pix**:

> **Chave Pix (e-mail):** `robertogrecia@hotmail.com`

O apoio é voluntário e não muda nada no uso: o pacote continua igual para todos.

## Autor

**Roberto Grécia Bessa** — OAB/RO 7865-A
Instagram: [@robertogrecia](https://instagram.com/robertogrecia)

Irmão dos pacotes de jurisprudência do [TJRO](https://github.com/robertogecia/tjro-jurisprudencia-mcp) e dos servidores do [TRF1](https://github.com/robertogecia/trf1-jurisprudencia-mcp) e do [TJSE](https://github.com/robertogecia/mcp-tjse-jurisprudencia), do mesmo autor.

## Licença

MIT — veja [LICENSE](LICENSE).
