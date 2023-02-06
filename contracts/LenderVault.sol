// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
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
    // for now remove public getter for byte code size purposes...
    mapping(address => address) collTokenImplAddrs;
    DataTypes.Loan[] public loans; // stores loans

    uint256 currLoanId;
    uint256 loanOffChainQuoteNonce;
    address compartmentFactory;
    address lenderVaultFactory;

    /*
    can remove ILendingPool because also interest bearing tokens can be deposited 
    by virtue of simple transfer; e.g. lender can also deposit an atoken and allow
    borrowers to directly borrow the atoken; the repayment amount could then also be
    set to be atoken such that on repayment any idle funds automatically continue earning
    yield
    */

    error Invalid();
    error InvalidCompartmentAddr();

    event OnChainQuote(DataTypes.OnChainQuote onChainQuote, bool isActive);

    function initialize(
        address _compartmentFactory,
        address _lenderVaultFactory
    ) external initializer {
        compartmentFactory = _compartmentFactory;
        lenderVaultFactory = _lenderVaultFactory;
        loanOffChainQuoteNonce = 1;
    }

    function invalidateQuotes() external {
        senderCheck();
        loanOffChainQuoteNonce += 1;
    }

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        senderCheck();
        whitelistCheck(DataTypes.WhiteListType.STRATEGY, strategyAddr);
        autoQuoteStrategy[collToken][loanToken] = strategyAddr;
    }

    // don't need to verify that collToken is a valid whitelisted token cause that
    // would not be allowed through on the orders anyways
    function setCollTokenImpl(
        address collToken,
        address collTokenImplAddr
    ) external {
        senderCheck();
        whitelistCheck(DataTypes.WhiteListType.COMPARTMENT, collTokenImplAddr);
        collTokenImplAddrs[collToken] = collTokenImplAddr;
    }

    function withdraw(address token, uint256 amount) external {
        senderCheck();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        address owner = ILenderVaultFactory(lenderVaultFactory).vaultOwner(
            address(this)
        );
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function setOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote,
        DataTypes.OnChainQuoteUpdateType onChainQuoteUpdateType,
        uint256 oldOnChainQuoteId
    ) external {
        senderCheck();
        if (onChainQuoteUpdateType == DataTypes.OnChainQuoteUpdateType.ADD) {
            // CASE 1: add on-chain quote
            // remove address 0 check since this will be 0 address will not be allowed to be whitelisted in factory
            whitelistCheck(
                DataTypes.WhiteListType.TOKEN,
                onChainQuote.loanToken
            );
            whitelistCheck(
                DataTypes.WhiteListType.TOKEN,
                onChainQuote.collToken
            );
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
            emit OnChainQuote(onChainQuote, true);
        } else {
            uint256 arrayLen = onChainQuotes.length;
            if (oldOnChainQuoteId > arrayLen - 1) {
                revert Invalid();
            }
            DataTypes.OnChainQuote memory oldOnChainQuote = onChainQuotes[
                oldOnChainQuoteId
            ];
            bytes32 oldOnChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
            isOnChainQuote[oldOnChainQuoteHash] = false;

            if (
                onChainQuoteUpdateType ==
                DataTypes.OnChainQuoteUpdateType.DELETE
            ) {
                onChainQuotes[oldOnChainQuoteId] = onChainQuotes[arrayLen - 1];
                onChainQuotes.pop();
            } else {
                whitelistCheck(
                    DataTypes.WhiteListType.TOKEN,
                    onChainQuote.loanToken
                );
                whitelistCheck(
                    DataTypes.WhiteListType.TOKEN,
                    onChainQuote.collToken
                );
                bytes32 newOnChainQuoteHash = hashOnChainQuote(onChainQuote);
                if (oldOnChainQuoteHash == newOnChainQuoteHash) {
                    revert Invalid();
                }
                isOnChainQuote[newOnChainQuoteHash] = true;
                emit OnChainQuote(onChainQuote, true);
            }
            emit OnChainQuote(oldOnChainQuote, false);
        }
    }

    function borrowWithOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote,
        bool isAutoQuote,
        uint256 sendAmount,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        currLoanId += 1;
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
            uint256 feeAmount,
            DataTypes.Loan memory loan
        ) = _getFeeAndLoanExclCollAmount(onChainQuote, sendAmount);
        _borrowTransfers(loan, sendAmount, feeAmount, callbacker, data);
    }

    function borrowWithOffChainQuote(
        DataTypes.OffChainQuote calldata loanOffChainQuote,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        whitelistCheck(
            DataTypes.WhiteListType.TOKEN,
            loanOffChainQuote.loanToken
        );
        whitelistCheck(
            DataTypes.WhiteListType.TOKEN,
            loanOffChainQuote.collToken
        );
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
                loanOffChainQuote.borrower != msg.sender
            ) {
                revert Invalid();
            }
        }

        currLoanId += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.collToken = loanOffChainQuote.collToken;
        loan.loanToken = loanOffChainQuote.loanToken;
        loan.expiry = uint40(loanOffChainQuote.expiry);
        loan.earliestRepay = uint40(loanOffChainQuote.earliestRepay);
        loan.initRepayAmount = uint128(loanOffChainQuote.repayAmount);
        loan.initLoanAmount = uint128(loanOffChainQuote.loanAmount);
        loan.hasCollCompartment = loanOffChainQuote.useCollCompartment;

        _borrowTransfers(
            loan,
            loanOffChainQuote.sendAmount,
            loanOffChainQuote.upfrontFee,
            callbacker,
            data
        );
    }

    function _getFeeAndLoanExclCollAmount(
        DataTypes.OnChainQuote memory onChainQuote,
        uint256 sendAmount
    ) internal view returns (uint256 feeAmount, DataTypes.Loan memory loan) {
        uint256 loanAmount = (onChainQuote.loanPerCollUnit * sendAmount) /
            (10 ** IERC20Metadata(onChainQuote.collToken).decimals());
        if (uint128(loanAmount) != loanAmount) {
            revert Invalid();
        }
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
        if (uint128(repayAmount) != repayAmount) {
            revert Invalid();
        }

        loan.borrower = msg.sender;
        loan.collToken = onChainQuote.collToken;
        loan.loanToken = onChainQuote.loanToken;
        loan.initLoanAmount = uint128(loanAmount);
        loan.initRepayAmount = uint128(repayAmount);
        loan.expiry = uint40(block.timestamp + onChainQuote.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + onChainQuote.timeUntilEarliestRepay
        );
        feeAmount = (sendAmount * onChainQuote.upfrontFeePctInBase) / BASE;
    }

    function _borrowTransfers(
        DataTypes.Loan memory loan,
        uint256 sendAmount,
        uint256 upfrontFee,
        address callbacker,
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

        IERC20Metadata(loan.loanToken).safeTransfer(
            msg.sender,
            loan.initLoanAmount
        );
        if (callbacker != address(0)) {
            whitelistCheck(DataTypes.WhiteListType.FLASHLOAN, callbacker);
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }

        // uint256 tokenBalAfter = IERC20Metadata(loan.loanToken).balanceOf(
        //     address(this)
        // );

        // check exactly that at least correct loan amount is sent
        // if (loanTokenBalBefore - tokenBalAfter < loan.initLoanAmount) {
        //     revert Invalid();
        // }

        // send the vault full collateral amount
        IERC20Metadata(loan.collToken).safeTransferFrom(
            msg.sender,
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

        uint256 reclaimable = tokenBalAfter - collTokenBalBefore - upfrontFee;
        if (reclaimable != uint128(reclaimable)) {
            revert Invalid();
        }

        if (loan.hasCollCompartment) {
            (
                loan.collTokenCompartmentAddr,
                loan.initCollAmount
            ) = ILenderVaultFactory(lenderVaultFactory).createCompartments(
                loan,
                reclaimable,
                collTokenImplAddrs[loan.collToken],
                compartmentFactory,
                loans.length,
                data
            );
        } else {
            loan.initCollAmount = uint128(reclaimable);
            lockedAmounts[loan.collToken] += uint128(reclaimable);
        }
        loans.push(loan);
    }

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.Loan memory loan = loans[loanRepayInfo.loanId];
        if (msg.sender != loan.borrower) {
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
        uint256 reclaimCollAmount = (loan.initCollAmount *
            loanRepayInfo.repayAmount) / loan.initRepayAmount;

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));
        // uint256 collTokenBalBefore = IERC20Metadata(loanRepayInfo.collToken)
        //     .balanceOf(address(this));

        if (loan.hasCollCompartment) {
            ICompartment(loan.collTokenCompartmentAddr).transferCollToBorrower(
                reclaimCollAmount,
                loan.initCollAmount,
                loan.borrower,
                loan.collToken
            );
        } else {
            IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
                msg.sender,
                reclaimCollAmount
            );
        }

        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data); // todo: whitelist callbacker
        }
        IERC20Metadata(loanRepayInfo.loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanRepayInfo.repayAmount + loanRepayInfo.loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        uint256 loanTokenAmountReceived = loanTokenBalAfter -
            loanTokenBalBefore;
        // uint256 collTokenBalAfter = IERC20Metadata(loanRepayInfo.collToken)
        //     .balanceOf(address(this));

        if (loanTokenAmountReceived < loanRepayInfo.repayAmount) {
            revert Invalid();
        }
        // balance only changes when no compartment
        // if (
        //     !loan.hasCollCompartment &&
        //     collTokenBalBefore - collTokenBalAfter < reclaimCollAmount
        // ) {
        //     revert Invalid();
        // }

        loan.amountRepaidSoFar += uint128(loanTokenAmountReceived);
        // only update lockedAmounts when no compartment
        if (!loan.hasCollCompartment) {
            lockedAmounts[loanRepayInfo.collToken] -= uint128(
                reclaimCollAmount
            );
        }
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds
    ) external {
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
            ILenderVaultFactory(lenderVaultFactory).vaultOwner(address(this)),
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
            address _compartmentFactory,
            address _lenderFactory
        )
    {
        _currLoanId = currLoanId;
        _loanOffChainQuoteNonce = loanOffChainQuoteNonce;
        _compartmentFactory = compartmentFactory;
        _lenderFactory = lenderVaultFactory;
    }

    function senderCheck() internal {
        address vaultOwner = ILenderVaultFactory(lenderVaultFactory).vaultOwner(
            address(this)
        );
        if (msg.sender != vaultOwner) {
            revert Invalid();
        }
    }

    function whitelistCheck(
        DataTypes.WhiteListType _type,
        address _addrToCheck
    ) internal {
        if (
            !ILenderVaultFactory(lenderVaultFactory).whitelistedAddrs(
                _type,
                _addrToCheck
            )
        ) revert Invalid();
    }
}
