// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {UniV3Looping} from "../peer-to-peer/callbacks/UniV3Looping.sol";

contract TestnetUniV3Looping is UniV3Looping {
    address private constant UNI_V3_SWAP_ROUTER =
        0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E;

    constructor(address _borrowerGateway) UniV3Looping(_borrowerGateway) {} // solhint-disable no-empty-blocks
}
