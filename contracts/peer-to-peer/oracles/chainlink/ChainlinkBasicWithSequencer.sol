// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {ChainlinkBasic} from "./ChainlinkBasic.sol";
import {Constants} from "../../../Constants.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasicWithSequencer is ChainlinkBasic {
    // solhint-disable no-empty-blocks
    address internal constant SEQUENCER_FEED =
        0xFdB631F5EE196F0ed6FAa767959853A9F217697D; // arbitrum sequencer feed

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        uint256 baseCurrencyUnit
    )
        ChainlinkBasic(
            _tokenAddrs,
            _oracleAddrs,
            0x000000000000000000000000000000000000dEaD, // no base currency needed for USD on arbitrum
            baseCurrencyUnit
        )
    {}

    function _checkAndReturnLatestRoundData(
        address oracleAddr
    ) internal view override returns (uint256 tokenPriceRaw) {
        (, int256 answer, uint256 startedAt, , ) = AggregatorV3Interface(
            SEQUENCER_FEED
        ).latestRoundData();
        // check if sequencer is live
        if (answer != 0) {
            revert Errors.SequencerDown();
        }
        // check if last restart was less than or equal grace period length
        if (startedAt + Constants.SEQUENCER_GRACE_PERIOD > block.timestamp) {
            revert Errors.GracePeriodNotOver();
        }
        tokenPriceRaw = super._checkAndReturnLatestRoundData(oracleAddr);
    }
}
