# Changelog — Jurisprudência TCE-RO (.mcpb)

O histórico anterior (1.2.0 a 1.5.3) está no fim do `README.md`.

## 1.6.0 — 15/10/2026

Porte Node do `servidor_tcero.py` v1.6.0 (commit 4f8fbf7). Mesmas ferramentas, parâmetros e frases de saída.

- `buscar_recibos_tcero`: busca sem rede nos recibos locais (campo `texto`, nunca o texto de IA), palavra inteira, "frase" e `prefixo*`, posição e página aproximada. O recibo não ganhou nenhum campo (o lint da peticao-rg continua lendo igual).
- Diário de erros (`erros.jsonl`, 0600, poda acima de 400 KB, mensagem sanitizada) e `diagnostico_erros_tcero`.
- `linha_do_tempo_tcero` e `sugerir_termos_tcero` (com `server/fundo_vocabulario.json` dentro do .mcpb).
- `obter_acordao_tcero(modo="triagem")`: mesmo recibo do modo completo.
- Alertas que dizem onde: frase do OBITER, título do VOTO de outro conselheiro e `p. ~N de M do PDF`.
- `COMO_ATUALIZAR` no aviso de versão e no rodapé de erro.
- NOVA, só do pacote Node: `atualizar_extensao_tcero`. Sem `confirmar=true` só informa; com ele baixa o .mcpb para Downloads (SHA-256 conferido) e manda dar dois cliques. Nunca instala sozinha.
- Erro de entrada do usuário (equivalente ao ValueError do Python) passa a sair sem o rodapé de erro de portal, como no Python.
- Divergência deliberada: na triagem, o rótulo "VOTO de outro conselheiro" pula o cabeçalho de página colado ao título (o pdf.js não deixa linhas em branco entre os dois).
