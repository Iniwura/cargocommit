// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";
import {Actor} from "./Actors.sol";

abstract contract SeldraTestBase is Test {
    SeldraFactory internal factory;
    SeldraOrder internal order;

    address internal buyer = makeAddr("buyer");
    address internal supplier = makeAddr("supplier");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal victim = makeAddr("victim");

    uint256 internal constant AMOUNT = 1_000e18; // 1000 USDC (18-dec native units)
    uint16 internal constant DEP_BPS = 2_000; // 20%
    uint16 internal constant FB_BPS = 3_000; // 30% of reserve to supplier on fallback
    uint256 internal constant DEPOSIT = 200e18;
    uint256 internal constant RESERVE = 800e18;
    bytes32 internal constant REF = keccak256("PO-1");
    bytes32 internal constant EVID = keccak256("evidence");
    bytes32 internal constant REASON = keccak256("reason");

    uint256 internal t0;
    uint256 internal fundingDl;
    uint256 internal shipDl;
    uint256 internal decDl;
    uint256 internal dispDl;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.roll(1000);
        t0 = block.timestamp;
        fundingDl = t0 + 1 days;
        shipDl = t0 + 11 days;
        decDl = t0 + 21 days;
        dispDl = t0 + 31 days;
        factory = new SeldraFactory();
        vm.deal(buyer, 1_000_000e18);
        order = _mk(buyer, supplier, arbiter);
    }

    // ------------------------------------------------------------------ builders

    function _params(address s, address a) internal view returns (SeldraFactory.OrderParams memory p) {
        p = SeldraFactory.OrderParams({
            supplier: s,
            arbiter: a,
            orderAmount: AMOUNT,
            depositBps: DEP_BPS,
            fallbackSupplierBps: FB_BPS,
            referenceHash: REF,
            fundingDeadline: fundingDl,
            shipmentDeadline: shipDl,
            buyerDecisionDeadline: decDl,
            disputeDeadline: dispDl
        });
    }

    function _mk(address b, address s, address a) internal returns (SeldraOrder o) {
        o = _mkWith(b, _params(s, a));
    }

    function _mkWith(address b, SeldraFactory.OrderParams memory p) internal returns (SeldraOrder o) {
        vm.prank(b);
        o = SeldraOrder(payable(factory.createOrder(p)));
    }

    function _terms(address b, SeldraFactory.OrderParams memory p) internal pure returns (SeldraOrder.Terms memory) {
        return SeldraOrder.Terms({
            buyer: b,
            supplier: p.supplier,
            arbiter: p.arbiter,
            orderAmount: p.orderAmount,
            depositBps: p.depositBps,
            fallbackSupplierBps: p.fallbackSupplierBps,
            referenceHash: p.referenceHash,
            fundingDeadline: p.fundingDeadline,
            shipmentDeadline: p.shipmentDeadline,
            buyerDecisionDeadline: p.buyerDecisionDeadline,
            disputeDeadline: p.disputeDeadline
        });
    }

    // ------------------------------------------------------------------ actions (as the right role)

    function _accept(SeldraOrder o) internal {
        vm.prank(o.supplier());
        o.acceptTerms();
    }

    function _fund(SeldraOrder o) internal {
        address b = o.buyer();
        uint256 amt = o.orderAmount();
        if (b.balance < amt) vm.deal(b, amt);
        vm.prank(b);
        o.fund{value: amt}();
    }

    function _evidence(SeldraOrder o) internal {
        vm.prank(o.supplier());
        o.submitEvidence(EVID);
    }

    function _dispute(SeldraOrder o) internal {
        vm.prank(o.buyer());
        o.openDispute(REASON);
    }

    function _toAccepted(SeldraOrder o) internal {
        _accept(o);
    }

    function _toFunded(SeldraOrder o) internal {
        _accept(o);
        _fund(o);
    }

    function _toSubmitted(SeldraOrder o) internal {
        _toFunded(o);
        _evidence(o);
    }

    function _toDisputed(SeldraOrder o) internal {
        _toSubmitted(o);
        _dispute(o);
    }

    /// @dev Drives a fresh order into `s` (CREATED..DISPUTED) at current time.
    function _drive(SeldraOrder o, SeldraOrder.Status s) internal {
        if (s == SeldraOrder.Status.CREATED) return;
        if (s == SeldraOrder.Status.ACCEPTED) return _toAccepted(o);
        if (s == SeldraOrder.Status.FUNDED) return _toFunded(o);
        if (s == SeldraOrder.Status.SHIPMENT_SUBMITTED) return _toSubmitted(o);
        if (s == SeldraOrder.Status.DISPUTED) return _toDisputed(o);
        revert("drive: unsupported status");
    }

    function _st(SeldraOrder o) internal view returns (SeldraOrder.Status) {
        return o.status();
    }

    function _out(SeldraOrder o) internal view returns (SeldraOrder.Outcome) {
        return o.outcome();
    }

    function _newActor(Actor.Mode m, SeldraOrder o) internal returns (Actor a) {
        a = new Actor();
        a.setMode(m);
        if (address(o) != address(0)) a.setTarget(address(o));
    }

    /// @dev Runs a fresh order to settlement. path: 0 cancel, 1 shipment refund, 2 approve,
    ///      3 decision timeout, 4 arbiter resolve (split of the reserve), 5 dispute fallback.
    function _runPath(SeldraOrder o, uint8 path, uint256 split) internal {
        _runPathForced(o, path, split, 0, 0);
    }

    function _force(SeldraOrder o, uint256 amount) internal {
        vm.deal(address(o), address(o).balance + amount);
    }

    /// @dev Like `_runPath`, additionally force-feeds `forced` wei: when 0 = while CREATED, 1 = right after
    ///      funding (right before cancel for path 0), 2 = after settlement.
    function _runPathForced(SeldraOrder o, uint8 path, uint256 split, uint256 forced, uint8 when_) internal {
        if (when_ == 0) _force(o, forced);
        _runCore(o, path, split, forced, when_);
        if (when_ == 2) _force(o, forced);
    }

    function _runCore(SeldraOrder o, uint8 path, uint256 split, uint256 forced, uint8 when_) private {
        address b = o.buyer();
        address s = o.supplier();
        address a = o.arbiter();
        if (path == 0) {
            if (when_ == 1) _force(o, forced);
            vm.prank(b);
            o.cancelBeforeFunding();
            return;
        }
        _toFunded(o);
        if (when_ == 1) _force(o, forced);
        if (path == 1) {
            vm.warp(o.shipmentDeadline() + 1);
            vm.prank(b);
            o.claimShipmentRefund();
            return;
        }
        _evidence(o);
        if (path == 2) {
            vm.prank(b);
            o.approveRelease();
            return;
        }
        if (path == 3) {
            vm.warp(o.buyerDecisionDeadline() + 1);
            vm.prank(s);
            o.claimDecisionTimeout();
            return;
        }
        _dispute(o);
        if (path == 4) {
            uint256 payout = bound(split, 0, o.reserveAmount());
            vm.prank(a);
            o.resolveDispute(payout);
            return;
        }
        vm.warp(o.disputeDeadline() + 1);
        o.claimDisputeFallback();
    }

    function _hostile(Actor.Mode sm, Actor.Mode bm) internal returns (SeldraOrder o, Actor s, Actor b) {
        s = new Actor();
        b = new Actor();
        o = _mk(address(b), address(s), arbiter);
        s.setTarget(address(o));
        b.setTarget(address(o));
        s.setMode(sm);
        b.setMode(bm);
        vm.deal(address(b), 10_000e18);
    }
}
