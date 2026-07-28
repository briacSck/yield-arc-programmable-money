/**
 * Compiles AgentMandateV2.sol with solc-js (WASM — the one Solidity toolchain that runs on this
 * win32-arm64 machine; Hardhat's native deps have no arm64 Windows build, so `hardhat compile`
 * fails here with `Cannot find module '@nomicfoundation/solidity-analyzer-win32-arm64-msvc'`).
 * CI compiles the same source on x64 Linux.
 *
 * Mirrors `compile-mandate.ts`. AgentMandateV2.sol is deliberately SELF-CONTAINED — the venue and
 * ERC-20 interfaces are declared in the same file — precisely so this single-source compile needs
 * no import resolver, exactly like v1.
 *
 * Run standalone to sanity-check the contract compiles:
 *   npx tsx agent/scripts/compile-mandate-v2.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require_ = createRequire(import.meta.url);

export interface MandateArtifact {
  abi: unknown[];
  bytecode: `0x${string}`;
}

export function compileMandateV2(): MandateArtifact {
  const solc = require_('solc') as { compile(input: string): string };
  const sourcePath = path.resolve(process.cwd(), 'contracts/contracts/AgentMandateV2.sol');
  const input = {
    language: 'Solidity',
    sources: { 'AgentMandateV2.sol': { content: readFileSync(sourcePath, 'utf8') } },
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
  const contract = output.contracts?.['AgentMandateV2.sol']?.['AgentMandateV2'];
  if (!contract) throw new Error('AgentMandateV2 not found in solc output');
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

if (process.argv[1]?.endsWith('compile-mandate-v2.ts')) {
  const { abi, bytecode } = compileMandateV2();
  console.log(`compiled OK: ${(bytecode.length - 2) / 2} bytes of bytecode, ${abi.length} ABI entries`);
}
