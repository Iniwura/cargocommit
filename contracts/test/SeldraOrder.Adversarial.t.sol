// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {Actor, Forcer} from "./Actors.sol";

contract SeldraOrderAdversarialTest is SeldraTestBase {
    // ------------------------------------------------------------ recipient that always reverts

    function test_RevertingSupplier_DepositCreditedAndFundingStillSucceeds() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _accept(o);
        vm.expectEmit(true, false, false, true, address(o));
        emit SeldraOrder.PayoutDeferred(address(s), DEPOSIT);
        _fund(o);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.FUNDED));
        assertEq(o.pendingWithdrawals(address(s)), DEPOSIT);
        assertEq(o.totalPending(), DEPOSIT);
        assertEq(address(o).balance, AMOUNT);
        assertEq(address(s).balance, 0);
        assertTrue(o.accountingInvariantHolds());
    }

    function test_RevertingSupplier_SettlementNotBlocked_WithdrawLater() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        assertEq(o.totalPending(), AMOUNT);
        assertEq(address(o).balance, AMOUNT);

        // still rejecting: withdraw reverts and credit is preserved
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.WithdrawFailed.selector);
        o.withdraw();
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        assertEq(address(o).balance, AMOUNT);

        // anyone else cannot take it
        vm.prank(stranger);
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();

        s.setMode(Actor.Mode.ACCEPT);
        vm.expectEmit(true, false, false, true, address(o));
        emit SeldraOrder.Withdrawn(address(s), AMOUNT);
        vm.prank(address(s));
        o.withdraw();
        assertEq(address(s).balance, AMOUNT);
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
        assertEq(o.pendingWithdrawals(address(s)), 0);

        // cannot be drained twice
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
        assertEq(address(s).balance, AMOUNT);
    }

    function test_RevertingBuyer_RefundCreditedAndWithdrawable() public {
        (SeldraOrder o,, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REVERT);
        _runPath(o, 1, 0);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.pendingWithdrawals(address(b)), RESERVE);
        assertEq(address(o).balance, RESERVE);
        b.setMode(Actor.Mode.ACCEPT);
        uint256 before_ = address(b).balance;
        vm.prank(address(b));
        o.withdraw();
        assertEq(address(b).balance, before_ + RESERVE);
        assertEq(address(o).balance, 0);
    }

    function test_BothRejecting_BothCreditedAndIndependentlyWithdrawable() public {
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.REVERT, Actor.Mode.REVERT);
        _runPath(o, 4, 500e18);
        assertEq(o.pendingWithdrawals(address(s)), DEPOSIT + 500e18);
        assertEq(o.pendingWithdrawals(address(b)), 300e18);
        assertEq(o.totalPending(), AMOUNT);
        assertEq(address(o).balance, AMOUNT);
        // buyer withdraws first; supplier's backing remains
        b.setMode(Actor.Mode.ACCEPT);
        vm.prank(address(b));
        o.withdraw();
        assertEq(address(o).balance, DEPOSIT + 500e18);
        assertTrue(o.accountingInvariantHolds());
        s.setMode(Actor.Mode.ACCEPT);
        vm.prank(address(s));
        o.withdraw();
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
    }

    function test_PendingCredit_AccumulatesAcrossMultipleDeferredPayouts() public {
        // supplier is paid deposit at fund (deferred) AND reserve at approve (deferred): credits add up
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _toFunded(o);
        assertEq(o.pendingWithdrawals(address(s)), DEPOSIT);
        _evidence(o);
        vm.prank(o.buyer());
        o.approveRelease();
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        assertEq(o.totalPending(), AMOUNT);
    }

    // ------------------------------------------------------------ gas burners / return bombs

    function test_GasBurningSupplier_SettlementBoundedAndCredited() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.BURN, Actor.Mode.ACCEPT);
        uint256 g0 = gasleft();
        _runPath(o, 2, 0);
        uint256 used = g0 - gasleft();
        assertLt(used, 1_500_000, "burner must not cause unbounded gas use");
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        assertEq(address(o).balance, AMOUNT);
    }

    function test_GasBurningBuyerAndSupplier_StillSettles() public {
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.BURN, Actor.Mode.BURN);
        _runPath(o, 5, 0);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.pendingWithdrawals(address(s)) + o.pendingWithdrawals(address(b)), AMOUNT);
        assertEq(address(o).balance, AMOUNT);
        // withdraw forwards all gas: a burner can only burn its own gas, credit stays
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.WithdrawFailed.selector);
        o.withdraw();
        assertEq(o.totalPending(), AMOUNT);
    }

    function test_ReturnBomb_Small_PayoutSucceedsDirectly() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.BOMB, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        assertEq(address(s).balance, AMOUNT);
        assertEq(o.totalPending(), 0);
    }

    function test_ReturnBomb_Huge_CannotBlockSettlement() public {
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.HUGE_BOMB, Actor.Mode.HUGE_BOMB);
        uint256 g0 = gasleft();
        _runPath(o, 4, 123e18);
        assertLt(g0 - gasleft(), 2_000_000);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        // whatever path the payout took, value is conserved between recipients and pending credits
        assertEq(address(s).balance + o.pendingWithdrawals(address(s)), DEPOSIT + 123e18);
        assertEq(address(b).balance + o.pendingWithdrawals(address(b)), 10_000e18 - AMOUNT + (RESERVE - 123e18));
        assertEq(address(o).balance, o.totalPending());
        // credits are withdrawable even with a return-bomb recipient (withdraw never copies returndata)
        if (o.pendingWithdrawals(address(s)) != 0) {
            vm.prank(address(s));
            o.withdraw();
        }
        if (o.pendingWithdrawals(address(b)) != 0) {
            vm.prank(address(b));
            o.withdraw();
        }
        assertEq(address(o).balance, 0);
    }

    // ------------------------------------------------------------ forced ETH

    function test_ForcedEth_BeforeFunding_ReturnsToBuyerAtSettlement() public {
        vm.deal(address(order), 7e18);
        _accept(order);
        // funding uses msg.value, not balance: forced ETH cannot break fund()
        uint256 b = buyer.balance;
        _fund(order);
        assertEq(address(order).balance, RESERVE + 7e18);
        assertEq(order.reserveRemaining(), RESERVE);
        _evidence(order);
        vm.expectEmit(true, false, false, true, address(order));
        emit SeldraOrder.ExcessReturned(buyer, 7e18);
        vm.prank(buyer);
        order.approveRelease();
        assertEq(buyer.balance, b - AMOUNT + 7e18);
        assertEq(supplier.balance, AMOUNT);
        assertEq(address(order).balance, 0);
    }

    function test_ForcedEth_DuringFunded_RefundPathReturnsExcessToo() public {
        _toFunded(order);
        vm.deal(address(order), address(order).balance + 3e18);
        uint256 b = buyer.balance;
        vm.warp(shipDl + 1);
        vm.prank(buyer);
        order.claimShipmentRefund();
        assertEq(buyer.balance, b + RESERVE + 3e18);
        assertEq(address(order).balance, 0);
    }

    function test_ForcedEth_DuringDispute_SupplierGetsNoneOfIt() public {
        _toDisputed(order);
        vm.deal(address(order), address(order).balance + 4e18);
        uint256 b = buyer.balance;
        vm.prank(arbiter);
        order.resolveDispute(RESERVE); // everything to supplier
        assertEq(supplier.balance, AMOUNT);
        assertEq(buyer.balance, b + 4e18);
        assertEq(address(order).balance, 0);
    }

    function test_ForcedEth_DisputeFallback_ExcessToBuyer() public {
        _toDisputed(order);
        vm.deal(address(order), address(order).balance + 4e18);
        uint256 b = buyer.balance;
        vm.warp(dispDl + 1);
        order.claimDisputeFallback();
        assertEq(buyer.balance, b + (RESERVE - (RESERVE * FB_BPS) / 10_000) + 4e18);
        assertEq(address(order).balance, 0);
    }

    function test_ForcedEth_AfterSettlement_StaysStuck_NoOneCanTakeIt() public {
        _runPath(order, 2, 0);
        vm.deal(address(order), 9e18);
        uint256 sBefore = supplier.balance;
        uint256 bBefore = buyer.balance;
        address[4] memory all = [buyer, supplier, arbiter, stranger];
        for (uint8 f = 0; f < 4; f++) {
            vm.startPrank(all[f]);
            vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
            order.withdraw();
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            order.cancelBeforeFunding();
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            order.claimDisputeFallback();
            vm.stopPrank();
        }
        assertEq(address(order).balance, 9e18);
        assertEq(supplier.balance, sBefore);
        assertEq(buyer.balance, bBefore);
        assertTrue(order.accountingInvariantHolds());
    }

    function test_ForcedEth_AfterSettlement_DoesNotBreakPendingWithdraw() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        vm.deal(address(o), address(o).balance + 1e18);
        s.setMode(Actor.Mode.ACCEPT);
        vm.prank(address(s));
        o.withdraw();
        assertEq(address(s).balance, AMOUNT);
        assertEq(address(o).balance, 1e18); // the forced donation is stuck, nothing else
    }

    function test_ForcedEth_RealSelfdestruct_ReturnsToBuyerOnCancel() public {
        new Forcer{value: 2e18}(payable(address(order)));
        assertEq(address(order).balance, 2e18);
        // cannot be seen as funding
        assertEq(order.reserveRemaining(), 0);
        uint256 b = buyer.balance;
        vm.prank(buyer);
        order.cancelBeforeFunding();
        assertEq(buyer.balance, b + 2e18);
    }

    function test_ForcedEth_RealSelfdestruct_MidLifecycle() public {
        _toSubmitted(order);
        vm.deal(address(this), 1e18);
        new Forcer{value: 1e18}(payable(address(order)));
        uint256 b = buyer.balance;
        vm.prank(buyer);
        order.approveRelease();
        assertEq(buyer.balance, b + 1e18);
        assertEq(supplier.balance, AMOUNT);
        assertEq(address(order).balance, 0);
    }

    function test_ForcedEth_WithPendingCredit_ExcessGoesToBuyerNotCreditPool() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _toFunded(o);
        // deposit is already pending (DEPOSIT); add forced ETH and settle
        vm.deal(address(o), address(o).balance + 5e18);
        address b = o.buyer();
        uint256 bBefore = b.balance;
        vm.warp(shipDl + 1);
        vm.prank(b);
        o.claimShipmentRefund();
        assertEq(b.balance, bBefore + RESERVE + 5e18);
        assertEq(o.pendingWithdrawals(address(s)), DEPOSIT);
        assertEq(address(o).balance, DEPOSIT);
        assertEq(o.totalPending(), DEPOSIT);
    }

    // ------------------------------------------------------------ direct transfers / unknown calls

    function test_DirectTransfersAndUnknownCalls_AlwaysRevert_InEveryStatus() public {
        vm.deal(stranger, 100e18);
        for (uint8 s = 0; s <= 5; s++) {
            SeldraOrder o = _mk(buyer, supplier, arbiter);
            if (s == 5) {
                vm.prank(buyer);
                o.cancelBeforeFunding();
            } else {
                _drive(o, SeldraOrder.Status(s));
            }
            uint256 bal = address(o).balance;
            vm.startPrank(stranger);
            (bool ok, bytes memory r) = address(o).call{value: 1e18}("");
            assertFalse(ok);
            assertEq(bytes4(r), SeldraOrder.DirectTransferRejected.selector);
            (ok,) = address(o).call("");
            assertFalse(ok);
            (ok,) = address(o).call{value: 1}(hex"deadbeef");
            assertFalse(ok);
            (ok,) = address(o).call(hex"deadbeef");
            assertFalse(ok);
            (ok,) = address(o).call(abi.encodeWithSignature("selfdestruct()"));
            assertFalse(ok);
            (ok,) = address(o).call{value: 1}(abi.encodeWithSignature("deposit()"));
            assertFalse(ok);
            vm.stopPrank();
            assertEq(address(o).balance, bal);
            // transfer()/send() style (2300 gas) also fail
            assertFalse(payable(address(o)).send(0));
        }
    }

    // ------------------------------------------------------------ wrong msg.value / payable surface

    function test_ValueOnNonPayableFunctions_Reverts() public {
        _toSubmitted(order);
        vm.deal(buyer, 10e18);
        vm.deal(supplier, 10e18);
        bytes[4] memory calls = [
            abi.encodeCall(order.approveRelease, ()),
            abi.encodeCall(order.openDispute, (REASON)),
            abi.encodeCall(order.withdraw, ()),
            abi.encodeCall(order.cancelBeforeFunding, ())
        ];
        for (uint256 i = 0; i < calls.length; i++) {
            vm.prank(buyer);
            (bool ok,) = address(order).call{value: 1}(calls[i]);
            assertFalse(ok);
        }
        vm.prank(supplier);
        (bool ok2,) = address(order).call{value: 1}(abi.encodeCall(order.claimDecisionTimeout, ()));
        assertFalse(ok2);
        assertEq(address(order).balance, RESERVE);
    }

    function test_Fund_Twice_Reverts_NoDoublePayment() public {
        _toFunded(order);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.fund{value: AMOUNT}();
        assertEq(supplier.balance, DEPOSIT);
        assertEq(address(order).balance, RESERVE);
    }

    function test_Fund_BeforeAcceptance_Reverts() public {
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.fund{value: AMOUNT}();
    }

    // ------------------------------------------------------------ double settlement, every path

    function test_DoubleSettlement_ImpossibleOnEveryPath() public {
        for (uint8 p = 0; p <= 5; p++) {
            SeldraOrder o = _mk(buyer, supplier, arbiter);
            _runPath(o, p, 111e18);
            uint256 sBal = supplier.balance;
            uint256 bBal = buyer.balance;
            vm.warp(o.disputeDeadline() + 1 days);
            vm.startPrank(buyer);
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.claimShipmentRefund();
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.approveRelease();
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.cancelBeforeFunding();
            vm.stopPrank();
            vm.prank(supplier);
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.claimDecisionTimeout();
            vm.prank(arbiter);
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.resolveDispute(0);
            vm.expectRevert(SeldraOrder.InvalidStatus.selector);
            o.claimDisputeFallback();
            assertEq(supplier.balance, sBal);
            assertEq(buyer.balance, bBal);
            assertEq(address(o).balance, 0);
            vm.warp(t0);
        }
    }

    // ------------------------------------------------------------ front-running: dispute vs approve vs timeout

    function test_FrontRun_DisputeThenApprove_ApproveFails() public {
        _toSubmitted(order);
        _dispute(order);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.approveRelease();
        vm.warp(decDl + 1);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.claimDecisionTimeout(); // supplier cannot sneak the reserve out of a dispute
        assertEq(order.reserveRemaining(), RESERVE);
    }

    function test_FrontRun_ApproveThenDispute_DisputeFails() public {
        _toSubmitted(order);
        vm.prank(buyer);
        order.approveRelease();
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.openDispute(REASON);
        assertEq(supplier.balance, AMOUNT);
    }

    function test_FrontRun_AtDecisionDeadline_BuyerWinsOverSupplierTimeout() public {
        _toSubmitted(order);
        vm.warp(decDl);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.DeadlineNotPassed.selector);
        order.claimDecisionTimeout();
        _dispute(order); // buyer still in time in the same second
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.DISPUTED));
    }

    function test_FrontRun_OneSecondLater_SupplierWinsOverLateDispute() public {
        _toSubmitted(order);
        vm.warp(decDl + 1);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.openDispute(REASON);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.DeadlinePassed.selector);
        order.approveRelease();
        vm.prank(supplier);
        order.claimDecisionTimeout();
        assertEq(supplier.balance, AMOUNT);
    }

    function test_FrontRun_ArbiterCannotResolveBeforeDispute() public {
        _toSubmitted(order);
        vm.prank(arbiter);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.resolveDispute(0);
    }

    function test_FrontRun_SupplierCannotResubmitEvidenceAfterDispute() public {
        _toDisputed(order);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.submitEvidence(keccak256("other"));
        assertEq(order.evidenceHash(), EVID);
    }

    function test_FrontRun_SupplierCannotAcceptAfterFundingOrCancellation() public {
        _toFunded(order);
        vm.prank(supplier);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.acceptTerms();
    }

    function test_FundingCannotBeCancelledByBuyerOnceFunded() public {
        _toFunded(order);
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.cancelBeforeFunding();
        vm.warp(fundingDl + 1);
        vm.prank(stranger);
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        order.cancelBeforeFunding();
    }

    // ------------------------------------------------------------ immutability across lifecycle

    function test_TermsUnchangedThroughLifecycle() public {
        SeldraOrder.Summary memory a = order.orderSummary();
        _runPath(order, 4, 77e18);
        SeldraOrder.Summary memory z = order.orderSummary();
        assertEq(z.buyer, a.buyer);
        assertEq(z.supplier, a.supplier);
        assertEq(z.arbiter, a.arbiter);
        assertEq(z.orderAmount, a.orderAmount);
        assertEq(z.depositAmount, a.depositAmount);
        assertEq(z.reserveAmount, a.reserveAmount);
        assertEq(z.depositBps, a.depositBps);
        assertEq(z.fallbackSupplierBps, a.fallbackSupplierBps);
        assertEq(z.referenceHash, a.referenceHash);
        assertEq(z.fundingDeadline, a.fundingDeadline);
        assertEq(z.shipmentDeadline, a.shipmentDeadline);
        assertEq(z.buyerDecisionDeadline, a.buyerDecisionDeadline);
        assertEq(z.disputeDeadline, a.disputeDeadline);
        assertEq(z.termsHash, a.termsHash);
        assertEq(z.createdAtBlock, a.createdAtBlock);
    }
}
