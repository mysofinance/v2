// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract BaseCompartment is Initializable {
    address public vaultAddr;
    uint256 public loanIdx;

    constructor() {
        _disableInitializers();
    }
}
