// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {CargoCommitFactory} from "../src/CargoCommitFactory.sol";

/// @notice Deploys only the stateless CargoCommit factory.
/// @dev The signer is selected by the Arc Foundry CLI; no key is embedded here.
contract DeployCargoCommitFactory is Script {
    function run() external returns (CargoCommitFactory factory) {
        vm.startBroadcast();
        factory = new CargoCommitFactory();
        vm.stopBroadcast();
    }
}
