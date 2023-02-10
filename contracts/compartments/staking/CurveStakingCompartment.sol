// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IStakeCompartment} from "../../interfaces/compartments/staking/IStakeCompartment.sol";
import {IStakingHelper} from "../../interfaces/compartments/staking/IStakingHelper.sol";
import {IBorrowerCompartment} from "../../interfaces/IBorrowerCompartment.sol";
import "hardhat/console.sol";

contract CurveStakingCompartment is
    Initializable,
    IStakeCompartment,
    IBorrowerCompartment
{
    using SafeERC20 for IERC20;

    error IncorrectGaugeForLpToken();

    address public vaultAddr;
    uint256 public loanIdx;
    address public liqGaugeAddr;

    // todo: possibly have this be set at initialize instead of
    //separate BAL and AURA instances?
    address internal constant CRV_ADDR =
        0xD533a949740bb3306d119CC777fa900bA034cd52;

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
    function transferCollToBorrower(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr
    ) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        address _liqGaugeAddr = liqGaugeAddr;
        // check staked balance in gauge
        uint256 currentStakedBal = IERC20(_liqGaugeAddr).balanceOf(
            address(this)
        );
        // withdraw proportion of gauge amount
        uint256 withdrawAmount = (repayAmount * currentStakedBal) /
            repayAmountLeft;
        IStakingHelper(_liqGaugeAddr).withdraw(withdrawAmount);
        // now check lp token balance of compartment
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer proportion of compartment lp token balance
        uint256 lpTokenAmount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, lpTokenAmount);
        // check crv token balance
        uint256 currentCrvBal = IERC20(CRV_ADDR).balanceOf(address(this));
        // transfer proportion of crv token balance
        uint256 crvTokenAmount = (repayAmount * currentCrvBal) /
            repayAmountLeft;
        IERC20(CRV_ADDR).safeTransfer(borrowerAddr, crvTokenAmount);
    }

    function stake(
        address registryAddr,
        address collTokenAddr,
        bytes memory data
    ) external {
        uint256 amount = IERC20(collTokenAddr).balanceOf(address(this));

        console.log(amount);
        address _liqGaugeAddr = abi.decode(data, (address));
        console.log(_liqGaugeAddr);
        if (
            !IAddressRegistry(registryAddr).isWhitelistedCollTokenHandler(
                _liqGaugeAddr
            )
        ) revert InvalidPool();
        address lpTokenAddrForGauge = IStakingHelper(_liqGaugeAddr).lp_token();
        if (lpTokenAddrForGauge != collTokenAddr) {
            revert IncorrectGaugeForLpToken();
        }
        liqGaugeAddr = _liqGaugeAddr;
        IERC20(collTokenAddr).approve(_liqGaugeAddr, type(uint256).max);
        IStakingHelper(_liqGaugeAddr).deposit(amount, address(this));
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        address _liqGaugeAddr = liqGaugeAddr;
        // check staked balance in gauge
        uint256 currentStakedBal = IERC20(_liqGaugeAddr).balanceOf(
            address(this)
        );
        // withdraw all remaining staked tokens
        IStakingHelper(_liqGaugeAddr).withdraw(currentStakedBal);
        // now get lp token balance
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        // transfer all to vault
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
        // now get crv token balance
        uint256 currentCrvBalance = IERC20(CRV_ADDR).balanceOf(address(this));
        // transfer all to vault
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCrvBalance);
    }
}
