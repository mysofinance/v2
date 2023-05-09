// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "../../interfaces/ILenderVaultImpl.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {BaseCompartment} from "../BaseCompartment.sol";
import {Errors} from "../../../Errors.sol";

contract VoteCompartment is BaseCompartment {
    using SafeERC20 for IERC20;

    function delegate(address _delegatee) external {
        DataTypesPeerToPeer.Loan memory loan = ILenderVaultImpl(vaultAddr).loan(
            loanIdx
        );
        if (msg.sender != loan.borrower) {
            revert Errors.InvalidSender();
        }
        if (_delegatee == address(0)) {
            revert Errors.InvalidDelegatee();
        }
        uint256 preDelegateCompartmentBal = IERC20(loan.collToken).balanceOf(
            address(this)
        );
        IVotes(loan.collToken).delegate(_delegatee);
        uint256 postDelegateCompartmentBal = IERC20(loan.collToken).balanceOf(
            address(this)
        );
        if (preDelegateCompartmentBal > postDelegateCompartmentBal) {
            revert Errors.DelegateReducedBalance();
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
        _transferCollFromCompartment(
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
