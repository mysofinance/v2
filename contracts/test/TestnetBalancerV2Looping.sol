// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {BalancerV2Looping} from "../peer-to-peer/callbacks/BalancerV2Looping.sol";

contract TestnetBalancerV2Looping is BalancerV2Looping {
    address private constant BALANCER_V2_VAULT =
        0x5758059F5b5f636D4E68dD729b43729B4cF34870;

    constructor(address _borrowerGateway) BalancerV2Looping(_borrowerGateway) {} // solhint-disable no-empty-blocks
}
