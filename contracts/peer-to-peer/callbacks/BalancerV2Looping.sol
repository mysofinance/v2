// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultCallback} from "../interfaces/IVaultCallback.sol";
import {IEvents} from "../interfaces/IEvents.sol";
import {DataTypes} from "../DataTypes.sol";

interface IBalancerAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IBalancerVault {
    function swap(
        BalancerDataTypes.SingleSwap memory singleSwap,
        BalancerDataTypes.FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256);
}

library BalancerDataTypes {
    enum SwapKind {
        GIVEN_IN,
        GIVEN_OUT
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        IBalancerAsset assetIn;
        IBalancerAsset assetOut;
        uint256 amount;
        bytes userData;
    }
}

contract BalancerV2Looping is IVaultCallback, IEvents {
    using SafeERC20 for IERC20Metadata;

    address constant BALANCER_V2_VAULT =
        0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    function borrowCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external {
        BalancerDataTypes.FundManagement
            memory fundManagement = BalancerDataTypes.FundManagement(
                address(this), // swap payer
                false, // use payer's internal balance
                payable(loan.borrower), // swap receiver
                false // user receiver's internal balance
            );
        (bytes32 poolId, uint256 minSwapReceive, uint256 deadline) = abi.decode(
            data,
            (bytes32, uint256, uint256)
        );
        // underflow if loan token transfer fees from vault to callbackAddr...?
        // maybe need a loanTokenBalBefore var passed in?
        BalancerDataTypes.SingleSwap memory singleSwap = BalancerDataTypes
            .SingleSwap(
                poolId,
                BalancerDataTypes.SwapKind.GIVEN_IN,
                IBalancerAsset(loan.loanToken),
                IBalancerAsset(loan.collToken),
                loan.initLoanAmount,
                "0x"
            );
        IERC20Metadata(loan.loanToken).approve(BALANCER_V2_VAULT, 0);
        IERC20Metadata(loan.loanToken).approve(
            BALANCER_V2_VAULT,
            loan.initLoanAmount
        );
        IBalancerVault(BALANCER_V2_VAULT).swap(
            singleSwap,
            fundManagement,
            minSwapReceive,
            deadline
        );
        IERC20Metadata(loan.loanToken).approve(BALANCER_V2_VAULT, 0);
    }

    function repayCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external {
        BalancerDataTypes.FundManagement
            memory fundManagement = BalancerDataTypes.FundManagement(
                address(this), // swap payer
                false, // use payer's internal balance
                payable(loan.borrower), // swap receiver
                false // user receiver's internal balance
            );
        (bytes32 poolId, uint256 minSwapReceive, uint256 deadline) = abi.decode(
            data,
            (bytes32, uint256, uint256)
        );
        // swap whole coll token balance received from borrower gateway
        uint256 collBalance = IERC20(loan.collToken).balanceOf(address(this));
        BalancerDataTypes.SingleSwap memory singleSwap = BalancerDataTypes
            .SingleSwap(
                poolId,
                BalancerDataTypes.SwapKind.GIVEN_IN,
                IBalancerAsset(loan.collToken),
                IBalancerAsset(loan.loanToken),
                collBalance,
                "0x"
            );
        IERC20Metadata(loan.collToken).approve(BALANCER_V2_VAULT, 0);
        IERC20Metadata(loan.collToken).approve(BALANCER_V2_VAULT, collBalance);
        IBalancerVault(BALANCER_V2_VAULT).swap(
            singleSwap,
            fundManagement,
            minSwapReceive,
            deadline
        );
        IERC20Metadata(loan.collToken).safeApprove(BALANCER_V2_VAULT, 0);
    }
}
