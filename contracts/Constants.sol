// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

library Constants {
    uint256 internal constant YEAR_IN_SECONDS = 31_536_000; // 365*24*3600
    uint256 internal constant BASE = 1e18;
    uint256 internal constant MAX_FEE_PER_ANNUM = 5e16; // 5% max in base
    uint256 internal constant MAX_ARRANGER_SPLIT = 5e17; // 50% max in base
}
