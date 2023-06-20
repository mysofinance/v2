// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseCompartment} from "../BaseCompartment.sol";
import {Errors} from "../../../Errors.sol";

contract AaveStakingCompartment is BaseCompartment {
    using SafeERC20 for IERC20;

    // transfer coll on repays
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external returns (uint128 reclaimCollAmount) {
        reclaimCollAmount = _transferCollFromCompartment(
            repayAmount,
            repayAmountLeft,
            borrowerAddr,
            collTokenAddr,
            callbackAddr
        );
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        _unlockCollToVault(collTokenAddr);
    }
}
