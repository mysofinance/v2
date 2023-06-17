// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILenderVaultImpl} from "../peer-to-peer/interfaces/ILenderVaultImpl.sol";

contract MaliciousCompartment {
    address internal immutable _tokenToBeWithdrawn;

    constructor(address tokenToBeWithdrawn) {
        _tokenToBeWithdrawn = tokenToBeWithdrawn;
    }

    function initialize(address /*_vaultAddr*/, uint256 /*_loanIdx*/) external {
        uint256 withdrawAmount = IERC20(_tokenToBeWithdrawn).balanceOf(
            msg.sender
        ) / 2;
        ILenderVaultImpl(msg.sender).withdraw(
            _tokenToBeWithdrawn,
            withdrawAmount
        );
    }

    // transfer coll on repays
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external {}

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {}
}
