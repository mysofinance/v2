// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultCallback} from "../interfaces/IVaultCallback.sol";
import {DataTypes} from "../DataTypes.sol";

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);

    function exactInput(
        ExactInputParams calldata params
    ) external payable returns (uint256 amountOut);

    function exactOutputSingle(
        ExactOutputSingleParams calldata params
    ) external payable returns (uint256 amountIn);

    function exactOutput(
        ExactOutputParams calldata params
    ) external payable returns (uint256 amountIn);
}

contract UniV3Looping is IVaultCallback {
    using SafeERC20 for IERC20Metadata;

    address constant UNI_V3_SWAP_ROUTER =
        0xE592427A0AEce92De3Edee1F18E0157C05861564;

    function borrowCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external {
        (uint256 minSwapReceive, uint256 deadline, uint24 poolFee) = abi.decode(
            data,
            (uint256, uint256, uint24)
        );
        IERC20Metadata(loan.loanToken).approve(UNI_V3_SWAP_ROUTER, 0);
        IERC20Metadata(loan.loanToken).approve(
            UNI_V3_SWAP_ROUTER,
            loan.initLoanAmount
        );
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: loan.loanToken,
                tokenOut: loan.collToken,
                fee: poolFee,
                recipient: loan.borrower,
                deadline: deadline,
                amountIn: loan.initLoanAmount,
                amountOutMinimum: minSwapReceive,
                sqrtPriceLimitX96: 0
            });
        ISwapRouter(UNI_V3_SWAP_ROUTER).exactInputSingle(params);
        IERC20Metadata(loan.loanToken).approve(UNI_V3_SWAP_ROUTER, 0);
    }

    function repayCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external {
        (uint256 minSwapReceive, uint256 deadline, uint24 poolFee) = abi.decode(
            data,
            (uint256, uint256, uint24)
        );
        // swap whole coll token balance received from borrower gateway
        uint256 collBalance = IERC20(loan.collToken).balanceOf(address(this));
        IERC20Metadata(loan.collToken).approve(UNI_V3_SWAP_ROUTER, 0);
        IERC20Metadata(loan.collToken).approve(UNI_V3_SWAP_ROUTER, collBalance);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: loan.collToken,
                tokenOut: loan.loanToken,
                fee: poolFee,
                recipient: loan.borrower,
                deadline: deadline,
                amountIn: collBalance,
                amountOutMinimum: minSwapReceive,
                sqrtPriceLimitX96: 0
            });

        ISwapRouter(UNI_V3_SWAP_ROUTER).exactInputSingle(params);
        IERC20Metadata(loan.collToken).approve(UNI_V3_SWAP_ROUTER, 0);
    }
}
