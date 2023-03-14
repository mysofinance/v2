// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseCompartment} from "../interfaces/compartments/IBaseCompartment.sol";
import {Errors} from "../../Errors.sol";

abstract contract BaseCompartment is Initializable, IBaseCompartment {
    using SafeERC20 for IERC20;

    address public vaultAddr;
    uint256 public loanIdx;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vaultAddr,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
    }

    // transfer coll on repays
    function transferCollFromCompartmentHelper(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) internal {
        if (msg.sender != vaultAddr) revert Errors.InvalidSender();
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        uint256 amount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        if (callbackAddr == address(0)) {
            IERC20(collTokenAddr).safeTransfer(borrowerAddr, amount);
        } else {
            IERC20(collTokenAddr).safeTransfer(callbackAddr, amount);
        }
    }

    function unlockCollToVaultHelper(address collTokenAddr) internal {
        if (msg.sender != vaultAddr) revert Errors.InvalidSender();
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
    }
}
