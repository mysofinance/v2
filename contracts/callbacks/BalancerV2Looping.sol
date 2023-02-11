// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultCallback} from "../interfaces/IVaultCallback.sol";
import {DataTypes} from "../DataTypes.sol";

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

contract BalancerV2Looping is IVaultCallback {
    using SafeERC20 for IERC20Metadata;

    address immutable BalancerV2 = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    event Received(address, uint);

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
        BalancerDataTypes.SingleSwap memory singleSwap = BalancerDataTypes
            .SingleSwap(
                poolId,
                BalancerDataTypes.SwapKind.GIVEN_IN,
                IBalancerAsset(loan.loanToken),
                IBalancerAsset(loan.collToken),
                loan.initLoanAmount,
                "0x"
            );
        IERC20Metadata(loan.loanToken).approve(
            address(BalancerV2),
            loan.initLoanAmount
        );
        IBalancerVault(BalancerV2).swap(
            singleSwap,
            fundManagement,
            minSwapReceive,
            deadline
        );
    }

    function repayCallback(
        DataTypes.Loan calldata loanQuote,
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        bytes calldata data
    ) external {}
}

/*BalancerDataTypes.FundManagement
            memory fundManagement = BalancerDataTypes.FundManagement(
                address(this), // swap payer
                false, // use payer's internal balance
                payable(loanQuote.borrower), // swap receiver
                false // user receiver's internal balance
            );
        (bytes32 poolId, uint256 minSwapReceive, uint256 deadline) = abi.decode(
            data,
            (bytes32, uint256, uint256)
        );
        BalancerDataTypes.SingleSwap memory singleSwap = BalancerDataTypes
            .SingleSwap(
                poolId,
                BalancerDataTypes.SwapKind.GIVEN_OUT,
                IBalancerAsset(loanQuote.collToken),
                IBalancerAsset(loanQuote.loanToken),
                repayAmount,
                "0x"
            );
        // todo: could calculate this better using bal math inGivenOut
        IERC20Metadata(loanQuote.collToken).approve(
            address(BalancerV2),
            reclaimableColl
        );
        IBalancerVault(BalancerV2).swap(
            singleSwap,
            fundManagement,
            minSwapReceive,
            deadline
        );
    }*/
