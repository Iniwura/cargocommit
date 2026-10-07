#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <rpc-url> <estimate-sender-address>" >&2
  exit 2
fi

rpc_url=$1
estimate_sender=$2
cast_bin=${ARC_CAST_BIN:-arc-cast}
forge_bin=${ARC_FORGE_BIN:-arc-forge}
expected_chain_id=${ARC_CHAIN_ID:-5042}
principal=1000000000000000000

chain_id=$($cast_bin rpc eth_chainId --rpc-url "$rpc_url" --raw '[]' | tr -d '"')
expected_chain_hex=0x$(printf '%x' "$expected_chain_id")
if [[ "$chain_id" != "$expected_chain_hex" ]]; then
  echo "unexpected chain id: $chain_id (expected $expected_chain_hex)" >&2
  exit 1
fi

gas_price=$($cast_bin gas-price --rpc-url "$rpc_url" | tr -d '"' | awk '{print $1}')
balance_hex=$($cast_bin rpc eth_getBalance --rpc-url "$rpc_url" --raw "[\"$estimate_sender\",\"latest\"]" | tr -d '"')
balance=$($cast_bin to-dec "$balance_hex")

factory_bytecode=$($forge_bin inspect CargoCommitFactory bytecode)
factory_bytecode_hash=$(printf '%s' "$factory_bytecode" | sha256sum | awk '{print $1}')
factory_gas=$($cast_bin estimate --from "$estimate_sender" --rpc-url "$rpc_url" --create "$factory_bytecode" | awk '{print $1}')
factory_cost=$($cast_bin estimate --from "$estimate_sender" --rpc-url "$rpc_url" --cost --create "$factory_bytecode" | awk '{print $1}')

# These are fresh Arc-compatible local observations for the first 1 USDC success path.
# The factory deployment gas is replaced with the fresh RPC estimate above.
local_create_gas=2129690
local_accept_gas=67096
local_fund_gas=86313
local_submit_gas=75635
local_approve_gas=64837
success_gas=$((factory_gas + local_create_gas + local_accept_gas + local_fund_gas + local_submit_gas + local_approve_gas))
gas_component=$((success_gas * gas_price))
conservative_required=$((principal + gas_component * 2))

printf 'chain_id=%s\n' "$expected_chain_id"
printf 'rpc=%s\n' "$rpc_url"
printf 'estimate_sender=%s\n' "$estimate_sender"
printf 'native_balance_wei=%s\n' "$balance"
printf 'gas_price_wei=%s\n' "$gas_price"
printf 'factory_bytecode_sha256=%s\n' "$factory_bytecode_hash"
printf 'factory_deployment_gas=%s\n' "$factory_gas"
printf 'factory_deployment_cost_native_usdc=%s\n' "$factory_cost"
printf 'observed_local_arc_success_path_gas=%s\n' "$success_gas"
printf 'success_path_gas_component_wei=%s\n' "$gas_component"
printf 'demo_principal_wei=%s\n' "$principal"
printf 'conservative_required_wei=%s\n' "$conservative_required"
if (( balance >= conservative_required )); then
  echo 'estimate_balance_status=sufficient_for_estimate_sender_only'
else
  echo 'estimate_balance_status=insufficient_for_estimate_sender'
fi
echo 'demo_gas_note=order-creation-and-flow gas uses fresh Arc-compatible local observations until a factory/order exists on the target network'
