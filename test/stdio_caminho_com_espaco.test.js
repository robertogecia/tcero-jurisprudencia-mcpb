// Regressão do log de 06–15/10/2026: instalado pelo Claude Desktop em ".../Claude Extensions/..."
// (caminho com espaços), o servidor subia e nunca respondia ao `initialize`, porque a guarda de
// conexão comparava `import.meta.url` (espaço = %20) com `process.argv[1]` como texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("responde ao initialize quando instalado em pasta com espaço no caminho", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcero com espaco "));
  fs.cpSync(path.join(raiz, "server"), path.join(dir, "server"), { recursive: true });
  fs.symlinkSync(path.join(raiz, "node_modules"), path.join(dir, "node_modules"));
  fs.copyFileSync(path.join(raiz, "package.json"), path.join(dir, "package.json"));
  const p = spawn(process.execPath, [path.join(dir, "server", "index.js")], {
    env: { ...process.env, TCERO_MCP_SEM_AVISO_ATUALIZACAO: "1" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let saida = "";
  p.stdout.on("data", (d) => (saida += d));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  const inicio = Date.now();
  while (!saida.includes('"id":0') && Date.now() - inicio < 8000) await new Promise((r) => setTimeout(r, 100));
  p.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(saida.includes('"serverInfo"'), `sem resposta ao initialize em ${dir}: ${saida.slice(0, 200)}`);
});
