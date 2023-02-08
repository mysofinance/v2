// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakeCompartment} from "../../interfaces/compartments/staking/IStakeCompartment.sol";
import {ICrvStaking} from "../../interfaces/compartments/staking/ICrvStaking.sol";
import {ICompartment} from "../../interfaces/ICompartment.sol";
import {ILenderVaultFactory} from "../../interfaces/ILenderVaultFactory.sol";
import {DataTypes} from "../../DataTypes.sol";

contract CurveStakingCompartment is Initializable, ICompartment {
    using SafeERC20 for IERC20;

    error InvalidSender();
    error InvalidPool();
    error IncorrectGaugeForLpToken();

    address public vaultAddr;
    uint256 public loanIdx;
    address public liqGaugeAddr;

    // todo: possibly have this be set at initialize instead of
    //separate BAL and AURA instances?
    address internal constant CRV_ADDR =
        0xD533a949740bb3306d119CC777fa900bA034cd52;

    address public lenderFactory;

    constructor(address _lenderFactory) {
        lenderFactory = _lenderFactory;
    }

    function initialize(
        address _vaultAddr,
        address _borrowerAddr,
        address _collTokenAddr,
        uint256 _loanIdx,
        bytes memory _data
    ) external initializer returns (uint256 collTokenBalAfter) {
        vaultAddr = _vaultAddr;
        loanIdx = _loanIdx;
        //needed to move this inside initializer since sending to stake
        // before returning control back to vault...
        collTokenBalAfter = IERC20(_collTokenAddr).balanceOf(address(this));
        _stake(_borrowerAddr, _collTokenAddr, collTokenBalAfter, _data);
    }

    // transfer coll on repays
    // todo: withdraw from pool
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
        ICrvStaking(_liqGaugeAddr).withdraw(withdrawAmount);
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

    function _stake(
        address,
        address collTokenAddr,
        uint256 amount,
        bytes memory data
    ) internal {
        address _liqGaugeAddr = abi.decode(data, (address));
        /* todo: update to address registry based
        if (
            !ILenderVaultFactory(lenderFactory).whitelistedAddrs(
                DataTypes.WhiteListType.STAKINGPOOL,
                liqGaugeAddr
            )
        ) revert InvalidPool();
        */
        address lpTokenAddrForGauge = ICrvStaking(_liqGaugeAddr).lp_token();
        if (lpTokenAddrForGauge != collTokenAddr) {
            revert IncorrectGaugeForLpToken();
        }
        liqGaugeAddr = _liqGaugeAddr;
        IERC20(collTokenAddr).approve(_liqGaugeAddr, type(uint256).max);
        ICrvStaking(_liqGaugeAddr).deposit(amount, address(this));
    }

    // unlockColl this would be called on defaults
    // todo: withdraw from pool
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        address _liqGaugeAddr = liqGaugeAddr;
        // check staked balance in gauge
        uint256 currentStakedBal = IERC20(_liqGaugeAddr).balanceOf(
            address(this)
        );
        // withdraw all remaining staked tokens
        ICrvStaking(_liqGaugeAddr).withdraw(currentStakedBal);
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
