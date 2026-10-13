import { encodeFunctionData, parseAbi } from 'viem';

// Read-only Arc mainnet diagnostics, pinned to a documented Seldra order.
// No wallet, private keys, API credentials, signing, or transaction broadcasts.
const ORDER = '0x7BE2440da225495735957B4b206A4ab4998372Fa';
const FACTORY = '0x934159C33C25D0b2e27B237b4cA603D85F019Cf3';
const CREATE_TX = '0x6b2ce2c5d43f5a68aca384bae810aefd2aa0fd6962a2d4f211c4bf7ce267137b';
const BLOCK = '0x' + (24754291).toString(16);
const ENDPOINTS = ['https://rpc.mainnet.arc.io', 'https://arc-rpc.publicnode.com', 'https://arc.drpc.org'];
const selectors = [
'buyer() view returns (address)', 'supplier() view returns (address)',
'arbiter() view returns (address)', 'orderAmount() view returns (uint256)',
'depositAmount() view returns (uint256)', 'reserveAmount() view returns (uint256)',
'depositBps() view returns (uint16)', 'fallbackSupplierBps() view returns (uint16)',
'fundingDeadline() view returns (uint256)', 'shipmentDeadline() view returns (uint256)',
'buyerDecisionDeadline() view returns (uint256)', 'disputeDeadline() view returns (uint256)',
'termsHash() view returns (bytes32)', 'status() view returns (uint8)',
'outcome() view returns (uint8)', 'reserveRemaining() view returns (uint256)',
'shipmentEvidenceHash() view returns (bytes32)', 'disputeReasonHash() view returns (bytes32)',
'accountingInvariant() view returns (bool)', 'acceptedAt() view returns (uint256)',
'fundedAt() view returns (uint256)', 'shipmentSubmittedAt() view returns (uint256)',
];
const abi = parseAbi(selectors.map(v => 'function ' + v));
let failures = 0;

async function rpc(endpoint, method, params) {
  const start = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }),
      signal: AbortSignal.timeout(9000),
    });
    const body = await response.text();
    let json;
    try { json = JSON.parse(body); } catch { json = {}; }
    const summary = { ms: Date.now()-start, http: response.status, ok: response.ok && !json.error && json.result !== undefined };
    if (json.error) { summary.rpcCode = json.error.code; summary.rpcMessage = String(json.error.message).slice(0,240); }
    if (!response.ok && !json.error) summary.responsePrefix = body.slice(0,140);
    if (summary.ok) {
      if (method === 'eth_getLogs') summary.logCount = Array.isArray(json.result) ? json.result.length : '?';
      else if (method === 'eth_getCode') summary.codeBytes = typeof json.result === 'string' ? (json.result.length-2)/2 : '?';
      else if (method === 'eth_getTransactionByHash') summary.txFound = Boolean(json.result);
      else if (method === 'eth_call') summary.hasReturnData = typeof json.result === 'string' && json.result.length>2;
      else summary.value = String(json.result).slice(0,84);
    }
    if (!summary.ok) failures++;
    return summary;
  } catch (error) {
    failures++;
    return { ok:false, ms:Date.now()-start, exception:error.name, message:String(error.message).slice(0,210) };
  }
}

for (const endpoint of ENDPOINTS) {
  console.log('\nPROVIDER', endpoint);
  for (const [name, method, params] of [
    ['chainId','eth_chainId',[]],
    ['latestBlock','eth_blockNumber',[]],
    ['orderBytecode','eth_getCode',[ORDER,'latest']],
    ['orderNativeBalance','eth_getBalance',[ORDER,'latest']],
    ['factoryCreationLogs','eth_getLogs',[{address:FACTORY,fromBlock:BLOCK,toBlock:BLOCK}]],
    ['creationTransaction','eth_getTransactionByHash',[CREATE_TX]],
  ]) console.log(JSON.stringify({name,...await rpc(endpoint,method,params)}));
  const calls=selectors.map((selector,i)=>({name: selector.split('(')[0],data:encodeFunctionData({abi,functionName:selector.split('(')[0]})}));
  for(let i=0;i<calls.length;i+=4) {
    const group=await Promise.all(calls.slice(i,i+4).map(async x=>({name:x.name,...await rpc(endpoint,'eth_call',[{to:ORDER,data:x.data},'latest'])})));
    group.forEach(row=>console.log(JSON.stringify(row)));
  }
}
console.log('\nPROBE_DONE',JSON.stringify({failedRequests:failures}));
if (failures) process.exitCode=1;
