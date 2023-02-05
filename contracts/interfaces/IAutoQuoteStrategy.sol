// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IAutoQuoteStrategy {
    function getOnChainQuote()
        external
        view
        returns (DataTypes.OnChainQuote memory onChainQuote);
}
