// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "../../interfaces/ILenderVault.sol";
import {DataTypes} from "../../DataTypes.sol";
import {BaseCompartment} from "../BaseCompartment.sol";

contract VoteCompartment is
    Initializable,
    BaseCompartment,
    IBorrowerCompartment
{
    using SafeERC20 for IERC20;

    function initialize(
        address _vaultAddr,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
    }

    function delegate(address _delegatee) external {
        DataTypes.Loan memory loan = ILenderVault(vaultAddr).loans(loanIdx);
        if (msg.sender != loan.borrower) {
            revert InvalidSender();
        }
        if (_delegatee != address(0)) {
            IVotes(loan.collToken).delegate(_delegatee);
        }
    }

    // transfer coll on repays
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
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

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
    }
}
