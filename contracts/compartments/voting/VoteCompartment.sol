// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVoteCompartment} from "../../interfaces/compartments/voting/IVoteCompartment.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "../../interfaces/ILenderVault.sol";
import {DataTypes} from "../../DataTypes.sol";

// start simple with just an example voting and rewards implementation
// could make a mapping later for more flexibility
contract VoteCompartment is
    Initializable //, IBorrowerCompartment {
{
    using SafeERC20 for IERC20;
    error InvalidSender();

    address public vaultAddr;
    uint256 public loanIdx;

    function initialize(
        address _vaultAddr,
        address _borrowerAddr,
        address _collTokenAddr,
        uint256 _loanIdx,
        bytes memory
    ) external initializer returns (uint256 collTokenBalAfter) {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
        collTokenBalAfter = IERC20(_collTokenAddr).balanceOf(address(this));
        _delegate(_borrowerAddr, _collTokenAddr);
    }

    function redirectDelegates(address newDelegatee) external {
        DataTypes.Loan memory loan = ILenderVault(vaultAddr).loans(loanIdx);
        address borrowerAddr = loan.borrower;
        if (msg.sender != borrowerAddr) revert InvalidSender();
        _delegate(newDelegatee, loan.collToken);
    }

    function _delegate(address delegatee, address collTokenAddr) internal {
        IVoteCompartment(collTokenAddr).delegate(delegatee);
    }

    // transfer coll on repays
    function transferCollToBorrower(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr
    ) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        uint256 amount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, amount);
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
