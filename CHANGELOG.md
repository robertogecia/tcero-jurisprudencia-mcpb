# Changelog — Jurisprudência TCE-RO (.mcpb)

O histórico anterior (1.2.0 a 1.5.3) está no fim do `README.md`.

## 1.7.7

A verificação de citação (verificar_citacao_tcero) passa a dizer com mais cuidado DE QUEM é a frase. Melhorias trazidas da extensão do TJRO (1.41.9) e adaptadas ao acórdão do Tribunal de Contas.

- **O ✅ pleno agora exige prova de que a frase é da Corte.** Antes, toda frase encontrada sem alerta saía "✅ VÁLIDO", mesmo no voto, no relatório ou no cabeçalho do PDF. Agora todo selo continua começando por "✅ VÁLIDO" (a frase existe no acórdão), mas só fica sem complemento quando a frase está na ementa, no dispositivo ou no fecho ("ACORDAM…") do próprio acórdão. No voto sai "✅ VÁLIDO, VOZ NÃO CONFIRMADA"; no relatório, na autuação e no cabeçalho de página, "✅ VÁLIDO, MAS NÃO É VOZ DO ÓRGÃO". Com alerta, "✅ VÁLIDO, MAS COM ALERTA DE ATRIBUIÇÃO". Gera mais avisos de propósito: num sorteio de 300 frases dos acórdãos guardados no computador, 187 das 253 que saíam ✅ sem alerta deixam de ser ✅ pleno (89 viram "voz não confirmada" e 98 "não é voz do órgão").
- **A ementa e o fecho também são conferidos.** Se antes do trecho aparece a certidão de julgamento, a autuação (responsáveis, CPF, assunto) ou a 1ª página do PDF, o trecho já não está na ementa e a voz não é confirmada. No fecho, a voz também não é confirmada quando, entre o "ACORDAM" e o trecho, aparece um título de relatório ou de voto ou a fala do relator ("proponho", "é como voto").
- **Avisos novos.** DOUTRINA (lição de autor anunciada por dois-pontos: "como leciona Fulano:"), DECISÃO TRANSCRITA (decisão monocrática ou acórdão recorrido/embargado transcrito no voto), PARECER TRANSCRITO (bloco do Ministério Público de Contas ou do corpo técnico, mesmo longe da palavra "parecer"), DEFESA TRANSCRITA (justificativas do responsável transcritas) e OBITER DICTUM? (concessiva) para o conteúdo de "ainda que não…, a conduta configura…": a Corte admite o ponto e decide apesar dele. O aviso ALEGAÇÃO DA PARTE passa a reconhecer "o jurisdicionado afirma", "o responsável assevera/pugna/requer/justifica".
- **Costura de pedaços curtos com [...].** Quando os fragmentos são curtos demais para provar a frase (pedaço de uma palavra só, nenhum pedaço com três palavras ou mais, ou três pedaços sem nenhum de cinco palavras), sai o aviso FRAGMENTOS CURTOS e o selo não é ✅ pleno.
- **Hífen de quebra, hífen invisível e milhar.** "contrato" passa a casar com "con-" no fim de uma linha e "trato" na seguinte, e com o hífen invisível do PDF; "24000" casa com "24.000". Números e palavras de negação continuam exatos: "25000" não casa com "24.000", e "procedente" não casa com "im-" + "procedente" partido no fim da linha.
- **Relator vencido.** O fecho com "Relator vencido", "relator(a) vencido(a)", "vencido o voto do Relator" ou "vencido o E. Relator" passa a ser lido como relator vencido.

Medição (cópia dos 36 recibos guardados no computador, sem internet): dois sorteios de 300 frases. No primeiro (frases inteiras), 66 continuam ✅ pleno, 89 viram "voz não confirmada", 98 "não é voz do órgão" e as 47 que já tinham alerta continuam com alerta. No segundo (frases cortadas no meio), 54, 112, 79 e 55. Nenhum aviso novo disparou nos dois sorteios: as frases sorteadas quase nunca caem dentro de doutrina, concessiva ou bloco transcrito. Lidas 20 de cada grupo: os 20 "não é voz do órgão" são relatório, autuação ou cabeçalho de página; dos 20 "voz não confirmada", cerca de metade é texto de terceiro dentro do voto (outro tribunal, decisão embargada, unidade técnica, Ministério Público de Contas, razões do recorrente) e a outra metade é o raciocínio do relator, que continua sem prova de ter vencido.

Varredura dirigida na mesma cópia (3.492 trechos tirados logo depois de dois-pontos, de verbo de relato da parte e de concessiva negativa), lidos todos os avisos novos: concessiva 8 (os 8 são conteúdo de concessão), ALEGAÇÃO DA PARTE com sujeito do TCE 5 (os 5 são o relato do recorrente ou do responsável), DECISÃO TRANSCRITA 2 (as 2 são decisão monocrática do STF transcrita: texto alheio, certo; o rótulo diz "decisão de origem" quando é de outro tribunal), PARECER TRANSCRITO 3 (1 certo, da equipe técnica; 2 no mesmo acórdão, dentro de bloco técnico longo, não confirmados na leitura). DEFESA TRANSCRITA não disparou depois do ajuste: na primeira rodada os 5 disparos eram errados (lei "in verbis" e análise da Unidade Técnica) e o anúncio foi restringido.

### Limitações conhecidas

- A cópia local tem só 36 acórdãos. Por isso o aviso de costura usa um piso por tamanho de fragmento, e não a medida de raridade por palavra do TJRO (calculada sobre 6.555 recibos). Uma costura de dois fragmentos de três palavras comuns pode passar sem aviso.
- O voto do relator, mesmo vencedor, sai "voz não confirmada": a ferramenta não prova que aquele parágrafo foi a razão do resultado. O "✅ VÁLIDO" pleno é só para ementa, dispositivo e fecho.
- No fecho, os itens do acórdão podem ser longos (há itens a mais de 10 mil caracteres do "ACORDAM"), por isso não há limite de distância como no TJRO. Fecho que avança para dentro do voto sem título reconhecido e sem fala do relator pode sair ✅ pleno.
- Os avisos DOUTRINA, DECISÃO, PARECER e DEFESA TRANSCRITA só valem para o bloco anunciado por dois-pontos e que começa com letra maiúscula. Transcrição sem anúncio, ou anunciada de outro jeito, continua dependendo dos avisos antigos (TRANSCRIÇÃO, PARECER DO MPC, ENTRE ASPAS), que olham só os 200 caracteres antes do trecho.
- O aviso da concessiva só cobre a concessiva negativa ("ainda que não", "embora não") e só existe na verificação do trecho, não no recibo.
- A metade de palavra depois de prefixo negativo ("im-" + "procedente") só é recusada quando o próprio documento traz essa quebra com hífen; "não procedente" escrito com espaço continua dependendo do aviso NEGAÇÃO.
- A seção da ementa em texto achatado (sem quebra de linha) não foi tratada: nas ementas guardadas as seções vêm em linhas próprias e todas foram reconhecidas.

Depois da medição cega e do reataque:

- Reforço depois da medição cega (25/10/2026): certidão de julgamento ("Participaram do julgamento…", "Porto Velho, [data]", assinatura), qualificação de parte ou advogado (CPF, OAB, "na qualidade de", sessão virtual) e cabeçalho de página do PDF dentro do trecho já não dão "✅ VÁLIDO" pleno; e "sem pronúncia/declaração de nulidade" antes do trecho dispara o aviso de negação. Na mesma amostra de 120 trechos, o selo pleno ficou com 0 falso em 28 (antes, 3 em 33); esse ajuste foi feito sobre a própria amostra, então ainda não é validação.
- Segunda medição (amostra nova de validação, 120 trechos): o selo pleno teve 1 falso em 33 (3,0%; IC95% 0,08 a 15,8%), contra 3 em 33 antes das guardas. Depois do reataque: o `[...]` que tira uma negativa ("[...] se presta" no texto "não se presta"; vale também para a 1.7.6 publicada) agora avisa NEGAÇÃO OMITIDA NO CORTE e tira o selo pleno; "voto do Relator, vencido o Conselheiro X" não faz mais do relator o vencido; aberturas de voto ("Passo ao exame", "É o necessário a relatar", "Feito o breve relato") contam como início do voto no fecho; o endereço do cabeçalho de página do PDF (Av. Presidente Dutra, CEP) não é voz do colegiado.
- Limitações da 1.7.7: lei transcrita na ementa sem dois-pontos nem aspas ("conforme art. 1.022 do CPC, para…") ainda pode sair com selo pleno; "Trata-se de…" na ementa de modelo antigo também; o aviso de decisão transcrita chama de "decisão de origem" a decisão de outro tribunal anunciada como transcrição; os avisos "voz não confirmada" são conservadores (62% eram voz do órgão).

## 1.7.6

Correções de conferência, encontradas numa revisão adversarial.

- O número do acórdão é aceito em várias grafias ("55/2026", "APL-TC 00055/26", "Acórdão 0000055/26", "55 / 26") e normalizado antes de buscar, obter, verificar ou procurar julgados que citam. Número fora do formato é recusado com mensagem de formato, nunca com "nenhuma decisão encontrada".
- Acórdão de outra sigla com o mesmo número (por exemplo, AC1-TC e APL-TC 00120/25) deixou de ser descartado calado como "o próprio julgado": aparece num bloco à parte, para você conferir.
- O voto do próprio relator não é mais apresentado como "de outro conselheiro" quando a autuação do PDF vem em duas colunas; sem relator confiável, nenhum voto é atribuído a outro conselheiro.

## 1.7.5

Correções de conferência de citação, encontradas numa revisão adversarial.

- Quando o acórdão foi julgado por maioria, o trecho do voto vencido de um conselheiro deixou de ser apresentado como voto condutor. A ferramenta avisa que o julgamento foi por maioria, diz quem ficou vencido e marca com alerta a frase que vem do voto vencido, para que ela não seja citada como fundamento do Tribunal.
- Citação com reticências [...] que emenda um trecho da ementa a um trecho distante do voto vencido agora é recusada: a frase montada não existe no acórdão e daria a entender que o Tribunal disse o que só o vencido disse.
- Os testes automáticos passaram a rodar numa pasta temporária isolada, sem ler nem gravar nada na pasta da extensão no seu computador. Nenhuma pesquisa muda por isso.

## 1.7.4

A checagem de versão nova agora acontece no máximo uma vez por semana: a extensão registra a data da última checagem no seu computador e, nas outras sessões, só lembra da versão já vista. Nada da pesquisa sai do computador.

## 1.7.3

O campo autor da extensão agora mostra @robertogrecia. Nenhuma ferramenta mudou.

## 1.7.2

O subtítulo da extensão agora traz o crédito do autor e a descrição foi reescrita em parágrafos, em linguagem acessível a advogados. Nenhuma ferramenta mudou.

## 1.7.1

A descrição da extensão, mostrada ao instalar ou atualizar, agora diz quem a criou e, em linguagem simples, o que ela faz. Nenhuma ferramenta mudou.

## 1.7.0 — 15/10/2026

Porte Node do `servidor_tcero.py` v1.7.0 (commit 785c88a). Só muda a saída das ferramentas; o recibo é o da 1.6.0 (21 campos, mesma ordem e serialização; teste compara byte a byte com um recibo gravado pela 1.6.0, `test/fixtures/recibo_v160_98114.json`). Mesmas frases do Python.

- NOVA `julgados_que_citam_tcero(numero, limite=10)`: quem cita um processo ou acórdão (NNNNN/AA), por texto. UMA consulta ao portal (`textoLivre` entre aspas) + recibos locais (sem rede); o filtro local do número (`(?<![\d/])0*N\s?/\s?AA(?!\d|/\d)`) decide quem entra, descarta o próprio julgado e dispensa um portal que não honre a frase. Avisos fixos: não detecta superação, zero não prova nada, recall baixo (PDF não é varrido). Falha do portal: `[PESQUISA NÃO REALIZADA no portal]`. Código em `server/v170.js`.
- TESE DA EMENTA (literal) na busca, na triagem e no modo completo, com `⚠️ TESE INCOMPLETA` quando cortada em 1.000 caracteres. Rótulo "Tese de julgamento"; seções procuradas na ordem "dispositivo e tese", "dispositivo", "entendimento". Nunca entra no recibo.
- VOZ DA CASA em `verificar_citacao_tcero`: linha `ℹ`, na chave nova `notas` do resultado do verificador; `alertas` mantém o contrato (vazio = nada a avisar).
- Placar de consultas e nível do limitador na última linha da busca.
- Aviso de consulta pouco seletiva a partir de 1.000 resultados do portal (no lugar da "Dica: total alto", que segue entre 200 e 999).
- Saída da busca cortada na fronteira de um resultado, com a nota "Cortei na fronteira do resultado".
- Texto do `sugerir_termos` (README): rotulagem cega, 26% pertinentes nos dois anotadores (não 59%).
- Testes: `test/v170.test.js` (um bloco por item e o recibo idêntico) e `test/paridade.py` estendido (as 1.141 ementas da fixture passam pela tese; julgados_que_citam ponta a ponta; 0 divergências reais).
- Divergência registrada, já existente e fora deste porte: decisão sem o campo `situacao` sai com "undefined" no Node e "None" no Python na linha "Situação (campo `situacao`)"; o portal sempre envia o campo.

## 1.6.0 — 15/10/2026

Porte Node do `servidor_tcero.py` v1.6.0 (commit 4f8fbf7). Mesmas ferramentas, parâmetros e frases de saída.

- `buscar_recibos_tcero`: busca sem rede nos recibos locais (campo `texto`, nunca o texto de IA), palavra inteira, "frase" e `prefixo*`, posição e página aproximada. O recibo não ganhou nenhum campo (o lint da peticao-rg continua lendo igual).
- Diário de erros (`erros.jsonl`, 0600, poda acima de 400 KB, mensagem sanitizada) e `diagnostico_erros_tcero`.
- `linha_do_tempo_tcero` e `sugerir_termos_tcero` (com `server/fundo_vocabulario.json` dentro do .mcpb). Estimativa original de 59% pertinentes (corrigido na 1.7.0: 26% na rotulagem cega).
- `obter_acordao_tcero(modo="triagem")`: mesmo recibo do modo completo.
- Alertas que dizem onde: frase do OBITER, título do VOTO de outro conselheiro e `p. ~N de M do PDF`.
- `COMO_ATUALIZAR` no aviso de versão e no rodapé de erro.
- NOVA, só do pacote Node: `atualizar_extensao_tcero`. Sem `confirmar=true` só informa; com ele baixa o .mcpb para Downloads (SHA-256 conferido) e manda dar dois cliques. Nunca instala sozinha.
- Erro de entrada do usuário (equivalente ao ValueError do Python) passa a sair sem o rodapé de erro de portal, como no Python.
- Divergência deliberada: na triagem, o rótulo "VOTO de outro conselheiro" pula o cabeçalho de página colado ao título (o pdf.js não deixa linhas em branco entre os dois).
