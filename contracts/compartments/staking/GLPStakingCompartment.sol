// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {IStakingHelper} from "../../interfaces/compartments/staking/IStakingHelper.sol";

contract GLPStakingCompartment is Initializable, IBorrowerCompartment {
    using SafeERC20 for IERC20;

    address public vaultAddr;
    uint256 public loanIdx;

    // arbitrum WETH address
    address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant GMX_REWARD_ROUTER =
        0xB95DB5B167D75e6d04227CfFFA61069348d271F5;

    function initialize(
        address _vaultAddr,
        address,
        address,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
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
        // check coll token balance of compartment
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer proportion of compartment coll token balance
        uint256 lpTokenAmount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        if (callbackAddr == address(0)) {
            IERC20(collTokenAddr).safeTransfer(borrowerAddr, lpTokenAmount);
        } else {
            IERC20(collTokenAddr).safeTransfer(callbackAddr, lpTokenAmount);
        }

        IStakingHelper(GMX_REWARD_ROUTER).claimFees();

        // check weth token balance
        uint256 currentWethBal = IERC20(WETH).balanceOf(address(this));
        // transfer proportion of weth token balance
        uint256 wethTokenAmount = (repayAmount * currentWethBal) /
            repayAmountLeft;
        IERC20(WETH).safeTransfer(borrowerAddr, wethTokenAmount);
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        // get coll token balance
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer all to vault
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
        // get weth token balance
        uint256 currentWethBal = IERC20(WETH).balanceOf(address(this));
        // transfer all weth to vault
        IERC20(WETH).safeTransfer(vaultAddr, currentWethBal);
    }
}
