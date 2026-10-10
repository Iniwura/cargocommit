# CargoCommit deployment and demo checklist

This document preserves the original controlled deployment checklist. Actual Arc mainnet deployments and tiny-value transactions have since completed. Consult [MAINNET_PROOF.md](MAINNET_PROOF.md) for verified addresses, receipts and readbacks; do not rerun these historical deployment commands against mainnet. No credentials are included.

## Arc-specific local rehearsal

Install the official Arc Foundry release and verify the checksum. The current verified binaries are `arc-forge`, `arc-cast`, and `arc-anvil`.

Start a local Arc-compatible node in a persistent terminal:

```bash
arc-anvil --network arc --port 18545 --quiet
```

Verify the node before using it:

```bash
arc-cast rpc eth_chainId --rpc-url http://127.0.0.1:18545 --raw '[]'
arc-cast rpc anvil_nodeInfo --rpc-url http://127.0.0.1:18545
```

The first command must return `0x7a69` (`31337`), and `anvil_nodeInfo` must report `network: "arc"`.

Run the contract suite under Arc semantics:

```bash
FOUNDRY_PROFILE=arc arc-forge test --network arc -vv
```

The local node is ephemeral and uses only public development accounts. Never use those accounts on mainnet.

## Mainnet preflight, without broadcast

Set only non-secret values in the shell or in a private, ignored configuration file:

```bash
export ARC_RPC_URL=https://rpc.mainnet.arc.io
export ARC_CHAIN_ID=5042
export ARC_DEPLOYER_ADDRESS=0x...
export ARC_ACCOUNT_NAME=cargocommit-arc-deployer
```

Confirm the deployer address separately from the encrypted Foundry account without exporting its key:

```bash
arc-cast wallet list
arc-cast wallet address --account "$ARC_ACCOUNT_NAME"
```

Read-only checks:

```bash
arc-cast rpc eth_chainId --rpc-url "$ARC_RPC_URL" --raw '[]'
arc-cast balance "$ARC_DEPLOYER_ADDRESS" --rpc-url "$ARC_RPC_URL" --ether
forge build
sha256sum out/CargoCommitFactory.sol/CargoCommitFactory.json out/CargoCommitOrder.sol/CargoCommitOrder.json
```

Estimate factory deployment without broadcasting:

```bash
arc-forge script script/Deploy.s.sol:DeployCargoCommitFactory \
  --rpc-url "$ARC_RPC_URL" \
  --account "$ARC_ACCOUNT_NAME" \
  --sender "$ARC_DEPLOYER_ADDRESS"
```

Estimate factory order creation without broadcasting:

```bash
arc-cast estimate "$ARC_FACTORY_ADDRESS" \
  'createOrder(address,address,address,uint256,uint16,uint16,uint256,uint256,uint256,uint256)' \
  "$BUYER" "$SUPPLIER" "$ARBITER" \
  1000000000000000000 3000 5000 \
  "$FUNDING_DEADLINE" "$SHIPMENT_DEADLINE" "$BUYER_DECISION_DEADLINE" "$DISPUTE_DEADLINE" \
  --from "$ARC_DEPLOYER_ADDRESS" --rpc-url "$ARC_RPC_URL" --cost
```

The required balance must cover factory deployment gas, order creation gas, all demo calls, the `1e18` native-USDC order funding, and a conservative margin for expected reverted protection calls. Arc gas is denominated in native USDC; do not use ERC-20 six-decimal values for `msg.value`.

## Historical broadcast procedure — completed for the documented mainnet deployment

These commands are retained as historical procedure, not instructions to redeploy Seldra. A new deployment would require separate authorization and validation. The encrypted Foundry keystore is selected by name; the raw private key never appears in the command:

```bash
arc-forge script script/Deploy.s.sol:DeployCargoCommitFactory \
  --rpc-url "$ARC_RPC_URL" \
  --account "$ARC_ACCOUNT_NAME" \
  --sender "$ARC_DEPLOYER_ADDRESS" \
  --broadcast
```

Immediately run:

```bash
./script/readback.sh "$ARC_RPC_URL" "$ARC_FACTORY_ADDRESS"
```

Then create an order through the factory. Capture the receipt, block, and `OrderCreated` event before continuing:

```bash
arc-cast send "$ARC_FACTORY_ADDRESS" \
  'createOrder(address,address,address,uint256,uint16,uint16,uint256,uint256,uint256,uint256)' \
  "$BUYER" "$SUPPLIER" "$ARBITER" \
  1000000000000000000 3000 5000 \
  "$FUNDING_DEADLINE" "$SHIPMENT_DEADLINE" "$BUYER_DECISION_DEADLINE" "$DISPUTE_DEADLINE" \
  --account "$ARC_ACCOUNT_NAME" --from "$ARC_DEPLOYER_ADDRESS" \
  --rpc-url "$ARC_RPC_URL"
```

## Tiny-value live proof sequence

Use native units: `1.00 USDC = 1000000000000000000`, deposit `300000000000000000`, reserve `700000000000000000`.

For each transaction, record the transaction hash, receipt status, block number, state before/after, and buyer/supplier/order native balance deltas:

1. Factory `createOrder` and read immutable terms.
2. Supplier `acceptOrder`.
3. Buyer calls `fund` with exactly `1e18`.
4. Verify supplier increased by `0.3e18`; order balance and `reserveRemaining` equal `0.7e18`.
5. Attempt unauthorized/premature reserve release and record the expected revert.
6. Supplier submits a nonzero shipment evidence commitment.
7. Buyer calls `approveShipment`.
8. Verify supplier receives the remaining `0.7e18`, order balance is zero, reserve is zero, and status is `SETTLED`.
9. Use a separate smallest-practical order for the protection proof: fund it, verify reserve accounting, open a dispute, show normal approval/timeout is blocked, and resolve or execute fallback.

Do not claim success from a submitted hash alone; require a successful receipt and matching readback.
