// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";
import {Actor} from "./Actors.sol";

/// @dev Drives every action of the orders from many actors (right and wrong roles), with time warps to and
///      around every deadline, forced ETH, and hostile (reverting / gas-burning / re-entering) recipients.
contract SeldraHandler is Test {
    uint256 internal constant N = 2;
    SeldraOrder[N] public orders;
    address[5][N] internal roles; // buyer, supplier, arbiter, strangerA, strangerB
    Actor[N] internal actorBuyer; // order 1 only
    Actor[N] internal actorSupplier; // order 1 only

    uint256[N] public forced;
    uint256[N] public forcedAfterSettlement;
    bool public statusRegressed;
    uint8[N] internal lastStatus;
    uint256 public calls;
    uint256 public settledCount;

    bytes32 internal constant EVID = keccak256("evidence");
    bytes32 internal constant REASON = keccak256("reason");

    constructor(SeldraOrder[N] memory o, address[5][N] memory r, Actor[N] memory ab, Actor[N] memory asup) {
        orders = o;
        roles = r;
        actorBuyer = ab;
        actorSupplier = asup;
    }

    function roleOf(uint256 oi, uint256 idx) external view returns (address) {
        return roles[oi][idx];
    }

    // ---------------------------------------------------------------- core generic action

    function act(uint256 oi, uint256 fn, uint256 whoSeed, uint256 arg) external {
        oi = bound(oi, 0, N - 1);
        fn = bound(fn, 0, 10);
        SeldraOrder o = orders[oi];
        uint256 roleIdx = _rightRole(fn);
        if (whoSeed % 4 == 0) roleIdx = whoSeed / 4 % 5; // 25%: any (possibly wrong) caller
        address who = roles[oi][roleIdx];

        bytes memory data;
        uint256 value;
        if (fn == 0) data = abi.encodeCall(o.acceptTerms, ());
        else if (fn == 1) data = abi.encodeCall(o.cancelBeforeFunding, ());
        else if (fn == 2) {
            data = abi.encodeCall(o.fund, ());
            value = arg % 8 == 0 ? o.orderAmount() + (arg % 3) - 1 : o.orderAmount(); // mostly exact, sometimes off
        } else if (fn == 3) data = abi.encodeCall(o.submitEvidence, (arg % 5 == 0 ? bytes32(0) : EVID));
        else if (fn == 4) data = abi.encodeCall(o.claimShipmentRefund, ());
        else if (fn == 5) data = abi.encodeCall(o.approveRelease, ());
        else if (fn == 6) data = abi.encodeCall(o.claimDecisionTimeout, ());
        else if (fn == 7) data = abi.encodeCall(o.openDispute, (arg % 5 == 0 ? bytes32(0) : REASON));
        else if (fn == 8) data = abi.encodeCall(o.resolveDispute, (arg % 7 == 0 ? type(uint256).max : arg % (o.reserveAmount() + 1)));
        else if (fn == 9) data = abi.encodeCall(o.claimDisputeFallback, ());
        else data = abi.encodeCall(o.withdraw, ());

        _send(oi, who, data, value);
    }

    /// @dev Performs the natural next step for the current status as the right role, warping when needed.
    function advance(uint256 oi, uint256 arg) external {
        oi = bound(oi, 0, N - 1);
        SeldraOrder o = orders[oi];
        SeldraOrder.Status s = o.status();
        address b = roles[oi][0];
        address sup = roles[oi][1];
        address a = roles[oi][2];
        if (s == SeldraOrder.Status.CREATED) {
            _send(oi, sup, abi.encodeCall(o.acceptTerms, ()), 0);
        } else if (s == SeldraOrder.Status.ACCEPTED) {
            if (arg % 6 == 0) {
                _send(oi, b, abi.encodeCall(o.cancelBeforeFunding, ()), 0);
            } else {
                _send(oi, b, abi.encodeCall(o.fund, ()), o.orderAmount());
            }
        } else if (s == SeldraOrder.Status.FUNDED) {
            if (arg % 3 == 0) {
                _warpTo(o.shipmentDeadline() + 1);
                _send(oi, b, abi.encodeCall(o.claimShipmentRefund, ()), 0);
            } else {
                _send(oi, sup, abi.encodeCall(o.submitEvidence, (EVID)), 0);
            }
        } else if (s == SeldraOrder.Status.SHIPMENT_SUBMITTED) {
            uint256 k = arg % 3;
            if (k == 0) {
                _send(oi, b, abi.encodeCall(o.approveRelease, ()), 0);
            } else if (k == 1) {
                _send(oi, b, abi.encodeCall(o.openDispute, (REASON)), 0);
            } else {
                _warpTo(o.buyerDecisionDeadline() + 1);
                _send(oi, sup, abi.encodeCall(o.claimDecisionTimeout, ()), 0);
            }
        } else if (s == SeldraOrder.Status.DISPUTED) {
            if (arg % 2 == 0) {
                _send(oi, a, abi.encodeCall(o.resolveDispute, (arg / 2 % (o.reserveAmount() + 1))), 0);
            } else {
                _warpTo(o.disputeDeadline() + 1);
                _send(oi, roles[oi][3], abi.encodeCall(o.claimDisputeFallback, ()), 0);
            }
        }
        // settled: pull any credits
        else {
            _send(oi, roles[oi][arg % 2], abi.encodeCall(o.withdraw, ()), 0);
        }
    }

    // ---------------------------------------------------------------- environment actions

    function warp(uint256 oi, uint256 kind, uint256 dt) external {
        oi = bound(oi, 0, N - 1);
        SeldraOrder o = orders[oi];
        if (kind % 3 == 0) {
            _warpTo(block.timestamp + bound(dt, 0, 5 days));
        } else {
            uint256[4] memory ds = [o.fundingDeadline(), o.shipmentDeadline(), o.buyerDecisionDeadline(), o.disputeDeadline()];
            _warpTo(ds[dt % 4] + (kind % 3 == 1 ? 0 : 1)); // exactly on, or one second after, a deadline
        }
        calls++;
    }

    function force(uint256 oi, uint256 amount) external {
        oi = bound(oi, 0, N - 1);
        amount = bound(amount, 0, 1e21);
        SeldraOrder o = orders[oi];
        vm.deal(address(o), address(o).balance + amount);
        forced[oi] += amount;
        if (o.status() == SeldraOrder.Status.SETTLED) forcedAfterSettlement[oi] += amount;
        calls++;
    }

    /// @dev Flip the hostile recipient behaviour of order 1's buyer / supplier contracts.
    function setMode(uint256 side, uint256 mode) external {
        Actor a = side % 2 == 0 ? actorBuyer[1] : actorSupplier[1];
        a.setMode(Actor.Mode(bound(mode, 0, 6)));
        calls++;
    }

    // ---------------------------------------------------------------- internals

    function _rightRole(uint256 fn) internal pure returns (uint256) {
        if (fn == 0 || fn == 3 || fn == 6) return 1; // supplier
        if (fn == 1 || fn == 2 || fn == 4 || fn == 5 || fn == 7) return 0; // buyer
        if (fn == 8) return 2; // arbiter
        return 3; // fallback / withdraw: stranger (withdraw by stranger -> NothingToWithdraw)
    }

    function _warpTo(uint256 ts) internal {
        if (ts > block.timestamp) vm.warp(ts);
    }

    function _send(uint256 oi, address who, bytes memory data, uint256 value) internal {
        SeldraOrder o = orders[oi];
        calls++;
        if (who.balance < value) return;
        vm.prank(who);
        (bool ok,) = address(o).call{value: value}(data);
        ok;
        uint8 st = uint8(o.status());
        if (st < lastStatus[oi]) statusRegressed = true;
        if (st == uint8(SeldraOrder.Status.SETTLED) && lastStatus[oi] != st) settledCount++;
        lastStatus[oi] = st;
    }
}

contract SeldraOrderInvariantTest is Test {
    uint256 internal constant N = 2;
    SeldraFactory internal factory;
    SeldraHandler internal handler;
    SeldraOrder[N] internal orders;
    address[5][N] internal roles;
    Actor[N] internal aBuyer;
    Actor[N] internal aSupplier;

    address internal handlerAddr;
    bytes32[N] internal termsSnapshot;
    uint256[N] internal sumStart; // order + buyer + supplier balances at start
    uint256 internal arbiterStart;
    uint256 internal strangerStart;

    uint256 internal constant AMOUNT = 1_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        factory = new SeldraFactory();
        uint256 t0 = block.timestamp;

        for (uint256 i = 0; i < N; i++) {
            roles[i][2] = makeAddr(string.concat("arbiter", vm.toString(i)));
            roles[i][3] = makeAddr(string.concat("strangerA", vm.toString(i)));
            roles[i][4] = makeAddr(string.concat("strangerB", vm.toString(i)));
            if (i == 0) {
                roles[i][0] = makeAddr("buyer0");
                roles[i][1] = makeAddr("supplier0");
            } else {
                aBuyer[i] = new Actor();
                aSupplier[i] = new Actor();
                roles[i][0] = address(aBuyer[i]);
                roles[i][1] = address(aSupplier[i]);
            }
            vm.deal(roles[i][0], 1e30);
            vm.deal(roles[i][3], 1e22);
            vm.deal(roles[i][4], 1e22);
            vm.deal(roles[i][2], 1e18);

            SeldraFactory.OrderParams memory p = SeldraFactory.OrderParams({
                supplier: roles[i][1],
                arbiter: roles[i][2],
                orderAmount: AMOUNT,
                depositBps: 2_500,
                fallbackSupplierBps: 4_000,
                referenceHash: keccak256("inv"),
                fundingDeadline: t0 + 1 days,
                shipmentDeadline: t0 + 11 days,
                buyerDecisionDeadline: t0 + 21 days,
                disputeDeadline: t0 + 31 days
            });
            vm.prank(roles[i][0]);
            orders[i] = SeldraOrder(payable(factory.createOrder(p)));
            if (i == 1) {
                aBuyer[i].setTarget(address(orders[i]));
                aSupplier[i].setTarget(address(orders[i]));
            }
            termsSnapshot[i] = _fixedHash(orders[i]);
            sumStart[i] = roles[i][0].balance + roles[i][1].balance;
        }
        arbiterStart = 1e18;
        strangerStart = 1e22;

        handler = new SeldraHandler(orders, roles, aBuyer, aSupplier);
        handlerAddr = address(handler);
        targetContract(address(handler));
    }

    function _fixedHash(SeldraOrder o) internal view returns (bytes32) {
        return keccak256(abi.encode(_partA(o), _partB(o)));
    }

    function _partA(SeldraOrder o) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                o.buyer(), o.supplier(), o.arbiter(), o.orderAmount(), o.depositAmount(), o.reserveAmount(), o.depositBps()
            )
        );
    }

    function _partB(SeldraOrder o) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                o.fallbackSupplierBps(),
                o.referenceHash(),
                o.fundingDeadline(),
                o.shipmentDeadline(),
                o.buyerDecisionDeadline(),
                o.disputeDeadline(),
                o.termsHash(),
                o.createdAtBlock()
            )
        );
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_BalanceCoversReserveAndPending() public view {
        for (uint256 i = 0; i < N; i++) {
            SeldraOrder o = orders[i];
            assertGe(address(o).balance, o.reserveRemaining() + o.totalPending(), "balance < reserve + pending");
            assertTrue(o.accountingInvariantHolds());
            assertLe(o.reserveRemaining(), o.reserveAmount());
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_SettledImpliesNoReserve_AndExcessSweptToBuyer() public view {
        for (uint256 i = 0; i < N; i++) {
            SeldraOrder o = orders[i];
            if (o.status() == SeldraOrder.Status.SETTLED) {
                assertEq(o.reserveRemaining(), 0, "settled with reserve");
                assertTrue(uint8(o.outcome()) != 0, "settled without outcome");
                // everything above the pending credits is exactly the ETH forced in after settlement
                assertEq(address(o).balance - o.totalPending(), handler.forcedAfterSettlement(i), "unswept excess");
            } else {
                assertEq(uint8(o.outcome()), 0, "outcome set before settlement");
                // before settlement only a deferred deposit payment can be pending
                assertLe(o.totalPending(), o.depositAmount(), "unexpected pending before settlement");
            }
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_TermsNeverChange() public view {
        for (uint256 i = 0; i < N; i++) {
            assertEq(_fixedHash(orders[i]), termsSnapshot[i], "terms mutated");
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_NoEthLeavesExceptToBuyerSupplierOrPending() public view {
        for (uint256 i = 0; i < N; i++) {
            SeldraOrder o = orders[i];
            address b = roles[i][0];
            address s = roles[i][1];
            // value only enters via forced ETH; all of it sits in the order or with buyer / supplier
            assertEq(address(o).balance + b.balance + s.balance, sumStart[i] + handler.forced(i), "value leaked");
            // nobody else ever gains
            assertEq(roles[i][2].balance, arbiterStart, "arbiter gained");
            assertEq(roles[i][3].balance, strangerStart, "stranger A gained");
            assertEq(roles[i][4].balance, strangerStart, "stranger B gained");
            // credits only belong to buyer / supplier and add up
            assertEq(o.pendingWithdrawals(b) + o.pendingWithdrawals(s), o.totalPending(), "foreign credit");
            assertEq(o.pendingWithdrawals(roles[i][2]), 0);
            // supplier can never collect more than the order amount
            assertLe(s.balance + o.pendingWithdrawals(s), AMOUNT);
        }
        assertEq(address(factory).balance, 0);
        assertEq(handlerAddr.balance, 0);
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_StatusOnlyMovesForward_AndHostileRecipientsNeverReenter() public view {
        assertFalse(handler.statusRegressed(), "status regressed");
        for (uint256 i = 1; i < N; i++) {
            assertFalse(aBuyer[i].reentrySucceeded(), "buyer reentered");
            assertFalse(aSupplier[i].reentrySucceeded(), "supplier reentered");
        }
    }
}
