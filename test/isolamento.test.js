// Guarda da rodada 3 do red team (22/10/2026): a suíte nunca grava na pasta real do usuário. lib.js fixa a pasta do disjuntor e a dos
// recibos na CARGA do módulo; se algum teste importar lib.js antes de _isolar.mjs, este arquivo pega (mesmo processo, mesma ordem).
import "./_isolar.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import * as L from "../server/lib.js";
import * as V from "../server/v160.js";

const homeReal = process.env.TCERO_TESTE_HOME_REAL;
const dentroDe = (p, base) => { const r = path.relative(path.resolve(base), path.resolve(p)); return r && !r.startsWith("..") && !path.isAbsolute(r); };

test("rodada 3: estado do disjuntor, recibos, diário de erros e aviso de versão ficam em os.tmpdir(), nunca em ~/.tcero-*", () => {
  assert.ok(process.env.TCERO_TESTE_ISOLADO, "_isolar.mjs não rodou antes de lib.js");
  const caminhos = { disjuntor: L.arquivoEstadoDisjuntor, recibos: L.DIR_RECIBOS, estado: V.dirEstado(), aviso: process.env.TCERO_MCP_ARQUIVO_AVISO_VERSAO, home: os.homedir() };
  for (const [nome, p] of Object.entries(caminhos)) {
    assert.ok(dentroDe(p, os.tmpdir()), `${nome} fora de os.tmpdir(): ${p}`);
    assert.ok(!path.resolve(p).startsWith(path.join(homeReal, ".tcero-jurisprudencia")), `${nome} na pasta real: ${p}`);
  }
});
