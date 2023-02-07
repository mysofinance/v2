// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IAutoQuoteStrategy} from "./interfaces/IAutoQuoteStrategy.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard, Initializable {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;

    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) isConsumedQuote;
    mapping(bytes32 => bool) public isOnChainQuote;
    mapping(address => mapping(address => address)) public autoQuoteStrategy; // points to auto loan strategy for given coll/loan token pair
    DataTypes.OnChainQuote[] public onChainQuotes; // stores standing loan quotes
    mapping(address => address) public collTokenImplAddrs;
    DataTypes.Loan[] public loans; // stores loans

    uint256 loanOffChainQuoteNonce;
    address compartmentFactory;
    address lenderVaultFactory;

    error Invalid();
    error InvalidCompartmentAddr();

    function initialize(
        address _compartmentFactory,
        address _lenderVaultFactory
    ) external initializer {
        compartmentFactory = _compartmentFactory;
        lenderVaultFactory = _lenderVaultFactory;
        loanOffChainQuoteNonce = 1;
    }

    function invalidateQuotes()
        external
        returns (uint256 _currentOffChainNonce)
    {
        checkVaultFactorySender();
        _currentOffChainNonce = ++loanOffChainQuoteNonce;
    }

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        checkVaultFactorySender();
        autoQuoteStrategy[collToken][loanToken] = strategyAddr;
    }

    // don't need to verify that collToken is a valid whitelisted token cause that
    // would not be allowed through on the orders anyways
    function setCollTokenImpl(
        address collToken,
        address collTokenImplAddr
    ) external {
        checkVaultFactorySender();
        collTokenImplAddrs[collToken] = collTokenImplAddr;
    }

    function withdraw(address token, uint256 amount, address owner) external {
        checkVaultFactorySender();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function setOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuoteUpdateType onChainQuoteUpdateType,
        uint256 oldOnChainQuoteId
    ) external {
        checkVaultFactorySender();
        if (onChainQuoteUpdateType == DataTypes.OnChainQuoteUpdateType.ADD) {
            // CASE 1: add on-chain quote
            if (
                onChainQuote.collToken == onChainQuote.loanToken ||
                onChainQuote.timeUntilEarliestRepay > onChainQuote.tenor ||
                (onChainQuote.isNegativeInterestRate &&
                    onChainQuote.interestRatePctInBase > BASE)
            ) {
                revert Invalid();
            }
            bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
            if (isOnChainQuote[onChainQuoteHash]) {
                revert Invalid();
            }
            isOnChainQuote[onChainQuoteHash] = true;
            onChainQuotes.push(onChainQuote);
        } else {
            uint256 arrayLen = onChainQuotes.length;
            bytes32 oldOnChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
            isOnChainQuote[oldOnChainQuoteHash] = false;

            if (
                onChainQuoteUpdateType ==
                DataTypes.OnChainQuoteUpdateType.DELETE
            ) {
                onChainQuotes[oldOnChainQuoteId] = onChainQuotes[arrayLen - 1];
                onChainQuotes.pop();
            } else {
                bytes32 newOnChainQuoteHash = hashOnChainQuote(onChainQuote);
                if (oldOnChainQuoteHash == newOnChainQuoteHash) {
                    revert Invalid();
                }
                isOnChainQuote[newOnChainQuoteHash] = true;
            }
        }
    }

    function borrowWithOnChainQuote(
        address borrower,
        DataTypes.OnChainQuote memory onChainQuote,
        bool isAutoQuote,
        uint256 sendAmount,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        checkVaultFactorySender();
        if (isAutoQuote) {
            address strategyAddr = autoQuoteStrategy[onChainQuote.collToken][
                onChainQuote.loanToken
            ];
            if (strategyAddr == address(0)) {
                revert Invalid();
            }
            onChainQuote = IAutoQuoteStrategy(strategyAddr).getOnChainQuote();
        } else {
            if (!isOnChainQuote[hashOnChainQuote(onChainQuote)]) {
                revert Invalid();
            }
        }
        (
            uint256 upfrontFee,
            DataTypes.Loan memory loan
        ) = _getFeeAndLoanStructWithoutCollAmount(
                borrower,
                onChainQuote,
                sendAmount
            );
        _borrowTransfers(
            borrower,
            loan,
            sendAmount,
            upfrontFee,
            callbackAddr,
            data
        );
    }

    function borrowWithOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata loanOffChainQuote,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        checkVaultFactorySender();
        {
            bytes32 payloadHash = keccak256(
                abi.encode(
                    loanOffChainQuote.borrower,
                    loanOffChainQuote.collToken,
                    loanOffChainQuote.loanToken,
                    loanOffChainQuote.sendAmount,
                    loanOffChainQuote.loanAmount,
                    loanOffChainQuote.expiry,
                    loanOffChainQuote.earliestRepay,
                    loanOffChainQuote.repayAmount,
                    loanOffChainQuote.validUntil,
                    loanOffChainQuote.upfrontFee,
                    loanOffChainQuote.useCollCompartment,
                    loanOffChainQuote.nonce
                )
            );
            if (
                isConsumedQuote[payloadHash] ||
                loanOffChainQuote.nonce >= loanOffChainQuoteNonce
            ) {
                revert Invalid();
            }
            isConsumedQuote[payloadHash] = true;

            bytes32 messageHash = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    payloadHash
                )
            );
            address signer = ecrecover(
                messageHash,
                loanOffChainQuote.v,
                loanOffChainQuote.r,
                loanOffChainQuote.s
            );

            if (
                signer !=
                ILenderVaultFactory(lenderVaultFactory).vaultOwner(
                    address(this)
                ) ||
                loanOffChainQuote.validUntil < block.timestamp
            ) {
                revert Invalid();
            }
            if (
                loanOffChainQuote.borrower != address(0) &&
                loanOffChainQuote.borrower != borrower
            ) {
                revert Invalid();
            }
        }

        DataTypes.Loan memory loan;
        loan.borrower = borrower;
        loan.collToken = loanOffChainQuote.collToken;
        loan.loanToken = loanOffChainQuote.loanToken;
        loan.expiry = uint40(loanOffChainQuote.expiry);
        loan.earliestRepay = uint40(loanOffChainQuote.earliestRepay);
        loan.initRepayAmount = toUint128(loanOffChainQuote.repayAmount);
        loan.initLoanAmount = toUint128(loanOffChainQuote.loanAmount);
        loan.hasCollCompartment = loanOffChainQuote.useCollCompartment;

        _borrowTransfers(
            borrower,
            loan,
            loanOffChainQuote.sendAmount,
            loanOffChainQuote.upfrontFee,
            callbackAddr,
            data
        );
    }

    function _getFeeAndLoanStructWithoutCollAmount(
        address _borrower,
        DataTypes.OnChainQuote memory onChainQuote,
        uint256 sendAmount
    ) internal view returns (uint256 upfrontFee, DataTypes.Loan memory loan) {
        uint256 loanAmount = (onChainQuote.loanPerCollUnit * sendAmount) /
            (10 ** IERC20Metadata(onChainQuote.collToken).decimals());
        uint256 repayAmount;
        if (onChainQuote.isNegativeInterestRate) {
            repayAmount =
                (loanAmount * (BASE - onChainQuote.interestRatePctInBase)) /
                BASE;
        } else {
            repayAmount =
                (loanAmount * (BASE + onChainQuote.interestRatePctInBase)) /
                BASE;
        }
        loan.borrower = _borrower;
        loan.collToken = onChainQuote.collToken;
        loan.loanToken = onChainQuote.loanToken;
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(block.timestamp + onChainQuote.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + onChainQuote.timeUntilEarliestRepay
        );
        upfrontFee = (sendAmount * onChainQuote.upfrontFeePctInBase) / BASE;
    }

    function _borrowTransfers(
        address borrower,
        DataTypes.Loan memory loan,
        uint256 sendAmount,
        uint256 upfrontFee,
        address callbackAddr,
        bytes calldata data
    ) internal {
        uint256 loanTokenBalBefore = IERC20Metadata(loan.loanToken).balanceOf(
            address(this)
        );
        if (
            loanTokenBalBefore - lockedAmounts[loan.loanToken] <
            loan.initLoanAmount
        ) {
            revert();
        }
        uint256 collTokenBalBefore = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        // at transfers and callbacks return control back to factory, so less approvals?
        // transfer tokens from borrower to factory then factory to vault...?
        IERC20Metadata(loan.loanToken).safeTransfer(
            borrower,
            loan.initLoanAmount
        );
        if (callbackAddr != address(0)) {
            IVaultCallback(callbackAddr).borrowCallback(loan, data);
        }

        // send the vault full collateral amount
        IERC20Metadata(loan.collToken).safeTransferFrom(
            borrower,
            address(this),
            sendAmount
        );

        uint256 tokenBalAfter = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        // test that upfrontFee is not bigger than post transfer fee on collateral
        if (tokenBalAfter - collTokenBalBefore < upfrontFee) {
            revert Invalid();
        }

        uint128 reclaimable = toUint128(
            tokenBalAfter - collTokenBalBefore - upfrontFee
        );

        if (loan.hasCollCompartment) {
            (
                loan.collTokenCompartmentAddr,
                loan.initCollAmount
            ) = ILenderVaultFactory(lenderVaultFactory).createCompartment(
                loan,
                reclaimable,
                collTokenImplAddrs[loan.collToken],
                compartmentFactory,
                loans.length,
                data
            );
        } else {
            loan.initCollAmount = reclaimable;
            lockedAmounts[loan.collToken] += reclaimable;
        }
        loans.push(loan);
    }

    function repay(
        address borrower,
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        checkVaultFactorySender();
        DataTypes.Loan memory loan = loans[loanRepayInfo.loanId];
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
        uint128 reclaimCollAmount = toUint128(
            (loan.initCollAmount * loanRepayInfo.repayAmount) /
                loan.initRepayAmount
        );

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        if (loan.hasCollCompartment) {
            ICompartment(loan.collTokenCompartmentAddr).transferCollToBorrower(
                loanRepayInfo.repayAmount,
                loan.initRepayAmount - loan.amountRepaidSoFar,
                loan.borrower,
                loan.collToken
            );
        } else {
            IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
                borrower,
                reclaimCollAmount
            );
        }

        if (callbackAddr != address(0)) {
            IVaultCallback(callbackAddr).repayCallback(loan, data);
        }
        IERC20Metadata(loanRepayInfo.loanToken).safeTransferFrom(
            borrower,
            address(this),
            loanRepayInfo.repayAmount + loanRepayInfo.loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        uint128 loanTokenAmountReceived = toUint128(
            loanTokenBalAfter - loanTokenBalBefore
        );

        if (loanTokenAmountReceived < loanRepayInfo.repayAmount) {
            revert Invalid();
        }

        loan.amountRepaidSoFar += loanTokenAmountReceived;
        // only update lockedAmounts when no compartment
        if (!loan.hasCollCompartment) {
            lockedAmounts[loanRepayInfo.collToken] -= reclaimCollAmount;
        }
    }

    function unlockCollateral(
        address owner,
        address collToken,
        uint256[] calldata _loanIds
    ) external {
        checkVaultFactorySender();
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypes.Loan storage loan = loans[_loanIds[i]];
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                if (loan.hasCollCompartment) {
                    ICompartment(loan.collTokenCompartmentAddr)
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
        uint256 currentCollTokenBalance = IERC20Metadata(collToken).balanceOf(
            address(this)
        );
        IERC20Metadata(collToken).safeTransfer(
            owner,
            currentCollTokenBalance - lockedAmounts[collToken]
        );
    }

    function hashOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 onChainQuoteHash) {
        onChainQuoteHash = keccak256(
            abi.encode(
                onChainQuote.loanPerCollUnit,
                onChainQuote.interestRatePctInBase,
                onChainQuote.upfrontFeePctInBase,
                onChainQuote.collToken,
                onChainQuote.loanToken,
                onChainQuote.tenor,
                onChainQuote.timeUntilEarliestRepay,
                onChainQuote.isNegativeInterestRate,
                onChainQuote.useCollCompartment
            )
        );
    }

    function getVaultInfo()
        external
        view
        returns (
            uint256 _currLoanId,
            uint256 _loanOffChainQuoteNonce,
            uint256 _numOnChainQuotes,
            address _compartmentFactory,
            address _lenderFactory
        )
    {
        _currLoanId = loans.length;
        _loanOffChainQuoteNonce = loanOffChainQuoteNonce;
        _numOnChainQuotes = onChainQuotes.length;
        _compartmentFactory = compartmentFactory;
        _lenderFactory = lenderVaultFactory;
    }

    function checkVaultFactorySender() internal view {
        if (msg.sender != lenderVaultFactory) {
            revert Invalid();
        }
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert Invalid();
        }
    }
}
