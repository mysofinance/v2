// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {Helpers} from "../Helpers.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";
import {IQuotePolicyManager} from "./interfaces/IQuotePolicyManager.sol";

contract QuoteHandler is IQuoteHandler {
    using ECDSA for bytes32;

    address public immutable addressRegistry;
    mapping(address => uint256) public offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool))
        public offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;
    mapping(address => address) public quotePolicyManagerForVault;
    mapping(address => DataTypesPeerToPeer.OnChainQuoteInfo[])
        internal onChainQuoteHistory;

    constructor(address _addressRegistry) {
        if (_addressRegistry == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, false);
        if (!_isValidOnChainQuote(lenderVault, onChainQuote)) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.OnChainQuoteAlreadyAdded();
        }
        // @dev: on-chain quote history is append only
        onChainQuoteHistory[lenderVault].push(
            DataTypesPeerToPeer.OnChainQuoteInfo({
                quoteHash: onChainQuoteHash,
                validUntil: onChainQuote.generalQuoteInfo.validUntil
            })
        );
        isOnChainQuoteFromVault[onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        bytes32 oldOnChainQuoteHash,
        DataTypesPeerToPeer.OnChainQuote calldata newOnChainQuote
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, false);
        if (!_isValidOnChainQuote(lenderVault, newOnChainQuote)) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 newOnChainQuoteHash = _hashOnChainQuote(newOnChainQuote);
        // this check will catch the case where the old quote is the same as the new quote
        if (isOnChainQuoteFromVault[newOnChainQuoteHash]) {
            revert Errors.OnChainQuoteAlreadyAdded();
        }
        if (!isOnChainQuoteFromVault[oldOnChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        // @dev: on-chain quote history is append only
        onChainQuoteHistory[lenderVault].push(
            DataTypesPeerToPeer.OnChainQuoteInfo({
                quoteHash: newOnChainQuoteHash,
                validUntil: newOnChainQuote.generalQuoteInfo.validUntil
            })
        );
        isOnChainQuoteFromVault[oldOnChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, oldOnChainQuoteHash);

        isOnChainQuoteFromVault[newOnChainQuoteHash] = true;
        emit OnChainQuoteAdded(
            lenderVault,
            newOnChainQuote,
            newOnChainQuoteHash
        );
    }

    function deleteOnChainQuote(
        address lenderVault,
        bytes32 onChainQuoteHash
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, false);
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, false);
        uint256 newNonce = offChainQuoteNonce[lenderVault] + 1;
        offChainQuoteNonce[lenderVault] = newNonce;
        emit OffChainQuoteNonceIncremented(lenderVault, newNonce);
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, false);
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
        emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
    }

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        uint256 quoteTupleIdx,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        if (quoteTupleIdx >= onChainQuote.quoteTuples.length) {
            revert Errors.InvalidArrayIndex();
        }
        _checkSenderAndQuoteInfo(
            borrower,
            lenderVault,
            onChainQuote.generalQuoteInfo,
            onChainQuote.quoteTuples[quoteTupleIdx],
            true
        );
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        if (onChainQuote.generalQuoteInfo.isSingleUse) {
            isOnChainQuoteFromVault[onChainQuoteHash] = false;
            emit OnChainQuoteInvalidated(lenderVault, onChainQuoteHash);
        }
        uint256 nextLoanIdx = ILenderVaultImpl(lenderVault).totalNumLoans();
        emit OnChainQuoteUsed(
            lenderVault,
            onChainQuoteHash,
            nextLoanIdx,
            quoteTupleIdx
        );
    }

    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.OffChainQuote calldata offChainQuote,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bytes32[] calldata proof
    ) external {
        _checkSenderAndQuoteInfo(
            borrower,
            lenderVault,
            offChainQuote.generalQuoteInfo,
            quoteTuple,
            false
        );
        if (offChainQuote.nonce < offChainQuoteNonce[lenderVault]) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage offChainQuoteFromVaultIsInvalidated = offChainQuoteIsInvalidated[
                lenderVault
            ];
        bytes32 offChainQuoteHash = _hashOffChainQuote(
            offChainQuote,
            lenderVault
        );
        if (offChainQuoteFromVaultIsInvalidated[offChainQuoteHash]) {
            revert Errors.OffChainQuoteHasBeenInvalidated();
        }
        if (
            !_areValidSignatures(
                lenderVault,
                offChainQuoteHash,
                offChainQuote.compactSigs
            )
        ) {
            revert Errors.InvalidOffChainSignature();
        }

        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        quoteTuple.loanPerCollUnitOrLtv,
                        quoteTuple.interestRatePctInBase,
                        quoteTuple.upfrontFeePctInBase,
                        quoteTuple.tenor
                    )
                )
            )
        );
        if (!MerkleProof.verify(proof, offChainQuote.quoteTuplesRoot, leaf)) {
            revert Errors.InvalidOffChainMerkleProof();
        }
        if (offChainQuote.generalQuoteInfo.isSingleUse) {
            offChainQuoteFromVaultIsInvalidated[offChainQuoteHash] = true;
            emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
        }
        uint256 toBeRegisteredLoanId = ILenderVaultImpl(lenderVault)
            .totalNumLoans();
        emit OffChainQuoteUsed(
            lenderVault,
            offChainQuoteHash,
            toBeRegisteredLoanId,
            quoteTuple
        );
    }

    function updateQuotePolicyManagerForVault(
        address lenderVault,
        address newPolicyManagerAddress,
        bool isRevoke
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault, true);
        if (isRevoke) {
            delete quotePolicyManagerForVault[lenderVault];
        } else {
            if (
                IAddressRegistry(addressRegistry).whitelistState(
                    newPolicyManagerAddress
                ) != DataTypesPeerToPeer.WhitelistState.QUOTE_POLICY_MANAGER
            ) {
                revert Errors.InvalidAddress();
            }
            quotePolicyManagerForVault[lenderVault] = newPolicyManagerAddress;
        }
        emit QuotePolicyManagerUpdated(
            lenderVault,
            isRevoke ? address(0) : newPolicyManagerAddress
        );
    }

    function getOnChainQuoteHistory(
        address lenderVault,
        uint256 idx
    ) external view returns (DataTypesPeerToPeer.OnChainQuoteInfo memory) {
        if (idx < onChainQuoteHistory[lenderVault].length) {
            return onChainQuoteHistory[lenderVault][idx];
        } else {
            revert Errors.InvalidArrayIndex();
        }
    }

    function getFullOnChainQuoteHistory(
        address lenderVault
    ) external view returns (DataTypesPeerToPeer.OnChainQuoteInfo[] memory) {
        return onChainQuoteHistory[lenderVault];
    }

    function getOnChainQuoteHistoryLength(
        address lenderVault
    ) external view returns (uint256) {
        return onChainQuoteHistory[lenderVault].length;
    }

    /**
     * @dev The passed signatures must be sorted such that recovered addresses are increasing.
     */
    function _areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        bytes[] calldata compactSigs
    ) internal view returns (bool) {
        uint256 compactSigsLength = compactSigs.length;
        if (
            compactSigsLength < ILenderVaultImpl(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(offChainQuoteHash);
        address recoveredSigner;
        address prevSigner;
        for (uint256 i; i < compactSigsLength; ) {
            (bytes32 r, bytes32 vs) = Helpers.splitSignature(compactSigs[i]);
            recoveredSigner = messageHash.recover(r, vs);
            if (!ILenderVaultImpl(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            if (recoveredSigner <= prevSigner) {
                return false;
            }
            prevSigner = recoveredSigner;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    function _hashOffChainQuote(
        DataTypesPeerToPeer.OffChainQuote memory offChainQuote,
        address lenderVault
    ) internal view returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                offChainQuote.generalQuoteInfo,
                offChainQuote.quoteTuplesRoot,
                offChainQuote.salt,
                offChainQuote.nonce,
                lenderVault,
                block.chainid
            )
        );
    }

    function _checkSenderAndQuoteInfo(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bool onChainQuote
    ) internal view {
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert Errors.InvalidSender();
        }
        if (
            quotePolicyManagerForVault[lenderVault] != address(0) &&
            !IQuotePolicyManager(quotePolicyManagerForVault[lenderVault])
                .checkPendingBorrowQuoteInfoAndTuple(
                    borrower,
                    lenderVault,
                    generalQuoteInfo,
                    quoteTuple,
                    onChainQuote
                )
        ) {
            revert Errors.QuoteViolatesPolicy();
        }
        _checkWhitelist(
            generalQuoteInfo.collToken,
            generalQuoteInfo.loanToken,
            generalQuoteInfo.borrowerCompartmentImplementation,
            generalQuoteInfo.oracleAddr,
            _isSwap(generalQuoteInfo, quoteTuple)
        );
        if (generalQuoteInfo.validUntil < block.timestamp) {
            revert Errors.OutdatedQuote();
        }
        if (
            generalQuoteInfo.collToken == generalQuoteInfo.loanToken ||
            generalQuoteInfo.maxLoan == 0 ||
            generalQuoteInfo.minLoan == 0 ||
            generalQuoteInfo.minLoan > generalQuoteInfo.maxLoan
        ) {
            revert Errors.InvalidQuote();
        }
        if (
            generalQuoteInfo.whitelistAddr != address(0) &&
            ((generalQuoteInfo.isWhitelistAddrSingleBorrower &&
                generalQuoteInfo.whitelistAddr != borrower) ||
                (!generalQuoteInfo.isWhitelistAddrSingleBorrower &&
                    !IAddressRegistry(addressRegistry).isWhitelistedBorrower(
                        generalQuoteInfo.whitelistAddr,
                        borrower
                    )))
        ) {
            revert Errors.InvalidBorrower();
        }
    }

    function _isValidOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) internal view returns (bool) {
        if (
            quotePolicyManagerForVault[lenderVault] != address(0) &&
            !IQuotePolicyManager(quotePolicyManagerForVault[lenderVault])
                .checkNewOnChainQuote(lenderVault, onChainQuote)
        ) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.collToken ==
            onChainQuote.generalQuoteInfo.loanToken
        ) {
            return false;
        }
        if (onChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.maxLoan == 0 ||
            onChainQuote.generalQuoteInfo.minLoan == 0 ||
            onChainQuote.generalQuoteInfo.minLoan >
            onChainQuote.generalQuoteInfo.maxLoan
        ) {
            return false;
        }
        uint256 quoteTuplesLen = onChainQuote.quoteTuples.length;
        if (quoteTuplesLen == 0) {
            return false;
        }
        bool isSwap;
        for (uint256 k; k < quoteTuplesLen; ) {
            (bool isValid, bool isSwapCurr) = _isValidOnChainQuoteTuple(
                onChainQuote.generalQuoteInfo,
                onChainQuote.quoteTuples[k]
            );
            if (!isValid) {
                return false;
            }
            if (isSwapCurr && quoteTuplesLen > 1) {
                return false;
            }
            isSwap = isSwapCurr;
            unchecked {
                ++k;
            }
        }
        _checkWhitelist(
            onChainQuote.generalQuoteInfo.collToken,
            onChainQuote.generalQuoteInfo.loanToken,
            onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation,
            onChainQuote.generalQuoteInfo.oracleAddr,
            isSwap
        );
        return true;
    }

    function _checkWhitelist(
        address collToken,
        address loanToken,
        address compartmentImpl,
        address oracleAddr,
        bool isSwap
    ) internal view {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedERC20(loanToken) ||
            !IAddressRegistry(addressRegistry).isWhitelistedERC20(collToken)
        ) {
            revert Errors.NonWhitelistedToken();
        }

        if (isSwap) {
            if (compartmentImpl != address(0)) {
                revert Errors.InvalidSwap();
            }
            return;
        }
        if (compartmentImpl == address(0)) {
            DataTypesPeerToPeer.WhitelistState collTokenWhitelistState = IAddressRegistry(
                    addressRegistry
                ).whitelistState(collToken);
            if (
                collTokenWhitelistState ==
                DataTypesPeerToPeer
                    .WhitelistState
                    .ERC20_TOKEN_REQUIRING_COMPARTMENT
            ) {
                revert Errors.CollateralMustBeCompartmentalized();
            }
        } else {
            if (
                !IAddressRegistry(addressRegistry).isWhitelistedCompartment(
                    compartmentImpl,
                    collToken
                )
            ) {
                revert Errors.InvalidCompartmentForToken();
            }
        }
        if (
            oracleAddr != address(0) &&
            IAddressRegistry(addressRegistry).whitelistState(oracleAddr) !=
            DataTypesPeerToPeer.WhitelistState.ORACLE
        ) {
            revert Errors.NonWhitelistedOracle();
        }
    }

    function _checkIsRegisteredVaultAndSenderIsApproved(
        address lenderVault,
        bool onlyOwner
    ) internal view {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (
            ILenderVaultImpl(lenderVault).owner() != msg.sender &&
            (onlyOwner ||
                ILenderVaultImpl(lenderVault).approvedQuoteHandler() !=
                msg.sender)
        ) {
            revert Errors.InvalidSender();
        }
    }

    function _hashOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }

    function _isValidOnChainQuoteTuple(
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool, bool) {
        bool isSwap = _isSwap(generalQuoteInfo, quoteTuple);
        if (quoteTuple.upfrontFeePctInBase < Constants.BASE) {
            // note: if upfrontFee<100% this corresponds to a loan; check that tenor and earliest repay are consistent
            if (
                quoteTuple.tenor <
                generalQuoteInfo.earliestRepayTenor +
                    Constants.MIN_TIME_BETWEEN_EARLIEST_REPAY_AND_EXPIRY
            ) {
                return (false, isSwap);
            }
        } else if (quoteTuple.upfrontFeePctInBase == Constants.BASE) {
            // note: if upfrontFee=100% this corresponds to an outright swap; check other fields are consistent
            if (!isSwap) {
                return (false, isSwap);
            }
        } else {
            // note: if upfrontFee>100% this is invalid
            return (false, isSwap);
        }

        if (quoteTuple.loanPerCollUnitOrLtv == 0) {
            return (false, isSwap);
        }
        // If the oracle address is set and there is not specified whitelistAddr
        // then LTV must be set to a value <= 100% (overcollateralized).
        // note: Loans with whitelisted borrowers CAN be undercollateralized with oracles (LTV > 100%).
        // oracle address is set
        // ---> whitelistAddr is not set
        // ---> ---> LTV must be overcollateralized
        // ---> whitelistAddr is set
        // ---> ---> LTV can be any
        // oracle address is not set
        // ---> loanPerCollUnit can be any with or without whitelistAddr
        if (
            generalQuoteInfo.oracleAddr != address(0) &&
            quoteTuple.loanPerCollUnitOrLtv > Constants.BASE &&
            generalQuoteInfo.whitelistAddr == address(0)
        ) {
            return (false, isSwap);
        }
        if (quoteTuple.interestRatePctInBase + int(Constants.BASE) <= 0) {
            return (false, isSwap);
        }
        return (true, isSwap);
    }

    function _isSwap(
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool) {
        return
            quoteTuple.upfrontFeePctInBase == Constants.BASE &&
            quoteTuple.tenor + generalQuoteInfo.earliestRepayTenor == 0 &&
            quoteTuple.interestRatePctInBase == 0 &&
            generalQuoteInfo.borrowerCompartmentImplementation == address(0);
    }
}
