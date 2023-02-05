// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakeCompartment} from "../../interfaces/IStakeCompartment.sol";
import {ICompartment} from "../../interfaces/ICompartment.sol";
import {ILenderVault} from "../../interfaces/ILenderVault.sol";
import {DataTypes} from "../../DataTypes.sol";

// start simple with just an example voting and rewards implementation
// could make a mapping later for more flexibility
contract CurveStakingCompartment is Initializable, ICompartment {
    using SafeERC20 for IERC20;

    error InvalidSender();

    address public vaultAddr;
    uint256 public loanIdx;

    address immutable stakeAddr;

    constructor(address _stakeAddr) {
        stakeAddr = _stakeAddr;
    }

    function initialize(
        address _vaultAddr,
        address _borrowerAddr,
        address _collTokenAddr,
        uint256 _loanIdx,
        bytes memory _data
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
        _stake(_borrowerAddr, _collTokenAddr, _data);
    }

    // transfer coll on repays
    function transferCollToBorrower(
        uint256 amount,
        address borrowerAddr,
        address collTokenAddr
    ) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, amount);
    }

    // not sure what the staking is and what else if anything needs to be passed in...
    // but this is the general layout for all the staking compartments...
    // need to think about which pool address and tokens (possibly checks to make sure it's valid staking pool for collToken?)
    function _stake(
        address borrowerAddr,
        address collTokenAddr,
        bytes memory
    ) internal {
        IStakeCompartment(collTokenAddr).stake(
            borrowerAddr,
            collTokenAddr,
            stakeAddr
        );
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
