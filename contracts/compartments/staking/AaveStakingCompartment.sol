// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakeCompartment} from "../../interfaces/compartments/staking/IStakeCompartment.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {ILenderVaultFactory} from "../../interfaces/ILenderVaultFactory.sol";
import {DataTypes} from "../../DataTypes.sol";

contract CurveStakingCompartment is
    Initializable // IBorrowerCompartment {
{
    using SafeERC20 for IERC20;
    error InvalidSender();

    address public vaultAddr;
    uint256 public loanIdx;

    address public lenderFactory;

    constructor(address _lenderFactory) {
        lenderFactory = _lenderFactory;
    }

    function initialize(
        address _vaultAddr,
        address,
        address _collTokenAddr,
        uint256 _loanIdx,
        bytes memory
    ) external initializer returns (uint256 collTokenBalAfter) {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
        //needed to move this inside initializer since sending to stake
        // before returning control back to vault...
        collTokenBalAfter = IERC20(_collTokenAddr).balanceOf(address(this));
    }

    // transfer coll on repays
    function transferCollToBorrower(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr
    ) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        // check coll token balance of compartment
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer proportion of compartment coll token balance
        uint256 lpTokenAmount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, lpTokenAmount);
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        // now get coll token balance
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer all to vault
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
    }
}
