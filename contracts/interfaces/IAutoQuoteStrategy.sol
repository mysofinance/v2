// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IAutoQuoteStrategy {
    function getQuote()
        external
        view
        returns (DataTypes.OnChainQuote memory onChainQuote);
}
