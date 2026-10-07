// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CargoCommitOrder} from "./CargoCommitOrder.sol";

/// @title CargoCommitFactory
/// @notice Stateless creation layer for immutable CargoCommit purchase orders.
contract CargoCommitFactory {
    event OrderCreated(
        address indexed order,
        address indexed buyer,
        address indexed supplier,
        address arbiter,
        uint256 orderAmount,
        uint16 depositBps,
        uint16 fallbackSupplierBps,
        uint256 fundingDeadline,
        uint256 shipmentDeadline,
        uint256 buyerDecisionDeadline,
        uint256 disputeDeadline,
        bytes32 termsHash
    );

    function createOrder(
        address buyer,
        address supplier,
        address arbiter,
        uint256 orderAmount,
        uint16 depositBps,
        uint16 fallbackSupplierBps,
        uint256 fundingDeadline,
        uint256 shipmentDeadline,
        uint256 buyerDecisionDeadline,
        uint256 disputeDeadline
    ) external returns (address order) {
        CargoCommitOrder created = new CargoCommitOrder(
            buyer,
            supplier,
            arbiter,
            orderAmount,
            depositBps,
            fallbackSupplierBps,
            fundingDeadline,
            shipmentDeadline,
            buyerDecisionDeadline,
            disputeDeadline
        );
        order = address(created);
        emit OrderCreated(
            order,
            buyer,
            supplier,
            arbiter,
            orderAmount,
            depositBps,
            fallbackSupplierBps,
            fundingDeadline,
            shipmentDeadline,
            buyerDecisionDeadline,
            disputeDeadline,
            created.termsHash()
        );
    }
}
