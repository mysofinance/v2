// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IAutoQuoteStrategy} from "./interfaces/IAutoQuoteStrategy.sol";
import {IBorrowerCompartment} from "./interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard, Initializable, ILenderVault {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address public vaultOwner;
    address public newVaultOwner;
    address public addressRegistry;

    mapping(address => uint256) public lockedAmounts;
    DataTypes.Loan[] _loans; // stores loans

    error Invalid();
    error InvalidLoanIndex();

    function initialize(
        address _vaultOwner,
        address _addressRegistry
    ) external initializer {
        vaultOwner = _vaultOwner;
        addressRegistry = _addressRegistry;
    }

    function proposeNewVaultOwner(address _newOwner) external {
        senderCheckOwner();
        newVaultOwner = _newOwner;
    }

    function claimVaultOwnership() external {
        if (msg.sender != newVaultOwner) {
            revert Invalid();
        }
        vaultOwner = newVaultOwner;
    }

    function loans(
        uint256 loanId
    ) external view returns (DataTypes.Loan memory loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert InvalidLoanIndex();
        }
        loan = _loans[loanId];
    }

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external {
        senderCheckGateway();
        IERC20Metadata(token).safeTransfer(recipient, amount);
    }

    function transferFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        address collTokenCompartmentAddr
    ) external {
        senderCheckGateway();
        IBorrowerCompartment(collTokenCompartmentAddr)
            .transferCollFromCompartment(
                repayAmount,
                repayAmountLeft,
                borrowerAddr,
                collTokenAddr,
                callbackAddr
            );
    }

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory loan,
        DataTypes.LoanRepayInfo memory loanRepayInfo
    ) external view {
        if (borrower != loan.borrower) {
            revert Invalid();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Invalid();
        }
        if (
            loanRepayInfo.repayAmount >
            loan.initRepayAmount - loan.amountRepaidSoFar
        ) {
            revert Invalid();
        }
    }

    function updateLoanInfo(
        DataTypes.Loan memory loan,
        uint128 repayAmount,
        uint256 loanId,
        uint256 collAmount,
        bool isRepay
    ) external {
        senderCheckGateway();
        if (isRepay) {
            loan.amountRepaidSoFar += repayAmount;
        }

        // only update lockedAmounts when no compartment
        if (loan.collTokenCompartmentAddr == address(0)) {
            if (isRepay) {
                lockedAmounts[loan.collToken] -= collAmount;
            } else {
                lockedAmounts[loan.collToken] += collAmount;
            }
        }
        if (isRepay || loan.collTokenCompartmentAddr != address(0)) {
            _loans[loanId] = loan;
        }
    }

    function addLoan(
        DataTypes.Loan calldata loan
    ) external returns (uint256 loanId) {
        senderCheckGateway();
        loanId = _loans.length;
        _loans.push(loan);
    }

    function withdraw(address token, uint256 amount) external {
        senderCheckOwner();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(vaultOwner, amount);
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds,
        bool autoWithdraw
    ) external {
        uint256 totalUnlockableColl;

        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypes.Loan storage loan = _loans[_loanIds[i]];

            if (loan.collToken != collToken) {
                revert();
            }
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                if (loan.collTokenCompartmentAddr != address(0)) {
                    IBorrowerCompartment(loan.collTokenCompartmentAddr)
                        .unlockCollToVault(loan.collToken);
                } else {
                    tmp =
                        loan.initCollAmount -
                        (loan.initCollAmount * loan.amountRepaidSoFar) /
                        loan.initRepayAmount;
                    totalUnlockableColl += tmp;
                }
            }
            loan.collUnlocked = true;
            unchecked {
                i++;
            }
        }

        lockedAmounts[collToken] -= totalUnlockableColl;
        // if collToken is not used by vault as loan token too
        if (autoWithdraw) {
            uint256 currentCollTokenBalance = IERC20Metadata(collToken)
                .balanceOf(address(this));

            IERC20Metadata(collToken).safeTransfer(
                vaultOwner,
                currentCollTokenBalance - lockedAmounts[collToken]
            );
        }
    }

    function senderCheckOwner() internal view {
        if (msg.sender != vaultOwner) {
            revert Invalid();
        }
    }

    function senderCheckGateway() internal view {
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert();
        }
    }
}
