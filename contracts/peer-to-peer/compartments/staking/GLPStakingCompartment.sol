// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakingHelper} from "../../interfaces/compartments/staking/IStakingHelper.sol";
import {BaseCompartment} from "../BaseCompartment.sol";
import {Errors} from "../../../Errors.sol";

contract GLPStakingCompartment is BaseCompartment {
    // solhint-disable no-empty-blocks

    using SafeERC20 for IERC20;

    // arbitrum WETH address
    address private constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address private constant FEE_GLP =
        0x4e971a87900b931fF39d1Aad67697F49835400b6;

    // transfer coll on repays
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        uint128 reclaimCollAmount,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external {
        _transferCollFromCompartment(
            reclaimCollAmount,
            borrowerAddr,
            collTokenAddr,
            callbackAddr
        );

        //solhint-ignore-empty-blocks
        try IStakingHelper(FEE_GLP).claim(address(this)) {
            // do nothing
        } catch {
            // do nothing
        }

        // check weth token balance
        uint256 currentWethBal = IERC20(WETH).balanceOf(address(this));

        // transfer proportion of weth token balance
        uint256 wethTokenAmount = (repayAmount * currentWethBal) /
            repayAmountLeft;
        IERC20(WETH).safeTransfer(borrowerAddr, wethTokenAmount);
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        _unlockCollToVault(collTokenAddr);

        //solhint-ignore-empty-blocks
        try IStakingHelper(FEE_GLP).claim(address(this)) {
            // do nothing
        } catch {
            // do nothing
        }

        // get weth token balance
        uint256 currentWethBal = IERC20(WETH).balanceOf(address(this));
        // transfer all weth to vault
        IERC20(WETH).safeTransfer(vaultAddr, currentWethBal);
    }

    function getReclaimableBalance(
        address collToken
    ) external view override returns (uint256) {
        return IERC20(collToken).balanceOf(address(this));
    }
}
