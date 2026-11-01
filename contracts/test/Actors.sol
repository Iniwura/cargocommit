// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraOrder} from "../SeldraOrder.sol";

/// @notice Configurable hostile / benign counterparty. Used as buyer, supplier or arbiter.
/// Whenever it receives native value (empty-calldata call) it behaves according to `mode`.
contract Actor {
    enum Mode {
        ACCEPT, // plain receiver
        REVERT, // always reverts
        BURN, // consumes all forwarded gas
        BOMB, // returns 30 kB of return data (cheap enough to succeed in 100k gas)
        HUGE_BOMB, // returns 1 MB (needs more than the 100k payout gas -> fails there)
        REENTER, // tries every state changing function of the order, then accepts
        REENTER_REVERT // tries every state changing function, then reverts
    }

    uint256 public constant REENTRY_FNS = 10; // nonReentrant functions attempted per hook run

    Mode public mode;
    address public target;
    uint256 public reentryBlocked; // attempts that failed with Reentrancy()
    bool public reentrySucceeded; // must stay false forever

    function setMode(Mode m) external {
        mode = m;
    }

    function setTarget(address t) external {
        target = t;
    }

    receive() external payable {
        Mode m = mode;
        if (m == Mode.ACCEPT) return;
        if (m == Mode.REVERT) revert("actor-reject");
        if (m == Mode.BURN) {
            assembly {
                invalid()
            }
        }
        if (m == Mode.BOMB) {
            assembly {
                return(0, 30000)
            }
        }
        if (m == Mode.HUGE_BOMB) {
            assembly {
                return(0, 1000000)
            }
        }
        _reenter();
        if (m == Mode.REENTER_REVERT) revert("after-reenter");
    }

    function _reenter() internal {
        address t = target;
        SeldraOrder o = SeldraOrder(payable(t));
        bytes[10] memory cs;
        cs[0] = abi.encodeCall(o.cancelBeforeFunding, ());
        cs[1] = abi.encodeCall(o.fund, ());
        cs[2] = abi.encodeCall(o.submitEvidence, (bytes32(uint256(1))));
        cs[3] = abi.encodeCall(o.claimShipmentRefund, ());
        cs[4] = abi.encodeCall(o.approveRelease, ());
        cs[5] = abi.encodeCall(o.claimDecisionTimeout, ());
        cs[6] = abi.encodeCall(o.openDispute, (bytes32(uint256(1))));
        cs[7] = abi.encodeCall(o.resolveDispute, (uint256(0)));
        cs[8] = abi.encodeCall(o.claimDisputeFallback, ());
        cs[9] = abi.encodeCall(o.withdraw, ());
        uint256 blocked;
        for (uint256 i = 0; i < 10; i++) {
            (bool ok, bytes memory r) = t.call(cs[i]);
            if (ok) {
                reentrySucceeded = true;
            } else if (r.length >= 4 && bytes4(r) == SeldraOrder.Reentrancy.selector) {
                blocked++;
            }
        }
        reentryBlocked += blocked;
    }
}

/// @notice Real selfdestruct-based force-feeder (created and destroyed in one tx, so it works post-Cancun).
contract Forcer {
    constructor(address payable t) payable {
        selfdestruct(t);
    }
}
