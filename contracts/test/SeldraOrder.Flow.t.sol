// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";

contract SeldraOrderFlowTest is SeldraTestBase {
    SeldraOrder.Status internal constant CREATED = SeldraOrder.Status.CREATED;
    SeldraOrder.Status internal constant ACCEPTED = SeldraOrder.Status.ACCEPTED;
    SeldraOrder.Status internal constant FUNDED = SeldraOrder.Status.FUNDED;
    SeldraOrder.Status internal constant SUBMITTED = SeldraOrder.Status.SHIPMENT_SUBMITTED;
    SeldraOrder.Status internal constant DISPUTED = SeldraOrder.Status.DISPUTED;
    SeldraOrder.Status internal constant SETTLED = SeldraOrder.Status.SETTLED;

    function _assertSettled(SeldraOrder.Outcome o) internal view {
        assertEq(uint8(order.status()), uint8(SETTLED));
        assertEq(uint8(order.outcome()), uint8(o));
        assertEq(order.reserveRemaining(), 0);
        assertEq(order.settledAt(), block.timestamp);
        assertEq(address(order).balance, 0);
        assertEq(order.totalPending(), 0);
    }

    // ------------------------------------------------------------------ happy path (step by step)

    function test_HappyPath_EndToEnd() public {
        uint256 buyerStart = buyer.balance;

        // accept
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.TermsAccepted(supplier, block.timestamp);
        vm.prank(supplier);
        order.acceptTerms();
        assertEq(uint8(order.status()), uint8(ACCEPTED));
        assertEq(order.acceptedAt(), block.timestamp);

        // fund
        skip(1 hours);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Funded(buyer, AMOUNT, DEPOSIT, RESERVE);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.DepositPaid(supplier, DEPOSIT);
        vm.prank(buyer);
        order.fund{value: AMOUNT}();
        assertEq(uint8(order.status()), uint8(FUNDED));
        assertEq(order.fundedAt(), block.timestamp);
        assertEq(order.reserveRemaining(), RESERVE);
        assertEq(supplier.balance, DEPOSIT);
        assertEq(address(order).balance, RESERVE);
        assertEq(buyer.balance, buyerStart - AMOUNT);

        // evidence
        skip(1 days);
        vm.expectEmit(true, true, false, true, address(order));
        emit SeldraOrder.EvidenceSubmitted(supplier, EVID, block.timestamp);
        vm.prank(supplier);
        order.submitEvidence(EVID);
        assertEq(uint8(order.status()), uint8(SUBMITTED));
        assertEq(order.evidenceHash(), EVID);
        assertEq(order.evidenceSubmittedAt(), block.timestamp);

        // approve
        skip(1 days);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.ReleaseApproved(buyer, block.timestamp);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.SUPPLIER_PAID, RESERVE, 0, block.timestamp);
        vm.prank(buyer);
        order.approveRelease();

        _assertSettled(SeldraOrder.Outcome.SUPPLIER_PAID);
        assertEq(supplier.balance, AMOUNT);
        assertEq(buyer.balance, buyerStart - AMOUNT);
    }

    function test_ShipmentDeadlineRefund() public {
        _toFunded(order);
        uint256 buyerBefore = buyer.balance;
        vm.warp(shipDl + 1);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.SHIPMENT_DEADLINE_REFUND, 0, RESERVE, block.timestamp);
        vm.prank(buyer);
        order.claimShipmentRefund();
        _assertSettled(SeldraOrder.Outcome.SHIPMENT_DEADLINE_REFUND);
        assertEq(buyer.balance, buyerBefore + RESERVE);
        assertEq(supplier.balance, DEPOSIT); // deposit is never clawed back
    }

    function test_DecisionTimeout_SupplierClaims() public {
        _toSubmitted(order);
        vm.warp(decDl + 1);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.SUPPLIER_PAID, RESERVE, 0, block.timestamp);
        vm.prank(supplier);
        order.claimDecisionTimeout();
        _assertSettled(SeldraOrder.Outcome.SUPPLIER_PAID);
        assertEq(supplier.balance, AMOUNT);
    }

    function test_Dispute_ResolvedByArbiter() public {
        _toSubmitted(order);
        vm.expectEmit(true, true, false, true, address(order));
        emit SeldraOrder.DisputeOpened(buyer, REASON, block.timestamp);
        vm.prank(buyer);
        order.openDispute(REASON);
        assertEq(uint8(order.status()), uint8(DISPUTED));
        assertEq(order.disputeReasonHash(), REASON);
        assertEq(order.reserveRemaining(), RESERVE); // frozen

        uint256 buyerBefore = buyer.balance;
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.DisputeResolved(arbiter, 300e18, 500e18);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.DISPUTE_RESOLVED, 300e18, 500e18, block.timestamp);
        vm.prank(arbiter);
        order.resolveDispute(300e18);
        _assertSettled(SeldraOrder.Outcome.DISPUTE_RESOLVED);
        assertEq(supplier.balance, DEPOSIT + 300e18);
        assertEq(buyer.balance, buyerBefore + 500e18);
        assertEq(arbiter.balance, 0);
    }

    function test_Dispute_ResolveExtremes() public {
        // all to supplier
        _toDisputed(order);
        vm.prank(arbiter);
        order.resolveDispute(RESERVE);
        assertEq(supplier.balance, AMOUNT);
        // all to buyer, on a second order
        SeldraOrder o2 = _mk(buyer, makeAddr("s2"), makeAddr("a2"));
        _toDisputed(o2);
        uint256 b = buyer.balance;
        vm.prank(o2.arbiter());
        o2.resolveDispute(0);
        assertEq(buyer.balance, b + RESERVE);
        assertEq(o2.supplier().balance, DEPOSIT);
    }

    function test_Dispute_Fallback() public {
        _toDisputed(order);
        uint256 buyerBefore = buyer.balance;
        vm.warp(dispDl + 1);
        uint256 toSupplier = (RESERVE * FB_BPS) / 10_000;
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.DISPUTE_FALLBACK, toSupplier, RESERVE - toSupplier, block.timestamp);
        vm.prank(stranger); // permissionless
        order.claimDisputeFallback();
        _assertSettled(SeldraOrder.Outcome.DISPUTE_FALLBACK);
        assertEq(supplier.balance, DEPOSIT + toSupplier);
        assertEq(buyer.balance, buyerBefore + RESERVE - toSupplier);
        assertEq(toSupplier, 240e18);
    }

    function test_Dispute_FallbackBpsZeroAndFull() public {
        for (uint256 i = 0; i < 2; i++) {
            vm.warp(t0);
            SeldraFactory.OrderParams memory p = _params(makeAddr(i == 0 ? "s_fb0" : "s_fb1"), makeAddr(i == 0 ? "a_fb0" : "a_fb1"));
            p.fallbackSupplierBps = i == 0 ? 0 : 10_000;
            SeldraOrder o = _mkWith(buyer, p);
            _toDisputed(o);
            vm.warp(dispDl + 1);
            uint256 b = buyer.balance;
            o.claimDisputeFallback();
            if (i == 0) {
                assertEq(buyer.balance, b + RESERVE);
                assertEq(o.supplier().balance, DEPOSIT);
            } else {
                assertEq(buyer.balance, b);
                assertEq(o.supplier().balance, AMOUNT);
            }
        }
    }

    // ------------------------------------------------------------------ cancellation

    function test_Cancel_ByBuyerFromCreated() public {
        uint256 b = buyer.balance;
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.OrderCancelled(buyer, block.timestamp);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.Settled(SeldraOrder.Outcome.CANCELLED, 0, 0, block.timestamp);
        vm.prank(buyer);
        order.cancelBeforeFunding();
        _assertSettled(SeldraOrder.Outcome.CANCELLED);
        assertEq(buyer.balance, b);
    }

    function test_Cancel_ByBuyerFromAccepted() public {
        _toAccepted(order);
        vm.prank(buyer);
        order.cancelBeforeFunding();
        _assertSettled(SeldraOrder.Outcome.CANCELLED);
    }

    function test_Cancel_AnyoneAfterFundingDeadline() public {
        _toAccepted(order);
        vm.warp(fundingDl + 1);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.OrderCancelled(stranger, block.timestamp);
        vm.prank(stranger);
        order.cancelBeforeFunding();
        _assertSettled(SeldraOrder.Outcome.CANCELLED);
    }

    function test_Cancel_ReturnsForcedExcessToBuyer() public {
        vm.deal(address(order), 3e18);
        uint256 b = buyer.balance;
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.ExcessReturned(buyer, 3e18);
        vm.prank(buyer);
        order.cancelBeforeFunding();
        assertEq(buyer.balance, b + 3e18);
        assertEq(address(order).balance, 0);
        _assertSettledNoBalance();
    }

    function _assertSettledNoBalance() internal view {
        assertEq(uint8(order.status()), uint8(SETTLED));
    }

    // ------------------------------------------------------------------ orderSummary

    function test_OrderSummary_ReflectsLifecycle() public {
        SeldraOrder.Summary memory s = order.orderSummary();
        assertEq(s.buyer, buyer);
        assertEq(s.supplier, supplier);
        assertEq(s.arbiter, arbiter);
        assertEq(s.orderAmount, AMOUNT);
        assertEq(s.depositAmount, DEPOSIT);
        assertEq(s.reserveAmount, RESERVE);
        assertEq(s.depositBps, DEP_BPS);
        assertEq(s.fallbackSupplierBps, FB_BPS);
        assertEq(s.referenceHash, REF);
        assertEq(s.fundingDeadline, fundingDl);
        assertEq(s.shipmentDeadline, shipDl);
        assertEq(s.buyerDecisionDeadline, decDl);
        assertEq(s.disputeDeadline, dispDl);
        assertEq(s.termsHash, order.termsHash());
        assertEq(s.createdAtBlock, 1000);
        assertEq(uint8(s.status), uint8(CREATED));
        assertEq(uint8(s.outcome), 0);
        assertEq(s.reserveRemaining, 0);
        assertEq(s.balance, 0);
        assertEq(s.acceptedAt, 0);

        _accept(order);
        _fund(order);
        s = order.orderSummary();
        assertEq(uint8(s.status), uint8(FUNDED));
        assertEq(s.acceptedAt, block.timestamp);
        assertEq(s.fundedAt, block.timestamp);
        assertEq(s.reserveRemaining, RESERVE);
        assertEq(s.balance, RESERVE);

        skip(1 days);
        _evidence(order);
        s = order.orderSummary();
        assertEq(uint8(s.status), uint8(SUBMITTED));
        assertEq(s.evidenceHash, EVID);
        assertEq(s.evidenceSubmittedAt, block.timestamp);

        _dispute(order);
        s = order.orderSummary();
        assertEq(uint8(s.status), uint8(DISPUTED));
        assertEq(s.disputeReasonHash, REASON);

        vm.prank(arbiter);
        order.resolveDispute(100e18);
        s = order.orderSummary();
        assertEq(uint8(s.status), uint8(SETTLED));
        assertEq(uint8(s.outcome), uint8(SeldraOrder.Outcome.DISPUTE_RESOLVED));
        assertEq(s.reserveRemaining, 0);
        assertEq(s.settledAt, block.timestamp);
        assertEq(s.balance, 0);
        assertEq(s.totalPending, 0);
    }

    function test_AccountingInvariantView() public {
        assertTrue(order.accountingInvariantHolds());
        _toFunded(order);
        assertTrue(order.accountingInvariantHolds());
        vm.deal(address(order), address(order).balance + 1);
        assertTrue(order.accountingInvariantHolds());
        // reserve can only be unbacked by cheating the balance; simulate to prove the view detects it
        vm.deal(address(order), RESERVE - 1);
        assertFalse(order.accountingInvariantHolds());
    }

    function test_MissingCommitments() public {
        _toFunded(order);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.MissingCommitment.selector);
        order.submitEvidence(bytes32(0));
        _evidence(order);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.MissingCommitment.selector);
        order.openDispute(bytes32(0));
    }

    function test_FundCallsWithWrongValue() public {
        _accept(order);
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.FundingAmountMismatch.selector, 0, AMOUNT));
        order.fund();
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.FundingAmountMismatch.selector, AMOUNT - 1, AMOUNT));
        order.fund{value: AMOUNT - 1}();
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.FundingAmountMismatch.selector, AMOUNT + 1, AMOUNT));
        order.fund{value: AMOUNT + 1}();
        vm.stopPrank();
        assertEq(address(order).balance, 0);
        assertEq(uint8(order.status()), uint8(ACCEPTED));
    }

    function test_ResolveDispute_PayoutAboveReserveReverts() public {
        _toDisputed(order);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.InvalidPayout.selector, RESERVE + 1, RESERVE));
        order.resolveDispute(RESERVE + 1);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.InvalidPayout.selector, type(uint256).max, RESERVE));
        order.resolveDispute(type(uint256).max);
    }
}
