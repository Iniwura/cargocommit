// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";
import {Actor} from "./Actors.sol";

contract SeldraOrderFuzzTest is SeldraTestBase {
    struct Cfg {
        uint256 units; // orderAmount / 1e12
        uint16 depBps;
        uint16 fbBps;
        uint8 path;
        uint256 split;
        uint256 forced;
        uint8 when_;
        uint8 sMode;
        uint8 bMode;
    }

    // ------------------------------------------------------------ conservation across any terms / path / recipient behaviour

    function testFuzz_Conservation_AnyTermsPathAndRecipients(Cfg memory c) public {
        c.units = bound(c.units, 1, 1e12);
        c.depBps = uint16(bound(c.depBps, 1, 9_999));
        c.fbBps = uint16(bound(c.fbBps, 0, 10_000));
        c.path = uint8(bound(c.path, 0, 5));
        c.forced = bound(c.forced, 0, 1e21);
        c.when_ = uint8(bound(c.when_, 0, 2));
        Actor s = new Actor();
        Actor b = new Actor();
        s.setMode(Actor.Mode(bound(c.sMode, 0, 6)));
        b.setMode(Actor.Mode(bound(c.bMode, 0, 6)));
        uint256 amount = c.units * 1e12;

        SeldraFactory.OrderParams memory p = _params(address(s), arbiter);
        p.orderAmount = amount;
        p.depositBps = c.depBps;
        p.fallbackSupplierBps = c.fbBps;
        SeldraOrder o = _mkWith(address(b), p);
        s.setTarget(address(o));
        b.setTarget(address(o));
        vm.deal(address(b), amount); // buyer owns exactly the order amount
        assertEq(address(s).balance, 0);

        _runPathForced(o, c.path, c.split, c.forced, c.when_);

        _verify(c, o, s, b);
    }

    function _expectedSupplier(Cfg memory c, SeldraOrder o) internal view returns (uint256 sE) {
        uint256 deposit = o.depositAmount();
        uint256 reserve = o.reserveAmount();
        assertEq(deposit + reserve, o.orderAmount());
        if (c.path == 1) sE = deposit;
        else if (c.path == 2 || c.path == 3) sE = o.orderAmount();
        else if (c.path == 4) sE = deposit + bound(c.split, 0, reserve);
        else if (c.path == 5) sE = deposit + (reserve * c.fbBps) / 10_000;
    }

    function _verify(Cfg memory c, SeldraOrder o, Actor s, Actor b) internal {
        assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
        assertEq(o.reserveRemaining(), 0);
        assertTrue(o.accountingInvariantHolds());

        uint256 sE = _expectedSupplier(c, o);
        uint256 stuck = c.when_ == 2 ? c.forced : 0;
        uint256 bE = o.orderAmount() - sE + (c.forced - stuck);
        uint256 pendS = o.pendingWithdrawals(address(s));
        uint256 pendB = o.pendingWithdrawals(address(b));
        assertEq(address(s).balance + pendS, sE, "supplier total");
        assertEq(address(b).balance + pendB, bE, "buyer total");
        assertEq(o.totalPending(), pendS + pendB);
        assertEq(address(o).balance, pendS + pendB + stuck);
        assertFalse(s.reentrySucceeded());
        assertFalse(b.reentrySucceeded());

        // everyone becomes cooperative and pulls their credit
        s.setMode(Actor.Mode.ACCEPT);
        b.setMode(Actor.Mode.ACCEPT);
        if (pendS != 0) {
            vm.prank(address(s));
            o.withdraw();
        }
        if (pendB != 0) {
            vm.prank(address(b));
            o.withdraw();
        }
        assertEq(address(o).balance, stuck, "only forced-after-settlement dust may remain");
        assertEq(o.totalPending(), 0);
        assertEq(address(s).balance, sE);
        assertEq(address(b).balance, bE);
        assertEq(address(s).balance + address(b).balance + stuck, o.orderAmount() + c.forced, "conservation");
        // no second withdrawal possible
        vm.prank(address(s));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
        vm.prank(address(b));
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
    }

    // ------------------------------------------------------------ simple EOAs, all terms

    function testFuzz_EOA_SplitsSumToOrderAmount(uint256 units, uint16 depBps, uint16 fbBps, uint256 split, uint8 path)
        public
    {
        units = bound(units, 1, 1e12);
        depBps = uint16(bound(depBps, 1, 9_999));
        fbBps = uint16(bound(fbBps, 0, 10_000));
        path = uint8(bound(path, 1, 5));
        uint256 amount = units * 1e12;
        address s = makeAddr("fs");
        address a = makeAddr("fa");
        SeldraFactory.OrderParams memory p = _params(s, a);
        p.orderAmount = amount;
        p.depositBps = depBps;
        p.fallbackSupplierBps = fbBps;
        SeldraOrder o = _mkWith(buyer, p);
        uint256 bBefore = buyer.balance;
        _runPath(o, path, split);
        assertEq(address(o).balance, 0);
        assertEq(o.totalPending(), 0);
        // net: supplier + (buyer's refund) == amount, i.e. buyer's total outflow equals supplier's inflow
        assertEq(s.balance + (buyer.balance - (bBefore - amount)), amount);
        assertEq(bBefore - buyer.balance, s.balance);
        assertGe(s.balance, o.depositAmount()); // deposit is never at stake
    }

    function testFuzz_ArbiterSplit_ExactAndBounded(uint256 payout) public {
        _toDisputed(order);
        uint256 bBefore = buyer.balance;
        if (payout > RESERVE) {
            vm.prank(arbiter);
            vm.expectRevert(abi.encodeWithSelector(SeldraOrder.InvalidPayout.selector, payout, RESERVE));
            order.resolveDispute(payout);
            assertEq(order.reserveRemaining(), RESERVE);
            return;
        }
        vm.prank(arbiter);
        order.resolveDispute(payout);
        assertEq(supplier.balance, DEPOSIT + payout);
        assertEq(buyer.balance, bBefore + RESERVE - payout);
        assertEq(address(order).balance, 0);
    }

    function testFuzz_FallbackMath(uint16 fbBps, uint256 units, uint16 depBps) public {
        fbBps = uint16(bound(fbBps, 0, 10_000));
        depBps = uint16(bound(depBps, 1, 9_999));
        units = bound(units, 1, 1e12);
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fallbackSupplierBps = fbBps;
        p.depositBps = depBps;
        p.orderAmount = units * 1e12;
        SeldraOrder o = _mkWith(buyer, p);
        _toDisputed(o);
        vm.warp(dispDl + 1);
        uint256 sBefore = supplier.balance;
        o.claimDisputeFallback();
        uint256 expected = (o.reserveAmount() * fbBps) / 10_000;
        assertEq(supplier.balance - sBefore, expected);
        assertLe(expected, o.reserveAmount());
    }

    function testFuzz_DepositMath(uint256 units, uint16 depBps) public {
        units = bound(units, 1, 1e12);
        depBps = uint16(bound(depBps, 1, 9_999));
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = units * 1e12;
        p.depositBps = depBps;
        SeldraOrder o = _mkWith(buyer, p);
        assertEq(o.depositAmount(), (p.orderAmount * depBps) / 10_000);
        assertEq(o.depositAmount() + o.reserveAmount(), p.orderAmount);
        assertLt(o.depositAmount(), p.orderAmount);
    }

    // ------------------------------------------------------------ wrong value / strangers

    function testFuzz_Fund_OnlyExactValue(uint256 v) public {
        _accept(order);
        vm.deal(buyer, v > 1e30 ? 1e30 : v);
        v = v > 1e30 ? 1e30 : v;
        vm.prank(buyer);
        (bool ok,) = address(order).call{value: v}(abi.encodeCall(order.fund, ()));
        assertEq(ok, v == AMOUNT);
        assertEq(address(order).balance, v == AMOUNT ? RESERVE : 0);
    }

    function testFuzz_Stranger_CannotCallAnyRestrictedFunction(address who, uint256 dt) public {
        vm.assume(who != buyer && who != supplier && who != arbiter);
        vm.assume(who.code.length == 0);
        assumeNotPrecompile(who);
        assumeNotForgeAddress(who);
        dt = bound(dt, 0, 400 days);
        _toDisputed(order);
        vm.warp(t0 + dt);
        vm.startPrank(who);
        vm.expectRevert(SeldraOrder.NotSupplier.selector);
        order.acceptTerms();
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.fund();
        vm.expectRevert(SeldraOrder.NotSupplier.selector);
        order.submitEvidence(EVID);
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.claimShipmentRefund();
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.approveRelease();
        vm.expectRevert(SeldraOrder.NotSupplier.selector);
        order.claimDecisionTimeout();
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        order.openDispute(REASON);
        vm.expectRevert(SeldraOrder.NotArbiter.selector);
        order.resolveDispute(0);
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        order.withdraw();
        vm.stopPrank();
        assertEq(address(order).balance, RESERVE);
    }

    function testFuzz_ForcedEthNeverReachesSupplierOrArbiter(uint256 forced, uint8 path, uint8 when_) public {
        forced = bound(forced, 1, 1e24);
        path = uint8(bound(path, 0, 5));
        when_ = uint8(bound(when_, 0, 1)); // forced before settlement
        uint256 sBefore = supplier.balance;
        uint256 expectedS = path == 0 ? 0 : (path == 1 ? DEPOSIT : (path >= 2 && path <= 3 ? AMOUNT : 0));
        if (path >= 4) return; // split-dependent; covered by conservation fuzz
        uint256 bBefore = buyer.balance;
        _runPathForced(order, path, 0, forced, when_);
        assertEq(supplier.balance - sBefore, expectedS);
        assertEq(arbiter.balance, 0);
        assertEq(buyer.balance, bBefore - (path == 0 ? 0 : AMOUNT) + (path == 0 ? 0 : AMOUNT - expectedS) + forced);
        assertEq(address(order).balance, 0);
    }
}
