import type { Abi, Address } from 'viem';

export const FACTORY_ADDRESS = '0x934159C33C25D0b2e27B237b4cA603D85F019Cf3' as Address;
export const DEMO_A_ORDER = '0x60958fd86d2d52670181afb4097d1b280a37848c' as Address;
export const DEMO_B_ORDER = '0x6ff65de6016d9e1083b2f7d7e3abaff1ab2c9201' as Address;

export const factoryAbi = [
  {
    type: 'event',
    name: 'OrderCreated',
    inputs: [
      { indexed: true, name: 'order', type: 'address' },
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: true, name: 'supplier', type: 'address' },
      { indexed: false, name: 'arbiter', type: 'address' },
      { indexed: false, name: 'orderAmount', type: 'uint256' },
      { indexed: false, name: 'depositBps', type: 'uint16' },
      { indexed: false, name: 'fallbackSupplierBps', type: 'uint16' },
      { indexed: false, name: 'fundingDeadline', type: 'uint256' },
      { indexed: false, name: 'shipmentDeadline', type: 'uint256' },
      { indexed: false, name: 'buyerDecisionDeadline', type: 'uint256' },
      { indexed: false, name: 'disputeDeadline', type: 'uint256' },
      { indexed: false, name: 'termsHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'createOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'buyer', type: 'address' },
      { name: 'supplier', type: 'address' },
      { name: 'arbiter', type: 'address' },
      { name: 'orderAmount', type: 'uint256' },
      { name: 'depositBps', type: 'uint16' },
      { name: 'fallbackSupplierBps', type: 'uint16' },
      { name: 'fundingDeadline', type: 'uint256' },
      { name: 'shipmentDeadline', type: 'uint256' },
      { name: 'buyerDecisionDeadline', type: 'uint256' },
      { name: 'disputeDeadline', type: 'uint256' },
    ],
    outputs: [{ name: 'order', type: 'address' }],
  },
] as const satisfies Abi;

export const orderAbi = [
  { type: 'event', name: 'SupplierAccepted', inputs: [{ indexed: true, name: 'acceptedAt', type: 'uint256' }] },
  { type: 'event', name: 'OrderCancelled', inputs: [{ indexed: true, name: 'cancelledAt', type: 'uint256' }] },
  { type: 'event', name: 'Funded', inputs: [{ indexed: false, name: 'amount', type: 'uint256' }, { indexed: false, name: 'deposit', type: 'uint256' }, { indexed: false, name: 'reserve', type: 'uint256' }] },
  { type: 'event', name: 'DepositReleased', inputs: [{ indexed: true, name: 'supplier', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }] },
  { type: 'event', name: 'ExcessReturned', inputs: [{ indexed: true, name: 'recipient', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }] },
  { type: 'event', name: 'ShipmentSubmitted', inputs: [{ indexed: true, name: 'evidenceHash', type: 'bytes32' }, { indexed: true, name: 'submittedAt', type: 'uint256' }] },
  { type: 'event', name: 'DisputeOpened', inputs: [{ indexed: true, name: 'reasonHash', type: 'bytes32' }, { indexed: true, name: 'openedAt', type: 'uint256' }] },
  { type: 'event', name: 'Settled', inputs: [{ indexed: true, name: 'outcome', type: 'uint8' }, { indexed: false, name: 'supplierAmount', type: 'uint256' }, { indexed: false, name: 'buyerAmount', type: 'uint256' }, { indexed: true, name: 'settledAt', type: 'uint256' }] },
  { type: 'function', name: 'buyer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'supplier', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'arbiter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'orderAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'depositAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'depositBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'fallbackSupplierBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'fundingDeadline', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'shipmentDeadline', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyerDecisionDeadline', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'disputeDeadline', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'termsHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'outcome', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'reserveRemaining', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'shipmentEvidenceHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'disputeReasonHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'accountingInvariant', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'acceptOrder', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'cancelBeforeFunding', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'submitShipment', stateMutability: 'nonpayable', inputs: [{ name: 'evidenceHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'approveShipment', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'openDispute', stateMutability: 'nonpayable', inputs: [{ name: 'reasonHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'resolveDispute', stateMutability: 'nonpayable', inputs: [{ name: 'supplierPayout', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimShipmentDeadlineRefund', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'claimBuyerDecisionTimeout', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'claimDisputeFallback', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const satisfies Abi;

export type OrderCreatedLog = {
  order: Address;
  buyer: Address;
  supplier: Address;
  arbiter: Address;
  orderAmount: bigint;
  depositBps: number;
  fallbackSupplierBps: number;
  fundingDeadline: bigint;
  shipmentDeadline: bigint;
  buyerDecisionDeadline: bigint;
  disputeDeadline: bigint;
  termsHash: `0x${string}`;
  blockNumber?: bigint;
  transactionHash?: `0x${string}`;
};
