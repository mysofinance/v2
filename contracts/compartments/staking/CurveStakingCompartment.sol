// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakeCompartment} from "../../interfaces/IStakeCompartment.sol";
import {ICompartment} from "../../interfaces/ICompartment.sol";
import {ILenderVaultFactory} from "../../interfaces/ILenderVaultFactory.sol";
import {DataTypes} from "../../DataTypes.sol";

// start simple with just an example voting and rewards implementation
// could make a mapping later for more flexibility
contract CurveStakingCompartment is Initializable, ICompartment {
    using SafeERC20 for IERC20;

    error InvalidSender();
    error InvalidPool();

    address public vaultAddr;
    uint256 public loanIdx;
    address public veCrvPool;

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
        _stake(_borrowerAddr, _collTokenAddr, _data);
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
        // on rewards or staking, first need to checkpoint rewards possibly...
        // also need to check if locked (haven't put that function in yet)
        uint256 currentCompartmentBal = IERC20(collTokenAddr).balanceOf(
            address(this)
        ); // todo: this needs to be withdraw
        uint256 amount = (repayAmount * currentCompartmentBal) /
            repayAmountLeft;
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, amount);
    }

    // not sure what the staking is and what else if anything needs to be passed in...
    // but this is the general layout for all the staking compartments...
    // todo: add check that collToken is actually LP token for given crv pool by calling lp_token public getter???
    function _stake(
        address borrowerAddr,
        address collTokenAddr,
        bytes memory data
    ) internal {
        // todo: think about data clashing resolution, how much data is passed for all cases, including flash loan case...
        // this means decoding will have more data, but I'll leave as just one address for now
        (address crvGaugeAddr, address _veCrvPool) = abi.decode(
            data,
            (address, address)
        );
        if (
            !ILenderVaultFactory(lenderFactory).whitelistedAddrs(
                DataTypes.WhiteListType.POOL,
                crvGaugeAddr
            ) ||
            !ILenderVaultFactory(lenderFactory).whitelistedAddrs(
                DataTypes.WhiteListType.POOL,
                _veCrvPool
            )
        ) revert InvalidPool();
        veCrvPool = _veCrvPool;
        IERC20(collTokenAddr).approve(crvGaugeAddr, type(uint256).max);
        uint256 currCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IStakeCompartment(crvGaugeAddr).deposit(
            currCollBalance,
            borrowerAddr,
            true
        );
    }

    // unlockColl this would be called on defaults
    // todo: withdraw from pool
    function unlockCollToVault(address collTokenAddr) external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
    }

    //todo: mint/lock crv option less than expiry?
}
