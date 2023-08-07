// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library DataTypesBasicPolicies {
    struct QuoteBounds {
        uint40 minTenor;
        uint40 maxTenor;
        uint80 minFee;
        uint80 minAPR;
        uint128 minLoanPerCollUnitOrLtv;
        uint128 maxLoanPerCollUnitOrLtv;
    }

    struct GlobalPolicy {
        bool allowAllPairs;
        QuoteBounds quoteBounds;
    }

    struct SinglePolicy {
        bool requiresOracle;
        uint8 minNumOfSignersOverwrite;
        QuoteBounds quoteBounds;
    }
}
