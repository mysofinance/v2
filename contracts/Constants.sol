// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

library Constants {
    uint256 internal constant YEAR_IN_SECONDS = 31_536_000; // 365*24*3600
    uint256 internal constant BASE = 1e18;
    uint256 internal constant MAX_FEE_PER_ANNUM = 5e16; // 5% max in base
    uint256 internal constant MAX_ARRANGER_SPLIT = 5e17; // 50% max in base
    uint256 internal constant MIN_LENDER_UNSUBSCRIBE_GRACE_PERIOD = 1800; // min 30 minutes
    uint256 internal constant MIN_CONVERSION_GRACE_PERIOD = 1800; // min 30 minutes
    uint256 internal constant MIN_REPAYMENT_GRACE_PERIOD = 1800; // min 30 minutes
    uint256 internal constant MIN_TIME_UNTIL_FIRST_DUE_DATE = 1440; // min 1 day
    uint256 internal constant MIN_TIME_BETWEEN_DUE_DATES = 1440; // min 1 day
    uint256 internal constant MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE = 60; // 60 seconds
}
