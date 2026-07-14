/**
 * Compiles AgentMandate.sol with solc-js (WASM — the one Solidity toolchain that runs on this
 * win32-arm64 machine; Hardhat compiles the same source in CI). Exports the artifact for the
 * deploy script; run standalone to sanity-check the contract compiles:
 *   npx tsx agent/scripts/compile-mandate.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require_ = createRequire(import.meta.url);

export interface MandateArtifact {
  abi: unknown[];
  bytecode: `0x${string}`;
}

export function compileMandate(): MandateArtifact {
  const solc = require_('solc') as { compile(input: string): string };
  const sourcePath = path.resolve(process.cwd(), 'contracts/contracts/AgentMandate.sol');
  const input = {
    language: 'Solidity',
    sources: { 'AgentMandate.sol': { content: readFileSync(sourcePath, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
  };
  const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`solc errors:\n${errors.map((e) => e.formattedMessage).join('\n')}`);
  }
  const contract = output.contracts?.['AgentMandate.sol']?.['AgentMandate'];
  if (!contract) throw new Error('AgentMandate not found in solc output');
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

if (process.argv[1]?.endsWith('compile-mandate.ts')) {
  const { abi, bytecode } = compileMandate();
  console.log(`compiled OK: ${(bytecode.length - 2) / 2} bytes of bytecode, ${abi.length} ABI entries`);
}
