#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <rpc-url> <factory-address> [order-address]" >&2
  exit 2
fi

rpc_url=$1
factory_address=$2
order_address=${3:-}
cast_bin=${ARC_CAST_BIN:-arc-cast}
expected_chain_id=${ARC_CHAIN_ID:-5042}

chain_id=$($cast_bin rpc eth_chainId --rpc-url "$rpc_url" --raw '[]' | tr -d '"')
if [[ "$chain_id" != "0x$(printf '%x' "$expected_chain_id")" ]]; then
  echo "unexpected chain id: $chain_id" >&2
  exit 1
fi

factory_code=$($cast_bin code "$factory_address" --rpc-url "$rpc_url")
if [[ "$factory_code" == "0x" ]]; then
  echo "factory has no deployed bytecode: $factory_address" >&2
  exit 1
fi

echo "chain_id=$expected_chain_id"
echo "factory=$factory_address"
echo "factory_bytecode=present"

if [[ -n "$order_address" ]]; then
  order_code=$($cast_bin code "$order_address" --rpc-url "$rpc_url")
  if [[ "$order_code" == "0x" ]]; then
    echo "order has no deployed bytecode: $order_address" >&2
    exit 1
  fi
  echo "order=$order_address"
  echo "order_bytecode=present"
  echo "buyer=$($cast_bin call "$order_address" 'buyer()(address)' --rpc-url "$rpc_url")"
  echo "supplier=$($cast_bin call "$order_address" 'supplier()(address)' --rpc-url "$rpc_url")"
  echo "arbiter=$($cast_bin call "$order_address" 'arbiter()(address)' --rpc-url "$rpc_url")"
  echo "order_amount=$($cast_bin call "$order_address" 'orderAmount()(uint256)' --rpc-url "$rpc_url")"
  echo "deposit_amount=$($cast_bin call "$order_address" 'depositAmount()(uint256)' --rpc-url "$rpc_url")"
  echo "reserve_amount=$($cast_bin call "$order_address" 'reserveAmount()(uint256)' --rpc-url "$rpc_url")"
  echo "status=$($cast_bin call "$order_address" 'status()(uint8)' --rpc-url "$rpc_url")"
  echo "outcome=$($cast_bin call "$order_address" 'outcome()(uint8)' --rpc-url "$rpc_url")"
  echo "reserve_remaining=$($cast_bin call "$order_address" 'reserveRemaining()(uint256)' --rpc-url "$rpc_url")"
  echo "native_balance=$($cast_bin balance "$order_address" --rpc-url "$rpc_url" --ether)"
fi
