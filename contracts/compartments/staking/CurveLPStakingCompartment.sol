// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IStakingHelper} from "../../interfaces/compartments/staking/IStakingHelper.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "../../interfaces/ILenderVault.sol";
import {DataTypes} from "../../DataTypes.sol";
import {BaseCompartment} from "../BaseCompartment.sol";

contract CurveLPStakingCompartment is BaseCompartment, IBorrowerCompartment {
    using SafeERC20 for IERC20;

    error IncorrectGaugeForLpToken();
    error InvalidGaugeIndex();
    error AlreadyStaked();

    address public liqGaugeAddr;

    // todo: possibly have this be set at initialize instead of
    //separate BAL and AURA instances?
    address internal constant CRV_ADDR =
        0xD533a949740bb3306d119CC777fa900bA034cd52;
    address internal constant GAUGE_CONTROLLER =
        0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB;
    address internal constant CRV_MINTER_ADDR =
        0xd061D61a4d941c39E5453435B6345Dc261C2fcE0;

    function initialize(
        address _vaultAddr,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
    }

    function stake(uint256 gaugeIndex) external {
        DataTypes.Loan memory loan = ILenderVault(vaultAddr).loans(loanIdx);
        if (msg.sender != loan.borrower) {
            revert InvalidSender();
        }
        if (liqGaugeAddr != address(0)) {
            revert AlreadyStaked();
        }

        uint256 amount = IERC20(loan.collToken).balanceOf(address(this));

        address _liqGaugeAddr = IStakingHelper(GAUGE_CONTROLLER).gauges(
            gaugeIndex
        );

        if (_liqGaugeAddr == address(0)) {
            revert InvalidGaugeIndex();
        }

        address lpTokenAddrForGauge = IStakingHelper(_liqGaugeAddr).lp_token();
        if (lpTokenAddrForGauge != loan.collToken) {
            revert IncorrectGaugeForLpToken();
        }
        liqGaugeAddr = _liqGaugeAddr;
        IERC20(loan.collToken).approve(_liqGaugeAddr, amount);
        IStakingHelper(_liqGaugeAddr).deposit(amount, address(this));
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
        address _liqGaugeAddr = liqGaugeAddr;
        address _rewardTokenAddr = address(0);
        bool isStaked = _liqGaugeAddr != address(0);
        // check staked balance in gauge if gaugeAddr has been set
        // if not staked, then liqGaugeAddr = 0 and skip don't withdraw
        if (isStaked) {
            _rewardTokenAddr = withdrawCollFromGauge(
                repayAmount,
                repayAmountLeft
            );
        }

        // now check lp token balance of compartment which will be portion unstaked (could have never been staked)
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer proportion of compartment lp token balance if never staked, else all balance if staked
        uint256 lpTokenAmount = isStaked
            ? currentCompartmentBal
            : (repayAmount * currentCompartmentBal) / repayAmountLeft;
        // if callback send directly there, else to borrower
        if (callbackAddr == address(0)) {
            IERC20(collTokenAddr).safeTransfer(borrowerAddr, lpTokenAmount);
        } else {
            IERC20(collTokenAddr).safeTransfer(callbackAddr, lpTokenAmount);
        }
        //rest of rewards are always sent to borrower, not for callback
        // check crv token balance
        uint256 currentCrvBal = IERC20(CRV_ADDR).balanceOf(address(this));
        // transfer proportion of crv token balance
        uint256 crvTokenAmount = (repayAmount * currentCrvBal) /
            repayAmountLeft;
        IERC20(CRV_ADDR).safeTransfer(borrowerAddr, crvTokenAmount);

        if (_rewardTokenAddr != address(0)) {
            uint256 currentRewardTokenBal = IERC20(_rewardTokenAddr).balanceOf(
                address(this)
            );

            uint256 rewardTokenAmount = (repayAmount * currentRewardTokenBal) /
                repayAmountLeft;

            IERC20(_rewardTokenAddr).safeTransfer(
                borrowerAddr,
                rewardTokenAmount
            );
        }
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();

        address _liqGaugeAddr = liqGaugeAddr;
        address _rewardTokenAddr = address(0);
        bool isStaked = _liqGaugeAddr != address(0);
        // check staked balance in gauge if gaugeAddr has been set
        // if not staked, then liqGaugeAddr = 0 and skip don't withdraw
        if (isStaked) {
            _rewardTokenAddr = withdrawCollFromGauge(uint256(1), uint256(1));
        }

        // now check lp token balance of compartment which will be portion unstaked (could have never been staked)
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );

        // transfer  the compartment lp token balance
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCompartmentBal);

        //rest of rewards are always sent to borrower, not for callback
        // check crv token balance
        uint256 currentCrvBal = IERC20(CRV_ADDR).balanceOf(address(this));

        // transfer crv token balance
        IERC20(CRV_ADDR).safeTransfer(vaultAddr, currentCrvBal);

        if (_rewardTokenAddr != address(0)) {
            uint256 currentRewardTokenBal = IERC20(_rewardTokenAddr).balanceOf(
                address(this)
            );

            IERC20(_rewardTokenAddr).safeTransfer(
                vaultAddr,
                currentRewardTokenBal
            );
        }
    }

    function withdrawCollFromGauge(
        uint256 repayAmount,
        uint256 repayAmountLeft
    ) internal returns (address _rewardTokenAddr) {
        address _liqGaugeAddr = liqGaugeAddr;

        uint256 currentStakedBal = IERC20(_liqGaugeAddr).balanceOf(
            address(this)
        );

        // withdraw proportion of gauge amount
        uint256 withdrawAmount = (repayAmount * currentStakedBal) /
            repayAmountLeft;

        IStakingHelper(CRV_MINTER_ADDR).mint(_liqGaugeAddr);

        try IStakingHelper(_liqGaugeAddr).reward_tokens(0) returns (
            address rewardTokenAddr
        ) {
            if (rewardTokenAddr != address(0)) {
                _rewardTokenAddr = rewardTokenAddr;
                IStakingHelper(_liqGaugeAddr).claim_rewards();
            }

            IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount);
        } catch {
            IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount);
        }
    }
}
