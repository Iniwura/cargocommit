// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SeldraOrder
/// @notice One buyer/supplier purchase order settled in Arc native USDC.
/// @dev Arc's native gas asset is USDC with 18 decimals in `msg.value`; the ERC-20 view of the same
///      pool has 6 decimals. Every amount in this contract is in 18-decimal native units and
///      `orderAmount` must be a whole multiple of `NATIVE_PER_USDC_UNIT` so it is exactly representable
///      in the 6-decimal view. There is no owner, admin, upgrade path or pause switch. Every exit path is
///      bounded by an immutable deadline.
contract SeldraOrder {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        CREATED,
        ACCEPTED,
        FUNDED,
        SHIPMENT_SUBMITTED,
        DISPUTED,
        SETTLED
    }

    enum Outcome {
        NONE,
        CANCELLED,
        SHIPMENT_DEADLINE_REFUND,
        SUPPLIER_PAID,
        DISPUTE_RESOLVED,
        DISPUTE_FALLBACK
    }

    /// @dev Constructor input, grouped to keep the stack shallow.
    struct Terms {
        address buyer;
        address supplier;
        address arbiter;
        uint256 orderAmount;
        uint16 depositBps;
        uint16 fallbackSupplierBps;
        bytes32 referenceHash;
        uint256 fundingDeadline;
        uint256 shipmentDeadline;
        uint256 buyerDecisionDeadline;
        uint256 disputeDeadline;
    }

    /// @dev Single-call read model for front ends.
    struct Summary {
        address buyer;
        address supplier;
        address arbiter;
        uint256 orderAmount;
        uint256 depositAmount;
        uint256 reserveAmount;
        uint16 depositBps;
        uint16 fallbackSupplierBps;
        bytes32 referenceHash;
        uint256 fundingDeadline;
        uint256 shipmentDeadline;
        uint256 buyerDecisionDeadline;
        uint256 disputeDeadline;
        bytes32 termsHash;
        uint256 createdAtBlock;
        Status status;
        Outcome outcome;
        uint256 reserveRemaining;
        uint256 totalPending;
        uint256 acceptedAt;
        uint256 fundedAt;
        uint256 evidenceSubmittedAt;
        uint256 settledAt;
        bytes32 evidenceHash;
        bytes32 disputeReasonHash;
        uint256 balance;
    }

    // ---------------------------------------------------------------------
    // Constants and immutable terms
    // ---------------------------------------------------------------------

    uint16 public constant BPS = 10_000;
    /// @notice 1e18 native units per 1e6 ERC-20 units: the factor between Arc's two USDC views.
    uint256 public constant NATIVE_PER_USDC_UNIT = 1e12;
    uint256 public constant MAX_TERM = 365 days;
    /// @notice Gas forwarded to a payout recipient. A recipient that fails or exceeds this is credited instead.
    uint256 public constant PAYOUT_GAS = 100_000;

    address public immutable buyer;
    address public immutable supplier;
    address public immutable arbiter;
    uint256 public immutable orderAmount;
    uint256 public immutable depositAmount;
    uint256 public immutable reserveAmount;
    uint16 public immutable depositBps;
    uint16 public immutable fallbackSupplierBps;
    bytes32 public immutable referenceHash;
    uint256 public immutable fundingDeadline;
    uint256 public immutable shipmentDeadline;
    uint256 public immutable buyerDecisionDeadline;
    uint256 public immutable disputeDeadline;
    bytes32 public immutable termsHash;
    uint256 public immutable createdAtBlock;

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    Status public status;
    Outcome public outcome;
    uint256 public reserveRemaining;
    /// @notice Sum of credits owed to recipients whose payout call failed. Always backed by contract balance.
    uint256 public totalPending;
    uint256 public acceptedAt;
    uint256 public fundedAt;
    uint256 public evidenceSubmittedAt;
    uint256 public settledAt;
    bytes32 public evidenceHash;
    bytes32 public disputeReasonHash;
    mapping(address account => uint256 amount) public pendingWithdrawals;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------------
    // Errors and events
    // ---------------------------------------------------------------------

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBps();
    error InvalidDeadlines();
    error InvalidStatus();
    error NotBuyer();
    error NotSupplier();
    error NotArbiter();
    error FundingAmountMismatch(uint256 supplied, uint256 required);
    error DeadlinePassed();
    error DeadlineNotPassed();
    error MissingCommitment();
    error InvalidPayout(uint256 requested, uint256 available);
    error AccountingMismatch(uint256 balance, uint256 requiredBacking);
    error NothingToWithdraw();
    error WithdrawFailed();
    error Reentrancy();
    error DirectTransferRejected();

    event TermsAccepted(address indexed supplier, uint256 timestamp);
    event OrderCancelled(address indexed by, uint256 timestamp);
    event Funded(address indexed buyer, uint256 amount, uint256 deposit, uint256 reserve);
    event DepositPaid(address indexed supplier, uint256 amount);
    event EvidenceSubmitted(address indexed supplier, bytes32 indexed evidenceHash, uint256 timestamp);
    event ReleaseApproved(address indexed buyer, uint256 timestamp);
    event DisputeOpened(address indexed buyer, bytes32 indexed reasonHash, uint256 timestamp);
    event DisputeResolved(address indexed arbiter, uint256 supplierAmount, uint256 buyerAmount);
    event Settled(Outcome indexed outcome, uint256 supplierAmount, uint256 buyerAmount, uint256 timestamp);
    event PayoutDeferred(address indexed recipient, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);
    event ExcessReturned(address indexed buyer, uint256 amount);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyBuyer() {
        if (msg.sender != buyer) revert NotBuyer();
        _;
    }

    modifier onlySupplier() {
        if (msg.sender != supplier) revert NotSupplier();
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(Terms memory t) {
        if (t.buyer == address(0) || t.supplier == address(0) || t.arbiter == address(0)) revert InvalidAddress();
        if (t.buyer == t.supplier || t.buyer == t.arbiter || t.supplier == t.arbiter) revert InvalidAddress();
        if (t.orderAmount == 0 || t.orderAmount > type(uint128).max || t.orderAmount % NATIVE_PER_USDC_UNIT != 0) {
            revert InvalidAmount();
        }
        if (t.depositBps == 0 || t.depositBps >= BPS || t.fallbackSupplierBps > BPS) revert InvalidBps();
        if (
            t.fundingDeadline <= block.timestamp || t.shipmentDeadline <= t.fundingDeadline
                || t.buyerDecisionDeadline <= t.shipmentDeadline || t.disputeDeadline <= t.buyerDecisionDeadline
                || t.disputeDeadline > block.timestamp + MAX_TERM
        ) revert InvalidDeadlines();

        buyer = t.buyer;
        supplier = t.supplier;
        arbiter = t.arbiter;
        orderAmount = t.orderAmount;
        depositBps = t.depositBps;
        fallbackSupplierBps = t.fallbackSupplierBps;
        referenceHash = t.referenceHash;
        fundingDeadline = t.fundingDeadline;
        shipmentDeadline = t.shipmentDeadline;
        buyerDecisionDeadline = t.buyerDecisionDeadline;
        disputeDeadline = t.disputeDeadline;
        createdAtBlock = block.number;

        uint256 deposit = (t.orderAmount * t.depositBps) / BPS;
        depositAmount = deposit;
        reserveAmount = t.orderAmount - deposit;
        termsHash = keccak256(abi.encode(block.chainid, address(this), t));
    }

    // ---------------------------------------------------------------------
    // Workflow
    // ---------------------------------------------------------------------

    /// @notice Supplier accepts the exact immutable terms.
    function acceptTerms() external onlySupplier {
        if (status != Status.CREATED) revert InvalidStatus();
        if (block.timestamp > fundingDeadline) revert DeadlinePassed();
        status = Status.ACCEPTED;
        acceptedAt = block.timestamp;
        emit TermsAccepted(msg.sender, block.timestamp);
    }

    /// @notice Closes an unfunded order. The buyer may cancel any time before funding; anyone may close it
    ///         once the funding deadline has passed without funding. No order funds exist in this state.
    function cancelBeforeFunding() external nonReentrant {
        if (status != Status.CREATED && status != Status.ACCEPTED) revert InvalidStatus();
        if (msg.sender != buyer && block.timestamp <= fundingDeadline) revert NotBuyer();

        uint256 balance = address(this).balance;
        if (balance < totalPending) revert AccountingMismatch(balance, totalPending);
        uint256 excess = balance - totalPending;

        status = Status.SETTLED;
        outcome = Outcome.CANCELLED;
        settledAt = block.timestamp;

        emit OrderCancelled(msg.sender, block.timestamp);
        emit Settled(Outcome.CANCELLED, 0, excess, block.timestamp);
        if (excess != 0) {
            emit ExcessReturned(buyer, excess);
            _pay(buyer, excess);
        }
    }

    /// @notice Buyer funds the full order. The production deposit is paid out immediately.
    function fund() external payable onlyBuyer nonReentrant {
        if (status != Status.ACCEPTED) revert InvalidStatus();
        if (block.timestamp > fundingDeadline) revert DeadlinePassed();
        if (msg.value != orderAmount) revert FundingAmountMismatch(msg.value, orderAmount);

        status = Status.FUNDED;
        fundedAt = block.timestamp;
        reserveRemaining = reserveAmount;

        emit Funded(msg.sender, msg.value, depositAmount, reserveAmount);
        emit DepositPaid(supplier, depositAmount);
        _pay(supplier, depositAmount);
    }

    /// @notice Supplier commits a hash of the shipment evidence. The documents themselves stay offchain.
    function submitEvidence(bytes32 evidenceHash_) external onlySupplier nonReentrant {
        if (status != Status.FUNDED) revert InvalidStatus();
        if (block.timestamp > shipmentDeadline) revert DeadlinePassed();
        if (evidenceHash_ == bytes32(0)) revert MissingCommitment();
        status = Status.SHIPMENT_SUBMITTED;
        evidenceHash = evidenceHash_;
        evidenceSubmittedAt = block.timestamp;
        emit EvidenceSubmitted(msg.sender, evidenceHash_, block.timestamp);
    }

    /// @notice Buyer recovers the protected reserve when no evidence was committed by the shipment deadline.
    function claimShipmentRefund() external onlyBuyer nonReentrant {
        if (status != Status.FUNDED) revert InvalidStatus();
        if (block.timestamp <= shipmentDeadline) revert DeadlineNotPassed();
        uint256 reserve = reserveRemaining;
        _settle(Outcome.SHIPMENT_DEADLINE_REFUND, 0, reserve);
    }

    /// @notice Buyer approves the committed evidence and releases the whole reserve to the supplier.
    function approveRelease() external onlyBuyer nonReentrant {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp > buyerDecisionDeadline) revert DeadlinePassed();
        emit ReleaseApproved(msg.sender, block.timestamp);
        uint256 reserve = reserveRemaining;
        _settle(Outcome.SUPPLIER_PAID, reserve, 0);
    }

    /// @notice Supplier collects the reserve when the buyer neither approved nor disputed in time.
    function claimDecisionTimeout() external onlySupplier nonReentrant {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp <= buyerDecisionDeadline) revert DeadlineNotPassed();
        uint256 reserve = reserveRemaining;
        _settle(Outcome.SUPPLIER_PAID, reserve, 0);
    }

    /// @notice Buyer freezes release by committing a hash of the dispute reason.
    function openDispute(bytes32 reasonHash) external onlyBuyer nonReentrant {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp > buyerDecisionDeadline) revert DeadlinePassed();
        if (reasonHash == bytes32(0)) revert MissingCommitment();
        status = Status.DISPUTED;
        disputeReasonHash = reasonHash;
        emit DisputeOpened(msg.sender, reasonHash, block.timestamp);
    }

    /// @notice The immutable arbiter splits only the reserve. The deposit is never at stake.
    function resolveDispute(uint256 supplierPayout) external onlyArbiter nonReentrant {
        if (status != Status.DISPUTED) revert InvalidStatus();
        if (block.timestamp > disputeDeadline) revert DeadlinePassed();
        uint256 reserve = reserveRemaining;
        if (supplierPayout > reserve) revert InvalidPayout(supplierPayout, reserve);
        emit DisputeResolved(msg.sender, supplierPayout, reserve - supplierPayout);
        _settle(Outcome.DISPUTE_RESOLVED, supplierPayout, reserve - supplierPayout);
    }

    /// @notice Deterministic split after the dispute window so a silent arbiter cannot lock funds.
    function claimDisputeFallback() external nonReentrant {
        if (status != Status.DISPUTED) revert InvalidStatus();
        if (block.timestamp <= disputeDeadline) revert DeadlineNotPassed();
        uint256 reserve = reserveRemaining;
        uint256 toSupplier = (reserve * fallbackSupplierBps) / BPS;
        _settle(Outcome.DISPUTE_FALLBACK, toSupplier, reserve - toSupplier);
    }

    /// @notice Pull a credit that could not be pushed during settlement.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        totalPending -= amount;
        emit Withdrawn(msg.sender, amount);
        if (!_send(msg.sender, amount, gasleft())) revert WithdrawFailed();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function orderSummary() external view returns (Summary memory s) {
        s.buyer = buyer;
        s.supplier = supplier;
        s.arbiter = arbiter;
        s.orderAmount = orderAmount;
        s.depositAmount = depositAmount;
        s.reserveAmount = reserveAmount;
        s.depositBps = depositBps;
        s.fallbackSupplierBps = fallbackSupplierBps;
        s.referenceHash = referenceHash;
        s.fundingDeadline = fundingDeadline;
        s.shipmentDeadline = shipmentDeadline;
        s.buyerDecisionDeadline = buyerDecisionDeadline;
        s.disputeDeadline = disputeDeadline;
        s.termsHash = termsHash;
        s.createdAtBlock = createdAtBlock;
        s.status = status;
        s.outcome = outcome;
        s.reserveRemaining = reserveRemaining;
        s.totalPending = totalPending;
        s.acceptedAt = acceptedAt;
        s.fundedAt = fundedAt;
        s.evidenceSubmittedAt = evidenceSubmittedAt;
        s.settledAt = settledAt;
        s.evidenceHash = evidenceHash;
        s.disputeReasonHash = disputeReasonHash;
        s.balance = address(this).balance;
    }

    /// @notice True while the contract balance fully backs the protected reserve plus deferred credits.
    function accountingInvariantHolds() external view returns (bool) {
        return address(this).balance >= reserveRemaining + totalPending;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    receive() external payable {
        revert DirectTransferRejected();
    }

    fallback() external payable {
        revert DirectTransferRejected();
    }

    /// @dev Caller has already established `toSupplier + toBuyer == reserveRemaining`; re-checked here.
    ///      State is finalised before any external call. Forced native value above the backed amount is
    ///      returned to the buyer.
    function _settle(Outcome result, uint256 toSupplier, uint256 toBuyer) private {
        uint256 reserve = reserveRemaining;
        if (toSupplier + toBuyer != reserve) revert InvalidPayout(toSupplier + toBuyer, reserve);
        uint256 backed = reserve + totalPending;
        uint256 balance = address(this).balance;
        if (balance < backed) revert AccountingMismatch(balance, backed);
        uint256 excess = balance - backed;

        reserveRemaining = 0;
        status = Status.SETTLED;
        outcome = result;
        settledAt = block.timestamp;

        uint256 buyerTotal = toBuyer + excess;
        emit Settled(result, toSupplier, buyerTotal, block.timestamp);
        if (excess != 0) emit ExcessReturned(buyer, excess);
        _pay(supplier, toSupplier);
        _pay(buyer, buyerTotal);
    }

    /// @dev Pushes value with a gas cap; on failure the amount is credited for a later `withdraw()`.
    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (!_send(recipient, amount, PAYOUT_GAS)) {
            pendingWithdrawals[recipient] += amount;
            totalPending += amount;
            emit PayoutDeferred(recipient, amount);
        }
    }

    /// @dev Raw call that never copies return data, so a hostile recipient cannot grief with a return bomb.
    function _send(address recipient, uint256 amount, uint256 gasLimit) private returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, recipient, amount, 0, 0, 0, 0)
        }
    }
}
