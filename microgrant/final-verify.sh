#!/usr/bin/env bash
# Re-runs every contract and frontend check against the current source and writes logs to
# microgrant/evidence/final/. Read-only toward the chain: it sends no transactions and needs no key.
#   bash microgrant/final-verify.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT=microgrant/evidence/final
mkdir -p "$OUT"
TESTNET_RPC=https://rpc.testnet.arc.io
TESTNET_FACTORY=0x1ddac1a17d437a43ba09591d338954516721f0a7

( sha256sum contracts/SeldraOrder.sol contracts/SeldraFactory.sol contracts/foundry.toml; ls contracts/test/*.sol | xargs sha256sum ) > "$OUT/source-hashes.txt"
forge --version | head -1 > "$OUT/toolchain.txt"
bun --version | sed 's/^/bun /' >> "$OUT/toolchain.txt"

cd contracts
forge clean && forge build > "../$OUT/forge-build.log" 2>&1; echo "exit $?" >> "../$OUT/forge-build.log"
forge test > "../$OUT/forge-test.log" 2>&1; echo "exit $?" >> "../$OUT/forge-test.log"

cd ../seldra-studio
cp src/abi.generated.ts /tmp/abi.before
bun scripts/sync-abi.ts > "../$OUT/abi-sync.log" 2>&1
if cmp -s /tmp/abi.before src/abi.generated.ts; then echo "abi.generated.ts matches the final artifacts" >> "../$OUT/abi-sync.log"; else echo "ABI DIFFERS from the final artifacts" >> "../$OUT/abi-sync.log"; fi
bun run typecheck > "../$OUT/frontend-typecheck.log" 2>&1; echo "exit $?" >> "../$OUT/frontend-typecheck.log"
bun run lint > "../$OUT/frontend-lint.log" 2>&1; echo "exit $?" >> "../$OUT/frontend-lint.log"
bun test tests > "../$OUT/frontend-test.log" 2>&1; echo "exit $?" >> "../$OUT/frontend-test.log"
bun run build > "../$OUT/frontend-build-testnet.log" 2>&1; echo "exit $?" >> "../$OUT/frontend-build-testnet.log"
VITE_NETWORK=arc-mainnet bunx vite build --outDir /tmp/dist-mainnet > "../$OUT/frontend-build-mainnet-config.log" 2>&1; echo "exit $?" >> "../$OUT/frontend-build-mainnet-config.log"
bun scripts/verify-deployment.ts "$TESTNET_RPC" "$TESTNET_FACTORY" > "../$OUT/verify-deployment-testnet.log" 2>&1; echo "exit $?" >> "../$OUT/verify-deployment-testnet.log"

cd ..
if sha256sum contracts/SeldraOrder.sol contracts/SeldraFactory.sol | diff - <(head -2 "$OUT/source-hashes.txt") > /dev/null; then
  echo "contract sources unchanged during verification" > "$OUT/source-unchanged.txt"
else
  echo "CONTRACT SOURCES CHANGED DURING VERIFICATION" > "$OUT/source-unchanged.txt"
fi
echo finished
