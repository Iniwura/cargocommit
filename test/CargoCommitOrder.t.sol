// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CargoCommitOrder} from "../src/CargoCommitOrder.sol";

contract CargoCommitOrderTest is Test {
    uint256 internal constant ONE_USDC = 1e18;
    uint256 internal constant ORDER = ONE_USDC;
    uint16 internal constant DEPOSIT_BPS = 3_000;
    uint16 internal constant FALLBACK_SUPPLIER_BPS = 5_000;

    address internal buyer = address(0xB0B);
    address internal supplier = address(0xC0C);
    address internal arbiter = address(0xA0B);
    CargoCommitOrder internal order;

    function setUp() public {
        vm.warp(1_000);
        order = _deploy(buyer, supplier, arbiter);
        vm.deal(buyer, 10 * ONE_USDC);
        vm.deal(supplier, 0);
    }

    function _deploy(address buyer_, address supplier_, address arbiter_) internal returns (CargoCommitOrder deployed) {
        uint256 fundingDeadline = block.timestamp + 100;
        uint256 shipmentDeadline = block.timestamp + 200;
        uint256 buyerDecisionDeadline = block.timestamp + 300;
        uint256 disputeDeadline = block.timestamp + 400;
        deployed = new CargoCommitOrder(
            buyer_,
            supplier_,
            arbiter_,
            ORDER,
            DEPOSIT_BPS,
            FALLBACK_SUPPLIER_BPS,
            fundingDeadline,
            shipmentDeadline,
            buyerDecisionDeadline,
            disputeDeadline
        );
    }

    function _acceptAndFund() internal {
        vm.prank(supplier);
        order.acceptOrder();
        vm.prank(buyer);
        order.fund{value: ORDER}();
    }

    function _submitShipment() internal {
        _acceptAndFund();
        vm.prank(supplier);
        order.submitShipment(keccak256("bill-of-lading-commitment"));
    }

    function testConstructorFixesTermsAndNativeUnits() public view {
        assertEq(order.buyer(), buyer);
        assertEq(order.supplier(), supplier);
        assertEq(order.arbiter(), arbiter);
        assertEq(order.orderAmount(), ONE_USDC);
        assertEq(order.depositAmount(), 0.3e18);
        assertEq(order.reserveAmount(), 0.7e18);
        assertTrue(order.termsHash() != bytes32(0));
        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.CREATED));
    }

    function testSuccessfulThirtySeventySettlement() public {
        uint256 supplierBefore = supplier.balance;
        _submitShipment();

        assertEq(supplier.balance - supplierBefore, 0.3e18);
        assertEq(order.reserveRemaining(), 0.7e18);
        assertEq(address(order).balance, 0.7e18);
        assertTrue(order.accountingInvariant());

        vm.prank(buyer);
        order.approveShipment();

        assertEq(supplier.balance - supplierBefore, ONE_USDC);
        assertEq(address(order).balance, 0);
        assertEq(order.reserveRemaining(), 0);
        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.SETTLED));
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.SUPPLIER_PAID));
        assertTrue(order.accountingInvariant());
    }

    function testOnlySupplierAcceptsAndOnlyBuyerFunds() public {
        vm.expectRevert(CargoCommitOrder.NotSupplier.selector);
        vm.prank(buyer);
        order.acceptOrder();

        vm.prank(supplier);
        order.acceptOrder();

        vm.expectRevert(CargoCommitOrder.NotBuyer.selector);
        vm.prank(supplier);
        order.fund();

        vm.expectRevert(CargoCommitOrder.FundingAmountMismatch.selector);
        vm.prank(buyer);
        order.fund{value: ORDER - 1}();
    }

    function testFullFundingIsRequiredBeforeActivation() public {
        vm.prank(supplier);
        order.acceptOrder();
        vm.expectRevert(CargoCommitOrder.FundingAmountMismatch.selector);
        vm.prank(buyer);
        order.fund{value: ORDER + 1}();
        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.SUPPLIER_ACCEPTED));
        assertEq(address(order).balance, 0);
        assertTrue(order.accountingInvariant());
    }

    function testCancellationBeforeFundingAndFundingDeadlineExpiry() public {
        vm.prank(buyer);
        order.cancelBeforeFunding();
        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.SETTLED));
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.CANCELLED));
        assertEq(address(order).balance, 0);

        CargoCommitOrder second = _deploy(buyer, supplier, arbiter);
        vm.prank(supplier);
        second.acceptOrder();
        vm.warp(second.fundingDeadline() + 1);
        vm.prank(buyer);
        second.cancelBeforeFunding();
        assertEq(uint8(second.status()), uint8(CargoCommitOrder.Status.SETTLED));
        assertTrue(second.accountingInvariant());
    }

    function testFundingAndAcceptanceDeadlinesAreEnforced() public {
        vm.warp(order.fundingDeadline() + 1);
        vm.expectRevert(CargoCommitOrder.FundingDeadlinePassed.selector);
        vm.prank(supplier);
        order.acceptOrder();

        CargoCommitOrder second = _deploy(buyer, supplier, arbiter);
        vm.prank(supplier);
        second.acceptOrder();
        vm.warp(second.fundingDeadline() + 1);
        vm.expectRevert(CargoCommitOrder.FundingDeadlinePassed.selector);
        vm.prank(buyer);
        second.fund{value: ORDER}();
    }

    function testSupplierCannotWithdrawReserveBeforeShipmentDecision() public {
        _acceptAndFund();

        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(supplier);
        order.claimBuyerDecisionTimeout();

        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(buyer);
        order.approveShipment();

        assertEq(order.reserveRemaining(), 0.7e18);
        assertEq(address(order).balance, 0.7e18);
        assertTrue(order.accountingInvariant());
    }

    function testMissingShipmentRefundsOnlyTheReservedBalance() public {
        _acceptAndFund();
        uint256 buyerBefore = buyer.balance;
        uint256 supplierBefore = supplier.balance;

        vm.warp(order.shipmentDeadline() + 1);
        vm.prank(buyer);
        order.claimShipmentDeadlineRefund();

        assertEq(buyer.balance - buyerBefore, 0.7e18);
        assertEq(supplier.balance - supplierBefore, 0);
        assertEq(address(order).balance, 0);
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.SHIPMENT_DEADLINE_REFUND));
        assertTrue(order.accountingInvariant());
    }

    function testShipmentEvidenceMustBeSupplierSubmittedAndNonzero() public {
        _acceptAndFund();
        vm.expectRevert(CargoCommitOrder.NotSupplier.selector);
        vm.prank(buyer);
        order.submitShipment(bytes32(uint256(1)));

        vm.expectRevert(CargoCommitOrder.MissingCommitment.selector);
        vm.prank(supplier);
        order.submitShipment(bytes32(0));
    }

    function testBuyerDecisionTimeoutPaysSupplierAfterShipment() public {
        _submitShipment();
        uint256 supplierBefore = supplier.balance;
        vm.warp(order.buyerDecisionDeadline() + 1);

        vm.prank(supplier);
        order.claimBuyerDecisionTimeout();

        assertEq(supplier.balance - supplierBefore, 0.7e18);
        assertEq(address(order).balance, 0);
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.SUPPLIER_PAID));
        assertTrue(order.accountingInvariant());
    }

    function testDisputeFreezesNormalReleaseAndArbiterSplitsReserve() public {
        _submitShipment();
        vm.prank(buyer);
        order.openDispute(keccak256("quality-dispute"));
        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.DISPUTED));

        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(buyer);
        order.approveShipment();
        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(supplier);
        order.claimBuyerDecisionTimeout();

        uint256 supplierBefore = supplier.balance;
        uint256 buyerBefore = buyer.balance;
        vm.prank(arbiter);
        order.resolveDispute(0.4e18);

        assertEq(supplier.balance - supplierBefore, 0.4e18);
        assertEq(buyer.balance - buyerBefore, 0.3e18);
        assertEq(order.reserveRemaining(), 0);
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.DISPUTE_RESOLVED));
        assertTrue(order.accountingInvariant());
    }

    function testOnlyArbiterCanResolveAndPayoutMustBeBounded() public {
        _submitShipment();
        vm.prank(buyer);
        order.openDispute(keccak256("dispute"));

        vm.expectRevert(CargoCommitOrder.NotArbiter.selector);
        vm.prank(supplier);
        order.resolveDispute(0);
        vm.expectRevert(CargoCommitOrder.InvalidDisputePayout.selector);
        vm.prank(arbiter);
        order.resolveDispute(0.7e18 + 1);
        assertEq(order.reserveRemaining(), 0.7e18);
        assertTrue(order.accountingInvariant());
    }

    function testDisputeFallbackPreventsPermanentLock() public {
        _submitShipment();
        vm.prank(buyer);
        order.openDispute(keccak256("dispute"));
        vm.expectRevert(CargoCommitOrder.DisputeDeadlineNotPassed.selector);
        vm.prank(arbiter);
        order.claimDisputeFallback();

        uint256 supplierBefore = supplier.balance;
        uint256 buyerBefore = buyer.balance;
        vm.warp(order.disputeDeadline() + 1);
        vm.prank(address(0xD00D));
        order.claimDisputeFallback();

        assertEq(supplier.balance - supplierBefore, 0.35e18);
        assertEq(buyer.balance - buyerBefore, 0.35e18);
        assertEq(address(order).balance, 0);
        assertEq(uint8(order.outcome()), uint8(CargoCommitOrder.Outcome.DISPUTE_FALLBACK));
        assertTrue(order.accountingInvariant());
    }

    function testSettlementCannotExecuteTwice() public {
        _submitShipment();
        vm.prank(buyer);
        order.approveShipment();
        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(buyer);
        order.approveShipment();
        vm.expectRevert(CargoCommitOrder.InvalidStatus.selector);
        vm.prank(supplier);
        order.submitShipment(keccak256("late"));
    }

    function testDirectNativeFundingIsRejected() public {
        (bool sent,) = address(order).call{value: ONE_USDC}("");
        assertFalse(sent);
        assertEq(address(order).balance, 0);
        assertTrue(order.accountingInvariant());
    }

    function testForcedNativeValueIsReturnedOnCancellation() public {
        uint256 forced = 0.02e18;
        ForceSend force = new ForceSend{value: forced}();
        force.destroy(payable(address(order)));
        assertEq(order.unexpectedBalance(), forced);

        uint256 buyerBefore = buyer.balance;
        assertEq(address(order).balance, forced);

        vm.prank(buyer);
        order.cancelBeforeFunding();
        assertEq(buyer.balance - buyerBefore, forced);
        assertEq(address(order).balance, 0);
        assertTrue(order.accountingInvariant());
    }

    function testForcedNativeValueIsReturnedAtSettlement() public {
        _submitShipment();
        uint256 forced = 0.02e18;
        ForceSend force = new ForceSend{value: forced}();
        force.destroy(payable(address(order)));
        assertEq(order.unexpectedBalance(), forced);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        order.approveShipment();

        assertEq(buyer.balance - buyerBefore, forced);
        assertEq(address(order).balance, 0);
        assertTrue(order.accountingInvariant());
    }

    function testReentrancyCannotReenterDuringDepositPayout() public {
        ReenteringSupplier attacker = new ReenteringSupplier();
        CargoCommitOrder targeted = _deploy(buyer, address(attacker), arbiter);
        attacker.setTarget(targeted);
        vm.prank(address(attacker));
        targeted.acceptOrder();

        vm.prank(buyer);
        targeted.fund{value: ORDER}();

        assertTrue(attacker.reentryWasBlocked());
        assertEq(targeted.reserveRemaining(), 0.7e18);
        assertTrue(targeted.accountingInvariant());
    }

    function testSupplierPayoutFailureRollsBackFunding() public {
        RevertingSupplier badSupplier = new RevertingSupplier();
        CargoCommitOrder targeted = _deploy(buyer, address(badSupplier), arbiter);
        vm.prank(address(badSupplier));
        targeted.acceptOrder();

        vm.expectRevert(CargoCommitOrder.PayoutFailed.selector);
        vm.prank(buyer);
        targeted.fund{value: ORDER}();

        assertEq(uint8(targeted.status()), uint8(CargoCommitOrder.Status.SUPPLIER_ACCEPTED));
        assertEq(address(targeted).balance, 0);
        assertEq(targeted.reserveRemaining(), 0);
        assertTrue(targeted.accountingInvariant());
    }

    function testInvalidConstructorParametersRevert() public {
        vm.expectRevert(CargoCommitOrder.InvalidAddress.selector);
        new CargoCommitOrder(
            address(0),
            supplier,
            arbiter,
            ORDER,
            DEPOSIT_BPS,
            FALLBACK_SUPPLIER_BPS,
            block.timestamp + 100,
            block.timestamp + 200,
            block.timestamp + 300,
            block.timestamp + 400
        );
        vm.expectRevert(CargoCommitOrder.InvalidBps.selector);
        new CargoCommitOrder(
            buyer,
            supplier,
            arbiter,
            ORDER,
            10_000,
            FALLBACK_SUPPLIER_BPS,
            block.timestamp + 100,
            block.timestamp + 200,
            block.timestamp + 300,
            block.timestamp + 400
        );
    }
}

contract ReenteringSupplier {
    CargoCommitOrder public target;
    bool public reentryWasBlocked;

    function setTarget(CargoCommitOrder target_) external {
        target = target_;
    }

    function acceptOrder() external {
        target.acceptOrder();
    }

    receive() external payable {
        (bool success,) = address(target).call(abi.encodeWithSelector(target.claimBuyerDecisionTimeout.selector));
        reentryWasBlocked = !success;
    }
}

contract ForceSend {
    constructor() payable {}

    function destroy(address payable beneficiary) external {
        selfdestruct(beneficiary);
    }
}

contract RevertingSupplier {
    function acceptOrder() external {}

    receive() external payable {
        revert();
    }
}

contract CargoCommitHandler {
    uint256 internal constant ONE_USDC = 1e18;
    Actor public buyer;
    Actor public supplier;
    Actor public arbiter;
    CargoCommitOrder public order;

    constructor() {
        buyer = new Actor();
        supplier = new Actor();
        arbiter = new Actor();
        uint256 fundingDeadline = block.timestamp + 1_000;
        uint256 shipmentDeadline = block.timestamp + 2_000;
        uint256 buyerDecisionDeadline = block.timestamp + 3_000;
        uint256 disputeDeadline = block.timestamp + 4_000;
        order = new CargoCommitOrder(
            address(buyer),
            address(supplier),
            address(arbiter),
            ONE_USDC,
            3_000,
            5_000,
            fundingDeadline,
            shipmentDeadline,
            buyerDecisionDeadline,
            disputeDeadline
        );
    }

    function accept() external {
        try supplier.accept(order) {} catch {}
    }

    function fund() external {
        try buyer.fund(order) {} catch {}
    }

    function submit(uint256 rawEvidence) external {
        try supplier.submit(order, bytes32(rawEvidence | 1)) {} catch {}
    }

    function approve() external {
        try buyer.approve(order) {} catch {}
    }

    function dispute(uint256 rawReason) external {
        try buyer.dispute(order, bytes32(rawReason | 1)) {} catch {}
    }

    function resolve(uint256 rawPayout) external {
        uint256 remaining = order.reserveRemaining();
        uint256 payout = remaining == 0 ? 0 : rawPayout % (remaining + 1);
        try arbiter.resolve(order, payout) {} catch {}
    }

    function fallbackResolution() external {
        try order.claimDisputeFallback() {} catch {}
    }
}

contract Actor {
    function accept(CargoCommitOrder order) external {
        order.acceptOrder();
    }

    function fund(CargoCommitOrder order) external {
        order.fund{value: order.orderAmount()}();
    }

    function submit(CargoCommitOrder order, bytes32 evidence) external {
        order.submitShipment(evidence);
    }

    function approve(CargoCommitOrder order) external {
        order.approveShipment();
    }

    function dispute(CargoCommitOrder order, bytes32 reason) external {
        order.openDispute(reason);
    }

    function resolve(CargoCommitOrder order, uint256 supplierPayout) external {
        order.resolveDispute(supplierPayout);
    }
}

contract CargoCommitOrderInvariantTest is Test {
    CargoCommitHandler internal handler;

    function setUp() public {
        vm.warp(1_000);
        handler = new CargoCommitHandler();
        vm.deal(address(handler.buyer()), 10e18);
        targetContract(address(handler));
    }

    function invariant_reserveAndNativeBalanceStayConsistent() public view {
        CargoCommitOrder order = handler.order();
        CargoCommitOrder.Status current = order.status();
        if (
            current == CargoCommitOrder.Status.FUNDED || current == CargoCommitOrder.Status.SHIPMENT_SUBMITTED
                || current == CargoCommitOrder.Status.DISPUTED
        ) {
            assertEq(address(order).balance, order.reserveRemaining());
        } else {
            assertEq(order.reserveRemaining(), 0);
            assertEq(address(order).balance, 0);
        }
        assertTrue(order.accountingInvariant());
    }
}
