// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title CargoCommitOrder
/// @notice One buyer/supplier purchase order settled in Arc native USDC.
/// @dev All monetary values use Arc native-value units: 1 USDC == 1e18 wei.
contract CargoCommitOrder {
    enum Status {
        CREATED,
        SUPPLIER_ACCEPTED,
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

    uint16 public constant BPS = 10_000;

    address public immutable buyer;
    address public immutable supplier;
    address public immutable arbiter;
    uint256 public immutable orderAmount;
    uint256 public immutable depositAmount;
    uint256 public immutable reserveAmount;
    uint16 public immutable depositBps;
    uint16 public immutable fallbackSupplierBps;
    uint256 public immutable fundingDeadline;
    uint256 public immutable shipmentDeadline;
    uint256 public immutable buyerDecisionDeadline;
    uint256 public immutable disputeDeadline;
    bytes32 public immutable termsHash;

    Status public status = Status.CREATED;
    Outcome public outcome = Outcome.NONE;
    uint256 public reserveRemaining;
    uint256 public acceptedAt;
    uint256 public fundedAt;
    uint256 public shipmentSubmittedAt;
    uint256 public settledAt;
    bytes32 public shipmentEvidenceHash;
    bytes32 public disputeReasonHash;

    uint256 private _reentrancyState = 1;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBps();
    error InvalidDeadlineOrder();
    error InvalidStatus();
    error NotBuyer();
    error NotSupplier();
    error NotArbiter();
    error FundingAmountMismatch();
    error FundingDeadlinePassed();
    error ShipmentDeadlinePassed();
    error BuyerDecisionDeadlinePassed();
    error DisputeDeadlineNotPassed();
    error MissingCommitment();
    error PayoutFailed();
    error Reentrancy();
    error DirectFundingDisabled();
    error UnsupportedCall();
    error InvalidDisputePayout();
    error AccountingMismatch();

    event SupplierAccepted(uint256 indexed acceptedAt);
    event OrderCancelled(uint256 indexed cancelledAt);
    event Funded(uint256 amount, uint256 deposit, uint256 reserve);
    event DepositReleased(address indexed supplier, uint256 amount);
    event ExcessReturned(address indexed recipient, uint256 amount);
    event ShipmentSubmitted(bytes32 indexed evidenceHash, uint256 indexed submittedAt);
    event DisputeOpened(bytes32 indexed reasonHash, uint256 indexed openedAt);
    event Settled(Outcome indexed outcome, uint256 supplierAmount, uint256 buyerAmount, uint256 indexed settledAt);

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
        if (_reentrancyState != 1) revert Reentrancy();
        _reentrancyState = 2;
        _;
        _reentrancyState = 1;
    }

    constructor(
        address buyer_,
        address supplier_,
        address arbiter_,
        uint256 orderAmount_,
        uint16 depositBps_,
        uint16 fallbackSupplierBps_,
        uint256 fundingDeadline_,
        uint256 shipmentDeadline_,
        uint256 buyerDecisionDeadline_,
        uint256 disputeDeadline_
    ) {
        if (buyer_ == address(0) || supplier_ == address(0) || arbiter_ == address(0)) {
            revert InvalidAddress();
        }
        if (buyer_ == supplier_ || buyer_ == arbiter_ || supplier_ == arbiter_) {
            revert InvalidAddress();
        }
        if (orderAmount_ == 0) revert InvalidAmount();
        if (depositBps_ == 0 || depositBps_ >= BPS || fallbackSupplierBps_ > BPS) {
            revert InvalidBps();
        }
        if (
            fundingDeadline_ <= block.timestamp || shipmentDeadline_ <= fundingDeadline_
                || buyerDecisionDeadline_ <= shipmentDeadline_ || disputeDeadline_ <= buyerDecisionDeadline_
        ) revert InvalidDeadlineOrder();

        buyer = buyer_;
        supplier = supplier_;
        arbiter = arbiter_;
        orderAmount = orderAmount_;
        depositBps = depositBps_;
        fallbackSupplierBps = fallbackSupplierBps_;
        fundingDeadline = fundingDeadline_;
        shipmentDeadline = shipmentDeadline_;
        buyerDecisionDeadline = buyerDecisionDeadline_;
        disputeDeadline = disputeDeadline_;
        depositAmount = (orderAmount_ * depositBps_) / BPS;
        reserveAmount = orderAmount_ - depositAmount;
        termsHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                buyer_,
                supplier_,
                arbiter_,
                orderAmount_,
                depositBps_,
                fallbackSupplierBps_,
                fundingDeadline_,
                shipmentDeadline_,
                buyerDecisionDeadline_,
                disputeDeadline_
            )
        );
    }

    function acceptOrder() external onlySupplier {
        if (status != Status.CREATED) revert InvalidStatus();
        if (block.timestamp > fundingDeadline) revert FundingDeadlinePassed();
        status = Status.SUPPLIER_ACCEPTED;
        acceptedAt = block.timestamp;
        emit SupplierAccepted(acceptedAt);
    }

    /// @notice Cancels an unfunded order. No user funds are held in this state.
    function cancelBeforeFunding() external onlyBuyer nonReentrant {
        if (status != Status.CREATED && status != Status.SUPPLIER_ACCEPTED) {
            revert InvalidStatus();
        }
        uint256 excess = address(this).balance;
        status = Status.SETTLED;
        outcome = Outcome.CANCELLED;
        settledAt = block.timestamp;
        _pay(payable(buyer), excess);
        if (excess != 0) emit ExcessReturned(buyer, excess);
        emit OrderCancelled(settledAt);
        emit Settled(outcome, 0, excess, settledAt);
    }

    /// @notice Funds the full immutable order amount and immediately pays the deposit.
    function fund() external payable onlyBuyer nonReentrant {
        if (status != Status.SUPPLIER_ACCEPTED) revert InvalidStatus();
        if (block.timestamp > fundingDeadline) revert FundingDeadlinePassed();
        if (msg.value != orderAmount) revert FundingAmountMismatch();

        status = Status.FUNDED;
        fundedAt = block.timestamp;
        reserveRemaining = reserveAmount;
        emit Funded(msg.value, depositAmount, reserveAmount);
        _pay(payable(supplier), depositAmount);
        emit DepositReleased(supplier, depositAmount);
    }

    function submitShipment(bytes32 evidenceHash) external onlySupplier nonReentrant {
        if (status != Status.FUNDED) revert InvalidStatus();
        if (block.timestamp > shipmentDeadline) revert ShipmentDeadlinePassed();
        if (evidenceHash == bytes32(0)) revert MissingCommitment();
        status = Status.SHIPMENT_SUBMITTED;
        shipmentSubmittedAt = block.timestamp;
        shipmentEvidenceHash = evidenceHash;
        emit ShipmentSubmitted(evidenceHash, shipmentSubmittedAt);
    }

    /// @notice Recovers the still-reserved balance when shipment was not submitted.
    function claimShipmentDeadlineRefund() external onlyBuyer nonReentrant {
        if (status != Status.FUNDED) revert InvalidStatus();
        if (block.timestamp <= shipmentDeadline) revert ShipmentDeadlinePassed();
        _settle(Outcome.SHIPMENT_DEADLINE_REFUND, 0, reserveRemaining);
    }

    /// @notice Buyer approves the submitted shipment and releases the reserve.
    function approveShipment() external onlyBuyer nonReentrant {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp > buyerDecisionDeadline) revert BuyerDecisionDeadlinePassed();
        _settle(Outcome.SUPPLIER_PAID, reserveRemaining, 0);
    }

    /// @notice Supplier can finish a submitted shipment if the buyer does not decide.
    function claimBuyerDecisionTimeout() external onlySupplier nonReentrant {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp <= buyerDecisionDeadline) revert BuyerDecisionDeadlinePassed();
        _settle(Outcome.SUPPLIER_PAID, reserveRemaining, 0);
    }

    function openDispute(bytes32 reasonHash) external onlyBuyer {
        if (status != Status.SHIPMENT_SUBMITTED) revert InvalidStatus();
        if (block.timestamp > buyerDecisionDeadline) revert BuyerDecisionDeadlinePassed();
        if (reasonHash == bytes32(0)) revert MissingCommitment();
        status = Status.DISPUTED;
        disputeReasonHash = reasonHash;
        emit DisputeOpened(reasonHash, block.timestamp);
    }

    /// @notice Immutable arbiter resolves only the reserved balance, never arbitrary funds.
    function resolveDispute(uint256 supplierPayout) external onlyArbiter nonReentrant {
        if (status != Status.DISPUTED) revert InvalidStatus();
        if (block.timestamp > disputeDeadline) revert DisputeDeadlineNotPassed();
        if (supplierPayout > reserveRemaining) revert InvalidDisputePayout();
        _settle(Outcome.DISPUTE_RESOLVED, supplierPayout, reserveRemaining - supplierPayout);
    }

    /// @notice Deterministic fallback after the dispute window prevents permanently locked funds.
    function claimDisputeFallback() external nonReentrant {
        if (status != Status.DISPUTED) revert InvalidStatus();
        if (block.timestamp <= disputeDeadline) revert DisputeDeadlineNotPassed();
        uint256 supplierPayout = (reserveRemaining * fallbackSupplierBps) / BPS;
        _settle(Outcome.DISPUTE_FALLBACK, supplierPayout, reserveRemaining - supplierPayout);
    }

    function remainingBalance() external view returns (uint256) {
        return reserveRemaining;
    }

    /// @notice Native value forced into the account outside fund() is returned to the buyer on exit.
    function unexpectedBalance() external view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > reserveRemaining ? balance - reserveRemaining : 0;
    }

    function accountingInvariant() external view returns (bool) {
        return status == Status.FUNDED || status == Status.SHIPMENT_SUBMITTED || status == Status.DISPUTED
            ? address(this).balance >= reserveRemaining
            : address(this).balance == 0;
    }

    receive() external payable {
        revert DirectFundingDisabled();
    }

    fallback() external payable {
        revert UnsupportedCall();
    }

    function _settle(Outcome nextOutcome, uint256 supplierPayout, uint256 buyerPayout) internal {
        if (supplierPayout + buyerPayout != reserveRemaining) revert InvalidDisputePayout();
        uint256 balance = address(this).balance;
        if (balance < reserveRemaining) revert AccountingMismatch();
        uint256 excess = balance - reserveRemaining;
        uint256 totalBuyerPayout = buyerPayout + excess;
        reserveRemaining = 0;
        status = Status.SETTLED;
        outcome = nextOutcome;
        settledAt = block.timestamp;
        _pay(payable(supplier), supplierPayout);
        _pay(payable(buyer), totalBuyerPayout);
        if (excess != 0) emit ExcessReturned(buyer, excess);
        emit Settled(nextOutcome, supplierPayout, totalBuyerPayout, settledAt);
    }

    function _pay(address payable recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert PayoutFailed();
    }
}
