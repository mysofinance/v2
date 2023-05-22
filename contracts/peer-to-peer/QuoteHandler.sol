// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";

contract QuoteHandler is IQuoteHandler {
    address public immutable addressRegistry;
    mapping(address => uint256) public offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool))
        public offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;

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
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!_isValidOnChainQuote(onChainQuote)) {
            revert Errors.InvalidQuote();
        }
        _checkTokensAndCompartmentWhitelist(
            onChainQuote.generalQuoteInfo.collToken,
            onChainQuote.generalQuoteInfo.loanToken,
            _addressRegistry,
            onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation
        );
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.OnChainQuoteAlreadyAdded();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata oldOnChainQuote,
        DataTypesPeerToPeer.OnChainQuote calldata newOnChainQuote
    ) external {
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!_isValidOnChainQuote(newOnChainQuote)) {
            revert Errors.InvalidQuote();
        }
        _checkTokensAndCompartmentWhitelist(
            newOnChainQuote.generalQuoteInfo.collToken,
            newOnChainQuote.generalQuoteInfo.loanToken,
            _addressRegistry,
            newOnChainQuote.generalQuoteInfo.borrowerCompartmentImplementation
        );
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(oldOnChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
        onChainQuoteHash = _hashOnChainQuote(newOnChainQuote);
        isOnChainQuoteFromVault[onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, newOnChainQuote, onChainQuoteHash);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        uint256 newNonce = offChainQuoteNonce[lenderVault] + 1;
        offChainQuoteNonce[lenderVault] = newNonce;
        emit OffChainQuoteNonceIncremented(lenderVault, newNonce);
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
        emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
    }

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        uint256 quoteTupleIdx,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        _checkSenderAndGeneralQuoteInfo(
            borrower,
            onChainQuote.generalQuoteInfo
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
        bytes32[] memory proof
    ) external {
        _checkSenderAndGeneralQuoteInfo(
            borrower,
            offChainQuote.generalQuoteInfo
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
                offChainQuote.v,
                offChainQuote.r,
                offChainQuote.s
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
        uint256 nextLoanIdx = ILenderVaultImpl(lenderVault).totalNumLoans();
        emit OffChainQuoteUsed(
            lenderVault,
            offChainQuoteHash,
            nextLoanIdx,
            quoteTuple
        );
    }

    /**
     * @dev The passed signatures must be sorted such that
     * recovered addresses (cast to uint160) are increasing.
     */
    function _areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) internal view returns (bool) {
        if (
            v.length != r.length ||
            v.length != s.length ||
            v.length != ILenderVaultImpl(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        address recoveredSigner;
        uint160 prevSignerCastToUint160;
        for (uint256 i = 0; i < v.length; ) {
            recoveredSigner = ECDSA.recover(messageHash, v[i], r[i], s[i]);
            if (!ILenderVaultImpl(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            uint160 recoveredSignerCastToUint160 = uint160(recoveredSigner);
            if (recoveredSignerCastToUint160 <= prevSignerCastToUint160) {
                return false;
            }
            prevSignerCastToUint160 = recoveredSignerCastToUint160;
            unchecked {
                i++;
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

    function _checkSenderAndGeneralQuoteInfo(
        address borrower,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo
    ) internal view {
        address _addressRegistry = addressRegistry;
        if (
            msg.sender != IAddressRegistry(_addressRegistry).borrowerGateway()
        ) {
            revert Errors.InvalidSender();
        }
        _checkTokensAndCompartmentWhitelist(
            generalQuoteInfo.collToken,
            generalQuoteInfo.loanToken,
            _addressRegistry,
            generalQuoteInfo.borrowerCompartmentImplementation
        );
        if (generalQuoteInfo.validUntil < block.timestamp) {
            revert Errors.OutdatedQuote();
        }
        if (generalQuoteInfo.collToken == generalQuoteInfo.loanToken) {
            revert Errors.InvalidQuote();
        }
        if (
            generalQuoteInfo.whitelistAuthority != address(0) &&
            !IAddressRegistry(_addressRegistry).isWhitelistedBorrower(
                generalQuoteInfo.whitelistAuthority,
                borrower
            )
        ) {
            revert Errors.InvalidBorrower();
        }
    }

    function _isValidOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) internal view returns (bool) {
        if (
            onChainQuote.generalQuoteInfo.collToken ==
            onChainQuote.generalQuoteInfo.loanToken
        ) {
            return false;
        }
        if (onChainQuote.quoteTuples.length == 0) {
            return false;
        }
        if (onChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.maxLoan == 0 ||
            onChainQuote.generalQuoteInfo.minLoan >
            onChainQuote.generalQuoteInfo.maxLoan
        ) {
            return false;
        }
        for (uint256 k = 0; k < onChainQuote.quoteTuples.length; ) {
            if (
                onChainQuote.quoteTuples[k].upfrontFeePctInBase > Constants.BASE
            ) {
                return false;
            }
            // If the oracle address is set, the LTV can only be set to a value > 1 (undercollateralized)
            // when there is a specified whitelist authority address.
            // Otherwise, the LTV must be set to a value <= 100% (overcollateralized).
            if (
                onChainQuote.generalQuoteInfo.oracleAddr != address(0) &&
                onChainQuote.quoteTuples[k].loanPerCollUnitOrLtv >
                Constants.BASE &&
                onChainQuote.generalQuoteInfo.whitelistAuthority == address(0)
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].interestRatePctInBase +
                    int(Constants.BASE) <=
                0
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].tenor <
                onChainQuote.generalQuoteInfo.earliestRepayTenor +
                    Constants.MIN_TIME_BETWEEN_EARLIEST_REPAY_AND_EXPIRY
            ) {
                return false;
            }
            unchecked {
                k++;
            }
        }
        return true;
    }

    function _checkTokensAndCompartmentWhitelist(
        address collToken,
        address loanToken,
        address _addressRegistry,
        address compartmentImpl
    ) internal view {
        IAddressRegistry registry = IAddressRegistry(_addressRegistry);
        if (
            !registry.isWhitelistedERC20(loanToken) ||
            !registry.isWhitelistedERC20(collToken)
        ) {
            revert Errors.NonWhitelistedToken();
        }

        DataTypesPeerToPeer.WhitelistState collTokenWhitelistState = registry
            .whitelistState(collToken);
        if (compartmentImpl == address(0)) {
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
                !registry.isWhitelistedCompartment(compartmentImpl, collToken)
            ) {
                revert Errors.InvalidCompartmentForToken();
            }
        }
    }

    function _hashOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }
}
