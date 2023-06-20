// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IStakingHelper} from "../../interfaces/compartments/staking/IStakingHelper.sol";
import {ILenderVaultImpl} from "../../interfaces/ILenderVaultImpl.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {BaseCompartment} from "../BaseCompartment.sol";
import {Errors} from "../../../Errors.sol";

contract CurveLPStakingCompartment is BaseCompartment {
    using SafeERC20 for IERC20;

    address public liqGaugeAddr;

    address internal constant CRV_ADDR =
        0xD533a949740bb3306d119CC777fa900bA034cd52;
    address internal constant GAUGE_CONTROLLER =
        0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB;
    address internal constant CRV_MINTER_ADDR =
        0xd061D61a4d941c39E5453435B6345Dc261C2fcE0;

    mapping(address => bool) public approvedStaker;

    function stake(uint256 gaugeIndex) external {
        DataTypesPeerToPeer.Loan memory loan = ILenderVaultImpl(vaultAddr).loan(
            loanIdx
        );
        if (msg.sender != loan.borrower && !approvedStaker[msg.sender]) {
            revert Errors.InvalidSender();
        }
        if (liqGaugeAddr != address(0)) {
            revert Errors.AlreadyStaked();
        }

        uint256 amount = IERC20(loan.collToken).balanceOf(address(this));

        address _liqGaugeAddr = IStakingHelper(GAUGE_CONTROLLER).gauges(
            gaugeIndex
        );

        if (_liqGaugeAddr == address(0)) {
            revert Errors.InvalidGaugeIndex();
        }

        address lpTokenAddrForGauge = IStakingHelper(_liqGaugeAddr).lp_token();
        if (lpTokenAddrForGauge != loan.collToken) {
            revert Errors.IncorrectGaugeForLpToken();
        }
        liqGaugeAddr = _liqGaugeAddr;
        IERC20(loan.collToken).safeIncreaseAllowance(_liqGaugeAddr, amount);
        IStakingHelper(_liqGaugeAddr).deposit(amount);
        IERC20(loan.collToken).safeDecreaseAllowance(
            _liqGaugeAddr,
            IERC20(loan.collToken).allowance(address(this), _liqGaugeAddr)
        );
        emit Staked(gaugeIndex, liqGaugeAddr, amount);
    }

    function toggleApprovedStaker(address _staker) external {
        DataTypesPeerToPeer.Loan memory loan = ILenderVaultImpl(vaultAddr).loan(
            loanIdx
        );
        if (msg.sender != loan.borrower) {
            revert Errors.InvalidSender();
        }
        bool currStakingState = approvedStaker[_staker];
        approvedStaker[_staker] = !currStakingState;
        emit UpdatedApprovedStaker(_staker, !currStakingState);
    }

    // transfer coll on repays
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external returns (uint128 reclaimCollAmount) {
        reclaimCollAmount = _collAccountingHelper(
            repayAmount,
            repayAmountLeft,
            borrowerAddr,
            collTokenAddr,
            callbackAddr,
            false
        );
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        _collAccountingHelper(
            1,
            1,
            address(0),
            collTokenAddr,
            address(0),
            true
        );
    }

    function _withdrawCollFromGauge(
        uint256 repayAmount,
        uint256 repayAmountLeft
    ) internal returns (address[8] memory _rewardTokenAddr) {
        address _liqGaugeAddr = liqGaugeAddr;

        uint256 currentStakedBal = IERC20(_liqGaugeAddr).balanceOf(
            address(this)
        );

        // withdraw proportion of gauge amount
        uint256 withdrawAmount = (repayAmount * currentStakedBal) /
            repayAmountLeft;

        IStakingHelper(CRV_MINTER_ADDR).mint(_liqGaugeAddr);

        uint256 index;

        try IStakingHelper(_liqGaugeAddr).reward_tokens(0) returns (
            address rewardTokenAddrZeroIndex
        ) {
            // versions 2, 3, 4, or 5
            _rewardTokenAddr[0] = rewardTokenAddrZeroIndex;
            index = 1;
            address rewardTokenAddr;
            while (index < 8) {
                rewardTokenAddr = IStakingHelper(_liqGaugeAddr).reward_tokens(
                    index
                );
                if (rewardTokenAddr != address(0)) {
                    _rewardTokenAddr[index] = rewardTokenAddr;
                } else {
                    break;
                }
                unchecked {
                    index++;
                }
            }
        } catch {
            // version 1 gauge
            IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount);
        }
        if (index > 0) {
            try IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount, true) {
                // version 3, 4, or 5 gauge
            } catch {
                // version 2 gauge
                if (_rewardTokenAddr[0] != address(0)) {
                    IStakingHelper(_liqGaugeAddr).claim_rewards();
                }
                IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount);
            }
        }
    }

    function _collAccountingHelper(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        bool isUnlock
    ) internal returns (uint128 lpTokenAmount) {
        _withdrawCheck();
        if (msg.sender != vaultAddr) revert Errors.InvalidSender();

        address _liqGaugeAddr = liqGaugeAddr;

        // if gaugeAddr has been set, withdraw from gauge and get reward token addresses
        address[8] memory _rewardTokenAddr;
        if (_liqGaugeAddr != address(0)) {
            _rewardTokenAddr = _withdrawCollFromGauge(
                repayAmount,
                repayAmountLeft
            );
        }

        // now check lp token balance of compartment which will be portion unstaked (could have never been staked)
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );

        // transfer proportion of compartment lp token balance if never staked or an unlock, else all balance if staked
        lpTokenAmount = SafeCast.toUint128(
            isUnlock || _liqGaugeAddr != address(0)
                ? currentCompartmentBal
                : (repayAmount * currentCompartmentBal) / repayAmountLeft
        );

        // if unlock, send to vault, else if callback send directly there, else to borrower
        address lpTokenReceiver = isUnlock
            ? vaultAddr
            : (callbackAddr == address(0) ? borrowerAddr : callbackAddr);

        IERC20(collTokenAddr).safeTransfer(lpTokenReceiver, lpTokenAmount);

        if (_liqGaugeAddr != address(0)) {
            _payoutRewards(
                isUnlock,
                borrowerAddr,
                repayAmount,
                repayAmountLeft,
                collTokenAddr,
                _rewardTokenAddr
            );
        }
    }

    function _payoutRewards(
        bool isUnlock,
        address borrowerAddr,
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address collTokenAddr,
        address[8] memory _rewardTokenAddr
    ) internal {
        // rest of rewards are always sent to borrower, not for callback
        // if unlock then sent to vaultAddr
        address rewardReceiver = isUnlock ? vaultAddr : borrowerAddr;
        // check crv token balance
        uint256 currentCrvBal = IERC20(CRV_ADDR).balanceOf(address(this));
        // transfer proportion of crv token balance
        uint256 tokenAmount = isUnlock
            ? currentCrvBal
            : (repayAmount * currentCrvBal) / repayAmountLeft;
        IERC20(CRV_ADDR).safeTransfer(rewardReceiver, tokenAmount);

        uint256 index = 0;
        uint256 currentRewardTokenBal;
        while (index < 8 && _rewardTokenAddr[index] != address(0)) {
            // skip reward if it is also be the coll token (a curve lp token...should be very unlikely)
            if (_rewardTokenAddr[index] != collTokenAddr) {
                currentRewardTokenBal = IERC20(_rewardTokenAddr[index])
                    .balanceOf(address(this));

                if (currentRewardTokenBal > 0) {
                    tokenAmount = isUnlock
                        ? currentRewardTokenBal
                        : (repayAmount * currentRewardTokenBal) /
                            repayAmountLeft;

                    IERC20(_rewardTokenAddr[index]).safeTransfer(
                        rewardReceiver,
                        tokenAmount
                    );
                }
            }
            unchecked {
                index++;
            }
        }
    }
}
