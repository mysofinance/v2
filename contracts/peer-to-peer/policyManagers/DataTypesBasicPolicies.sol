// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library DataTypesBasicPolicies {
    struct QuoteBounds {
        // Allowed minimum tenor for the quote (in seconds)
        uint32 minTenor;
        // Allowed maximum tenor for the quote (in seconds)
        uint32 maxTenor;
        // Allowed minimum fee for the quote (in BASE)
        uint80 minFee;
        // Allowed minimum APR for the quote (in BASE)
        int80 minApr;
        // Allowed minimum earliest repay tenor
        uint32 minEarliestRepayTenor;
        // Allowed minimum loan per collateral unit or LTV for the quote
        uint128 minLoanPerCollUnitOrLtv;
        // Allowed maximum loan per collateral unit or LTV for the quote
        uint128 maxLoanPerCollUnitOrLtv;
    }

    struct GlobalPolicy {
        // Flag indicating if all pairs are allowed (=true) or
        // only pairs with explicitly defined pair policy (=false), default case
        bool allowAllPairs;
        // Applicable global bounds
        QuoteBounds quoteBounds;
    }

    struct PairPolicy {
        // Flag indicating if an oracle is required for the pair
        bool requiresOracle;
        // Minimum number of signers required for the pair (if zero ignored, otherwise overwrites vault min signers)
        // @dev: can overwrite signer threshold to be lower or higher than vault min signers
        uint8 minNumOfSignersOverwrite;
        // Applicable global bounds
        QuoteBounds quoteBounds;
    }
}
