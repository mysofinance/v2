// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IVoteCompartment} from "../../interfaces/compartments/voting/IVoteCompartment.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "../../interfaces/ILenderVault.sol";
import {DataTypes} from "../../DataTypes.sol";

contract VoteCompartment is Initializable, IBorrowerCompartment {
    using SafeERC20 for IERC20;

    address public vaultAddr;
    uint256 public loanIdx;

    function initialize(
        address _vaultAddr,
        address,
        address,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
    }

    function stake(
        address registryAddr,
        address collTokenAddr,
        bytes memory data
    ) external {
        if (msg.sender != IAddressRegistry(registryAddr).borrowerGateway()) {
            revert InvalidSender();
        }
        address _delegatee = abi.decode(data, (address));
        if (_delegatee != address(0)) {
            _delegate(_delegatee, collTokenAddr);
        }
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
