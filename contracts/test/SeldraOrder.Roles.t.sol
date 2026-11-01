// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";

contract SeldraOrderRolesTest is SeldraTestBase {
    // function ids
    uint8 internal constant ACCEPT = 0;
    uint8 internal constant CANCEL = 1;
    uint8 internal constant FUND = 2;
    uint8 internal constant EVIDENCE = 3;
    uint8 internal constant REFUND = 4;
    uint8 internal constant APPROVE = 5;
    uint8 internal constant TIMEOUT = 6;
    uint8 internal constant DISPUTE = 7;
    uint8 internal constant RESOLVE = 8;
    uint8 internal constant FALLBACK = 9;
    uint8 internal constant NFUNCS = 10;

    function _data(uint8 f) internal view returns (bytes memory) {
        if (f == ACCEPT) return abi.encodeCall(order.acceptTerms, ());
        if (f == CANCEL) return abi.encodeCall(order.cancelBeforeFunding, ());
        if (f == FUND) return abi.encodeCall(order.fund, ());
        if (f == EVIDENCE) return abi.encodeCall(order.submitEvidence, (EVID));
        if (f == REFUND) return abi.encodeCall(order.claimShipmentRefund, ());
        if (f == APPROVE) return abi.encodeCall(order.approveRelease, ());
        if (f == TIMEOUT) return abi.encodeCall(order.claimDecisionTimeout, ());
        if (f == DISPUTE) return abi.encodeCall(order.openDispute, (REASON));
        if (f == RESOLVE) return abi.encodeCall(order.resolveDispute, (RESERVE / 2));
        return abi.encodeCall(order.claimDisputeFallback, ());
    }

    function _try(SeldraOrder o, uint8 f, address who) internal returns (bool ok, bytes memory ret) {
        uint256 v = f == FUND ? o.orderAmount() : 0;
        if (v != 0 && who.balance < v) vm.deal(who, v);
        bytes memory d = _data(f);
        vm.prank(who);
        (ok, ret) = address(o).call{value: v}(d);
    }

    function _assertRevertsWith(SeldraOrder o, uint8 f, address who, bytes4 sel) internal {
        (bool ok, bytes memory r) = _try(o, f, who);
        assertFalse(ok, "should revert");
        assertEq(bytes4(r), sel, "wrong selector");
    }

    function _others(address except) internal view returns (address[4] memory a) {
        address[4] memory all = [buyer, supplier, arbiter, stranger];
        uint256 n;
        for (uint256 i = 0; i < 4; i++) {
            if (all[i] != except) a[n++] = all[i];
        }
        a[3] = address(0); // 3 wrong roles; 4th slot unused
    }

    function _wrongRoleSweep(uint8 f, address right, SeldraOrder.Status s, uint256 warpTo, bytes4 sel) internal {
        address[4] memory wrong = _others(right);
        for (uint256 i = 0; i < 3; i++) {
            SeldraOrder o = _mk(buyer, supplier, arbiter);
            _drive(o, s);
            if (warpTo != 0) vm.warp(warpTo);
            _assertRevertsWith(o, f, wrong[i], sel);
            assertEq(uint8(o.status()), uint8(s), "state changed on rejected call");
            vm.warp(t0);
        }
        // and the right role succeeds in the very same state
        SeldraOrder o2 = _mk(buyer, supplier, arbiter);
        _drive(o2, s);
        if (warpTo != 0) vm.warp(warpTo);
        (bool ok,) = _try(o2, f, right);
        assertTrue(ok, "right role must succeed");
    }

    // ------------------------------------------------------------------ role: every function, every wrong role

    function test_Role_AcceptTerms_OnlySupplier() public {
        _wrongRoleSweep(ACCEPT, supplier, SeldraOrder.Status.CREATED, 0, SeldraOrder.NotSupplier.selector);
    }

    function test_Role_Fund_OnlyBuyer() public {
        _wrongRoleSweep(FUND, buyer, SeldraOrder.Status.ACCEPTED, 0, SeldraOrder.NotBuyer.selector);
    }

    function test_Role_SubmitEvidence_OnlySupplier() public {
        _wrongRoleSweep(EVIDENCE, supplier, SeldraOrder.Status.FUNDED, 0, SeldraOrder.NotSupplier.selector);
    }

    function test_Role_ClaimShipmentRefund_OnlyBuyer() public {
        _wrongRoleSweep(REFUND, buyer, SeldraOrder.Status.FUNDED, shipDl + 1, SeldraOrder.NotBuyer.selector);
    }

    function test_Role_ApproveRelease_OnlyBuyer() public {
        _wrongRoleSweep(APPROVE, buyer, SeldraOrder.Status.SHIPMENT_SUBMITTED, 0, SeldraOrder.NotBuyer.selector);
    }

    function test_Role_ClaimDecisionTimeout_OnlySupplier() public {
        _wrongRoleSweep(
            TIMEOUT, supplier, SeldraOrder.Status.SHIPMENT_SUBMITTED, decDl + 1, SeldraOrder.NotSupplier.selector
        );
    }

    function test_Role_OpenDispute_OnlyBuyer() public {
        _wrongRoleSweep(DISPUTE, buyer, SeldraOrder.Status.SHIPMENT_SUBMITTED, 0, SeldraOrder.NotBuyer.selector);
    }

    function test_Role_ResolveDispute_OnlyArbiter() public {
        _wrongRoleSweep(RESOLVE, arbiter, SeldraOrder.Status.DISPUTED, 0, SeldraOrder.NotArbiter.selector);
    }

    function test_Role_Cancel_NonBuyerBeforeFundingDeadlineRejected() public {
        _wrongRoleSweep(CANCEL, buyer, SeldraOrder.Status.CREATED, 0, SeldraOrder.NotBuyer.selector);
        _wrongRoleSweep(CANCEL, buyer, SeldraOrder.Status.ACCEPTED, 0, SeldraOrder.NotBuyer.selector);
    }

    function test_Role_ClaimDisputeFallback_AnyoneAfterDeadline() public {
        address[4] memory all = [buyer, supplier, arbiter, stranger];
        for (uint256 i = 0; i < 4; i++) {
            SeldraOrder o = _mk(buyer, supplier, arbiter);
            _toDisputed(o);
            vm.warp(dispDl + 1);
            (bool ok,) = _try(o, FALLBACK, all[i]);
            assertTrue(ok);
            assertEq(uint8(o.status()), uint8(SeldraOrder.Status.SETTLED));
            vm.warp(t0);
        }
    }

    function test_Role_Cancel_AnyoneAfterFundingDeadline() public {
        address[4] memory all = [buyer, supplier, arbiter, stranger];
        for (uint256 i = 0; i < 4; i++) {
            SeldraOrder o = _mk(buyer, supplier, arbiter);
            vm.warp(fundingDl + 1);
            (bool ok,) = _try(o, CANCEL, all[i]);
            assertTrue(ok);
            vm.warp(t0);
        }
    }

    function test_Role_Withdraw_NothingForAnyoneWithoutCredit() public {
        _toFunded(order);
        address[4] memory all = [buyer, supplier, arbiter, stranger];
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(all[i]);
            vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
            order.withdraw();
        }
    }

    function test_Role_RolesAreNotInterchangeableAcrossOrders() public {
        // buyer of `order` is only a stranger for another order
        SeldraOrder o2 = _mk(stranger, victim, makeAddr("arb2"));
        _accept(o2);
        assertEq(buyer == o2.buyer(), false);
        _assertRevertsWith(o2, FUND, buyer, SeldraOrder.NotBuyer.selector);
        _assertRevertsWith(o2, ACCEPT, buyer, SeldraOrder.NotSupplier.selector);
        _assertRevertsWith(o2, RESOLVE, buyer, SeldraOrder.NotArbiter.selector);
    }

    // ------------------------------------------------------------------ status: every function in every wrong status

    function _allowed(uint8 f, uint8 s) internal pure returns (bool) {
        // statuses: 0 CREATED 1 ACCEPTED 2 FUNDED 3 SUBMITTED 4 DISPUTED 5 SETTLED
        if (f == ACCEPT) return s == 0;
        if (f == CANCEL) return s == 0 || s == 1;
        if (f == FUND) return s == 1;
        if (f == EVIDENCE || f == REFUND) return s == 2;
        if (f == APPROVE || f == TIMEOUT || f == DISPUTE) return s == 3;
        return s == 4; // RESOLVE, FALLBACK
    }

    function _rightCaller(uint8 f) internal view returns (address) {
        if (f == ACCEPT || f == EVIDENCE || f == TIMEOUT) return supplier;
        if (f == CANCEL) return buyer;
        if (f == FUND || f == REFUND || f == APPROVE || f == DISPUTE) return buyer;
        if (f == RESOLVE) return arbiter;
        return stranger;
    }

    function test_WrongStatus_EveryFunctionRevertsInvalidStatus() public {
        for (uint8 f = 0; f < NFUNCS; f++) {
            for (uint8 s = 0; s <= 5; s++) {
                if (_allowed(f, s)) continue;
                SeldraOrder o = _mk(buyer, supplier, arbiter);
                if (s == 5) {
                    vm.prank(buyer);
                    o.cancelBeforeFunding();
                } else {
                    _drive(o, SeldraOrder.Status(s));
                }
                // Use a time that satisfies each fn's deadline condition, so only status can be the reason.
                if (f == REFUND || f == TIMEOUT || f == FALLBACK || f == CANCEL) vm.warp(dispDl + 1);
                (bool ok, bytes memory r) = _try(o, f, _rightCaller(f));
                assertFalse(ok, "wrong status must revert");
                assertEq(bytes4(r), SeldraOrder.InvalidStatus.selector);
                vm.warp(t0);
            }
        }
    }

    function test_Settled_IsTerminal_NoFunctionWorksAgain() public {
        _toSubmitted(order);
        vm.prank(buyer);
        order.approveRelease();
        vm.warp(dispDl + 100 days);
        for (uint8 f = 0; f < NFUNCS; f++) {
            (bool ok, bytes memory r) = _try(order, f, _rightCaller(f));
            assertFalse(ok);
            assertEq(bytes4(r), SeldraOrder.InvalidStatus.selector);
        }
        assertEq(address(order).balance, 0);
    }
}
