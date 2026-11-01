// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";

contract SeldraOrderDeadlinesTest is SeldraTestBase {
    // ---------------------------------------------------------------- funding deadline

    function test_AcceptTerms_AtFundingDeadline_Ok() public {
        vm.warp(fundingDl);
        _accept(order);
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.ACCEPTED));
    }

    function test_AcceptTerms_AfterFundingDeadline_Reverts() public {
        vm.warp(fundingDl + 1);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.acceptTerms();
    }

    function test_Fund_AtFundingDeadline_Ok() public {
        _accept(order);
        vm.warp(fundingDl);
        _fund(order);
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.FUNDED));
    }

    function test_Fund_AfterFundingDeadline_Reverts() public {
        _accept(order);
        vm.warp(fundingDl + 1);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.fund{value: AMOUNT}();
        assertEq(address(order).balance, 0);
    }

    function test_Cancel_NonBuyer_AtFundingDeadline_Reverts() public {
        vm.warp(fundingDl);
        vm.prank(stranger);
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.cancelBeforeFunding();
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.cancelBeforeFunding();
    }

    function test_Cancel_NonBuyer_AfterFundingDeadline_Ok() public {
        vm.warp(fundingDl + 1);
        vm.prank(stranger);
        order.cancelBeforeFunding();
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.SETTLED));
    }

    function test_Cancel_Buyer_AtAndAfterFundingDeadline_Ok() public {
        SeldraOrder o2 = _mk(buyer, supplier, arbiter);
        vm.warp(fundingDl);
        vm.prank(buyer);
        order.cancelBeforeFunding();
        vm.warp(fundingDl + 1);
        vm.prank(buyer);
        o2.cancelBeforeFunding();
        assertEq(uint8(o2.status()), uint8(SeldraOrder.Status.SETTLED));
    }

    function test_UnfundedOrderAfterDeadline_CannotBeFundedOrAccepted_ButCanBeClosed() public {
        vm.warp(fundingDl + 1);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.acceptTerms();
        vm.prank(stranger);
        order.cancelBeforeFunding();
        assertEq(uint8(order.outcome()), uint8(SeldraOrder.Outcome.CANCELLED));
    }

    // ---------------------------------------------------------------- shipment deadline

    function test_SubmitEvidence_AtShipmentDeadline_Ok() public {
        _toFunded(order);
        vm.warp(shipDl);
        _evidence(order);
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.SHIPMENT_SUBMITTED));
    }

    function test_SubmitEvidence_AfterShipmentDeadline_Reverts() public {
        _toFunded(order);
        vm.warp(shipDl + 1);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.submitEvidence(EVID);
    }

    function test_ShipmentRefund_AtShipmentDeadline_Reverts() public {
        _toFunded(order);
        vm.warp(shipDl);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlineNotPassed.selector);
        order.claimShipmentRefund();
    }

    function test_ShipmentRefund_AfterShipmentDeadline_Ok() public {
        _toFunded(order);
        vm.warp(shipDl + 1);
        vm.prank(buyer);
        order.claimShipmentRefund();
        assertEq(uint8(order.outcome()), uint8(SeldraOrder.Outcome.SHIPMENT_DEADLINE_REFUND));
    }

    function test_ShipmentRefund_BlockedOnceEvidenceSubmitted() public {
        _toSubmitted(order);
        vm.warp(shipDl + 1);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.claimShipmentRefund();
    }

    // ---------------------------------------------------------------- buyer decision deadline

    function test_Approve_AtDecisionDeadline_Ok() public {
        _toSubmitted(order);
        vm.warp(decDl);
        vm.prank(buyer);
        order.approveRelease();
        assertEq(uint8(order.outcome()), uint8(SeldraOrder.Outcome.SUPPLIER_PAID));
    }

    function test_Approve_AfterDecisionDeadline_Reverts() public {
        _toSubmitted(order);
        vm.warp(decDl + 1);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.approveRelease();
    }

    function test_OpenDispute_AtDecisionDeadline_Ok() public {
        _toSubmitted(order);
        vm.warp(decDl);
        _dispute(order);
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.DISPUTED));
    }

    function test_OpenDispute_AfterDecisionDeadline_Reverts() public {
        _toSubmitted(order);
        vm.warp(decDl + 1);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.openDispute(REASON);
    }

    function test_DecisionTimeout_AtDecisionDeadline_Reverts() public {
        _toSubmitted(order);
        vm.warp(decDl);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.DeadlineNotPassed.selector);
        order.claimDecisionTimeout();
    }

    function test_DecisionTimeout_AfterDecisionDeadline_Ok() public {
        _toSubmitted(order);
        vm.warp(decDl + 1);
        vm.prank(supplier);
        order.claimDecisionTimeout();
        assertEq(supplier.balance, AMOUNT);
    }

    // ---------------------------------------------------------------- dispute deadline

    function test_ResolveDispute_AtDisputeDeadline_Ok() public {
        _toDisputed(order);
        vm.warp(dispDl);
        vm.prank(arbiter);
        order.resolveDispute(1e18);
        assertEq(uint8(order.outcome()), uint8(SeldraOrder.Outcome.DISPUTE_RESOLVED));
    }

    function test_ResolveDispute_AfterDisputeDeadline_Reverts() public {
        _toDisputed(order);
        vm.warp(dispDl + 1);
        vm.prank(arbiter);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.resolveDispute(1e18);
    }

    function test_Fallback_AtDisputeDeadline_Reverts() public {
        _toDisputed(order);
        vm.warp(dispDl);
        vm.expectRevert(SeldraOrder.DeadlineNotPassed.selector);
        order.claimDisputeFallback();
    }

    function test_Fallback_AfterDisputeDeadline_Ok() public {
        _toDisputed(order);
        vm.warp(dispDl + 1);
        order.claimDisputeFallback();
        assertEq(uint8(order.outcome()), uint8(SeldraOrder.Outcome.DISPUTE_FALLBACK));
    }

    // ---------------------------------------------------------------- mutual exclusion at every boundary second

    /// @dev At each boundary second exactly one of {arbiter resolve, anyone fallback} is available.
    function testFuzz_DisputeWindow_ExactlyOneExitAvailable(uint256 dt) public {
        _toDisputed(order);
        dt = bound(dt, 0, 400 days);
        vm.warp(t0 + dt);
        bool resolveWindow = block.timestamp <= dispDl;
        vm.prank(arbiter);
        (bool okResolve,) = address(order).call(abi.encodeCall(order.resolveDispute, (0)));
        if (!resolveWindow) {
            assertFalse(okResolve);
            order.claimDisputeFallback();
        } else {
            assertTrue(okResolve);
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            order.claimDisputeFallback();
        }
    }

    /// @dev After the shipment deadline a funded order has exactly one exit for evidence-less orders.
    function testFuzz_ShipmentWindow_ExactlyOneExitAvailable(uint256 dt) public {
        _toFunded(order);
        dt = bound(dt, 1 days, 400 days);
        vm.warp(t0 + dt);
        bool evidenceWindow = block.timestamp <= shipDl;
        vm.prank(supplier);
        (bool okEv,) = address(order).call(abi.encodeCall(order.submitEvidence, (EVID)));
        vm.prank(buyer);
        (bool okRefund,) = address(order).call(abi.encodeCall(order.claimShipmentRefund, ()));
        assertEq(okEv, evidenceWindow);
        if (evidenceWindow) assertFalse(okRefund);
        else assertTrue(okRefund);
    }

    function testFuzz_DecisionWindow_BuyerXorSupplier(uint256 dt) public {
        _toSubmitted(order);
        dt = bound(dt, 11 days, 400 days);
        vm.warp(t0 + dt);
        bool buyerWindow = block.timestamp <= decDl;
        vm.prank(supplier);
        (bool okSup,) = address(order).call(abi.encodeCall(order.claimDecisionTimeout, ()));
        assertEq(okSup, !buyerWindow);
        if (buyerWindow) {
            vm.prank(buyer);
            (bool okB,) = address(order).call(abi.encodeCall(order.approveRelease, ()));
            assertTrue(okB);
        }
    }
}
