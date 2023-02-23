// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IAutoQuoteStrategy {
    function getQuote() external view returns (DataTypes.Quote memory quote);
}
