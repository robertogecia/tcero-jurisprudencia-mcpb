// Isola a suíte da pasta REAL do usuário (red team 22/10/2026, rodada 3: lib.test.js importava lib.js com o estado do disjuntor em
// ~/.tcero-jurisprudencia e o `npm test` mexia nela). Este módulo roda ANTES de lib.js — pelo `--import` do script `npm test` e, para
// quem roda um arquivo sozinho, pelo `import "./_isolar.mjs"` na 1ª linha de lib.test.js, atualizar.test.js e semana.test.js (a ordem
// dos `import` estáticos é a ordem de avaliação). Tudo o que o servidor grava passa a cair numa pasta nova em os.tmpdir():
//  - TCERO_MCP_DIR_ESTADO (disjuntor, diário de erros), TCERO_MCP_DIR_RECIBOS, TCERO_MCP_ARQUIVO_AVISO_VERSAO;
//  - HOME/USERPROFILE também apontam para lá, para que qualquer os.homedir() esquecido (Downloads, pasta padrão) não chegue à pasta real.
// Os arquivos de teste que já fixam a própria pasta temporária (v160, v170, redteam) continuam valendo: sobrescrevem estas variáveis.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.TCERO_TESTE_ISOLADO) {
  const homeReal = os.homedir();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tcero-teste-"));
  const home = path.join(base, "home");
  fs.mkdirSync(home, { recursive: true });
  process.env.TCERO_TESTE_ISOLADO = base;
  process.env.TCERO_TESTE_HOME_REAL = homeReal;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TCERO_MCP_DIR_ESTADO = path.join(base, "estado");
  process.env.TCERO_MCP_DIR_RECIBOS = path.join(base, "recibos");
  process.env.TCERO_MCP_ARQUIVO_AVISO_VERSAO = path.join(base, "aviso-versao.json");
  process.env.TCERO_MCP_SEM_AVISO_ATUALIZACAO = "1";
  process.on("exit", () => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* pasta temporária: o SO limpa */ }
  });
}
