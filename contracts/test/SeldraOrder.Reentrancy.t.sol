// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {Actor} from "./Actors.sol";

/// Hostile contracts try to re-enter every nonReentrant function from inside the payout callback.
contract SeldraOrderReentrancyTest is SeldraTestBase {

    // nonReentrant functions the role can actually call (role modifiers run before the lock):
    // supplier: cancel, submitEvidence, claimDecisionTimeout, claimDisputeFallback, withdraw
    uint256 internal constant SUPPLIER_FNS = 5;
    // buyer: cancel, fund, claimShipmentRefund, approveRelease, openDispute, claimDisputeFallback, withdraw
    uint256 internal constant BUYER_FNS = 7;

    function _assertNoReentry(Actor a, uint256 expectedHits, uint256 perHit) internal view {
        assertFalse(a.reentrySucceeded(), "reentrancy succeeded");
        assertEq(a.reentryBlocked(), expectedHits * perHit, "unexpected number of blocked reentries");
    }

    // ------------------------------------------------------------ malicious supplier

    function test_ReentrantSupplier_ApprovePath() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        _assertNoReentry(s, 2, SUPPLIER_FNS); // deposit + reserve
        assertEq(address(s).balance, AMOUNT);
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
    }

    function test_ReentrantSupplier_TimeoutPath() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _runPath(o, 3, 0);
        _assertNoReentry(s, 2, SUPPLIER_FNS);
        assertEq(address(s).balance, AMOUNT);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantSupplier_ResolvePath() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _runPath(o, 4, 300e18);
        _assertNoReentry(s, 2, SUPPLIER_FNS);
        assertEq(address(s).balance, DEPOSIT + 300e18);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantSupplier_FallbackPath() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _runPath(o, 5, 0);
        _assertNoReentry(s, 2, SUPPLIER_FNS);
        assertEq(address(s).balance, DEPOSIT + (RESERVE * FB_BPS) / 10_000);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantSupplier_DepositPaymentOnFund() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _toFunded(o);
        _assertNoReentry(s, 1, SUPPLIER_FNS);
        assertEq(address(s).balance, DEPOSIT);
        assertEq(address(o).balance, RESERVE);
        assertEq(o.reserveRemaining(), RESERVE);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.FUNDED));
    }

    function test_ReentrantSupplier_RefundPath_OnlyDepositHook() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER, Actor.Mode.ACCEPT);
        _runPath(o, 1, 0);
        _assertNoReentry(s, 1, SUPPLIER_FNS);
    }

    // ------------------------------------------------------------ malicious buyer

    function test_ReentrantBuyer_RefundPath() public {
        (SeldraOrder o,, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REENTER);
        uint256 before_ = address(b).balance;
        _runPath(o, 1, 0);
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(b).balance, before_ - AMOUNT + RESERVE);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantBuyer_ResolvePath() public {
        (SeldraOrder o,, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REENTER);
        uint256 before_ = address(b).balance;
        _runPath(o, 4, 100e18);
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(b).balance, before_ - AMOUNT + 700e18);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantBuyer_FallbackPath() public {
        (SeldraOrder o,, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REENTER);
        uint256 before_ = address(b).balance;
        _runPath(o, 5, 0);
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(b).balance, before_ - AMOUNT + RESERVE - (RESERVE * FB_BPS) / 10_000);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantBuyer_CancelPath_WithForcedExcess() public {
        (SeldraOrder o,, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REENTER);
        vm.deal(address(o), 5e18);
        uint256 before_ = address(b).balance;
        _runPath(o, 0, 0);
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(b).balance, before_ + 5e18);
        assertEq(address(o).balance, 0);
    }

    function test_ReentrantBuyer_ApprovePath_ReceivesOnlyForcedExcess() public {
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.ACCEPT, Actor.Mode.REENTER);
        _toSubmitted(o);
        vm.deal(address(o), address(o).balance + 2e18);
        uint256 before_ = address(b).balance;
        vm.prank(address(b));
        o.approveRelease();
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(b).balance, before_ + 2e18);
        assertEq(address(s).balance, AMOUNT);
    }

    // ------------------------------------------------------------ malicious arbiter

    function test_ReentrantArbiter_NeverReceivesValueNorReenters() public {
        Actor arb = new Actor();
        arb.setMode(Actor.Mode.REENTER);
        SeldraOrder o = _mk(buyer, supplier, address(arb));
        arb.setTarget(address(o));
        _toDisputed(o);
        vm.prank(address(arb)); // arbiter contract resolves
        o.resolveDispute(RESERVE / 4);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(address(arb).balance, 0, "arbiter must never be paid");
        assertEq(arb.reentryBlocked(), 0);
        assertFalse(arb.reentrySucceeded());
        // arbiter can neither withdraw, nor resolve twice
        vm.startPrank(address(arb));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
        vm.expectRevert(SeldraOrder.InvalidStatus.selector);
        o.resolveDispute(0);
        vm.stopPrank();
    }

    function test_ReentrantArbiter_AllRecipientsHostile() public {
        Actor arb = new Actor();
        arb.setMode(Actor.Mode.REENTER);
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.REENTER, Actor.Mode.REENTER);
        // re-create so that the arbiter is a hostile contract too
        s = new Actor();
        b = new Actor();
        s.setMode(Actor.Mode.REENTER);
        b.setMode(Actor.Mode.REENTER);
        vm.deal(address(b), 10_000e18);
        o = _mk(address(b), address(s), address(arb));
        s.setTarget(address(o));
        b.setTarget(address(o));
        arb.setTarget(address(o));
        _toDisputed(o);
        vm.prank(address(arb));
        o.resolveDispute(RESERVE / 2);
        assertEq(address(s).balance, DEPOSIT + RESERVE / 2);
        assertEq(address(b).balance, 10_000e18 - AMOUNT + RESERVE / 2);
        assertEq(address(arb).balance, 0);
        assertEq(address(o).balance, 0);
        _assertNoReentry(s, 2, SUPPLIER_FNS);
        _assertNoReentry(b, 1, BUYER_FNS);
    }

    // ------------------------------------------------------------ reentrancy when payout is deferred / withdrawn

    function test_ReentrantRecipient_RevertsAfterReenter_CreditsPending() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REENTER_REVERT, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        assertEq(o.totalPending(), AMOUNT);
        assertEq(address(o).balance, AMOUNT);
        assertEq(address(s).balance, 0);
        assertFalse(s.reentrySucceeded());
    }

    function test_ReentrantWithdraw_SupplierCannotDoubleWithdraw() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT);
        s.setMode(Actor.Mode.REENTER); // now try to re-enter (incl. withdraw) from inside withdraw's payout
        vm.prank(address(s));
        o.withdraw();
        _assertNoReentry(s, 1, SUPPLIER_FNS);
        assertEq(address(s).balance, AMOUNT);
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
    }

    function test_ReentrantWithdraw_DoesNotDrainOtherCredits() public {
        // supplier AND buyer both have credits; supplier's withdraw hook attacks while buyer's credit is outstanding
        (SeldraOrder o, Actor s, Actor b) = _hostile(Actor.Mode.REVERT, Actor.Mode.REVERT);
        _runPath(o, 4, 300e18); // supplier: 200 deposit + 300 ; buyer: 500
        assertEq(o.pendingWithdrawals(address(s)), DEPOSIT + 300e18);
        assertEq(o.pendingWithdrawals(address(b)), 500e18);
        assertEq(address(o).balance, AMOUNT);

        s.setMode(Actor.Mode.REENTER);
        vm.prank(address(s));
        o.withdraw();
        _assertNoReentry(s, 1, SUPPLIER_FNS);
        assertEq(address(s).balance, DEPOSIT + 300e18);
        assertEq(address(o).balance, 500e18, "buyer credit must remain fully backed");
        assertEq(o.pendingWithdrawals(address(b)), 500e18);
        assertEq(o.totalPending(), 500e18);

        // supplier cannot reach the buyer's credit
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();

        b.setMode(Actor.Mode.REENTER);
        vm.prank(address(b));
        o.withdraw();
        _assertNoReentry(b, 1, BUYER_FNS);
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
    }

    function test_ReentrantWithdraw_RevertingHookKeepsCredit() public {
        (SeldraOrder o, Actor s,) = _hostile(Actor.Mode.REVERT, Actor.Mode.ACCEPT);
        _runPath(o, 2, 0);
        s.setMode(Actor.Mode.REENTER_REVERT);
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.WithdrawFailed.selector);
        o.withdraw();
        assertEq(o.pendingWithdrawals(address(s)), AMOUNT, "credit must survive failed withdraw");
        assertEq(o.totalPending(), AMOUNT);
        assertEq(address(o).balance, AMOUNT);
        s.setMode(Actor.Mode.ACCEPT);
        vm.prank(address(s));
        o.withdraw();
        assertEq(address(s).balance, AMOUNT);
    }
}
