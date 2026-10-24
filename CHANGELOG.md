# Changelog — Jurisprudência TCE-RO (.mcpb)

O histórico anterior (1.2.0 a 1.5.3) está no fim do `README.md`.

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
