// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {Errors} from "./Errors.sol";

library Helpers {
    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert Errors.OverflowUint128();
        }
    }
}
