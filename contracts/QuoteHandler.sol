// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {DataTypes} from "./DataTypes.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";

contract QuoteHandler {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address addressRegistry;
    mapping(address => uint256) offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool)) offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;
    mapping(address => mapping(address => bool))
        public isActiveAutoQuoteStrategy;

    event OnChainQuoteAdded(
        address lenderVault,
        DataTypes.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash
    );

    event OnChainQuoteDeleted(address lenderVault, bytes32 onChainQuoteHash);
    event OnChainQuoteInvalidated(
        address lenderVault,
        bytes32 onChainQuoteHash
    );
    event OffChainQuoteInvalidated(
        address lenderVault,
        bytes32 offChainQuoteHash
    );

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidOnChainQuote(onChainQuote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.generalQuoteInfo.collToken,
                onChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidOnChainQuote(newOnChainQuote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                newOnChainQuote.generalQuoteInfo.collToken,
                newOnChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
        onChainQuoteHash = hashOnChainQuote(newOnChainQuote);
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, newOnChainQuote, onChainQuoteHash);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
    }

    /*
    function addAutoQuoteStrategy() external {}
    */

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        checkSenderAndGeneralQuoteInfo(
            borrower,
            lenderVault,
            onChainQuote.generalQuoteInfo
        );
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        if (onChainQuote.generalQuoteInfo.isSingleUse) {
            isOnChainQuote[lenderVault][onChainQuoteHash] = false;
            emit OnChainQuoteInvalidated(lenderVault, onChainQuoteHash);
        }
    }

    /*
    function doesVaultAcceptAutoQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.generalQuoteInfo.collToken,
                onChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.borrower != address(0) &&
            onChainQuote.generalQuoteInfo.borrower != borrower
        ) {
            return false;
        }
        return false;
    }*/

    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external {
        checkSenderAndGeneralQuoteInfo(
            borrower,
            lenderVault,
            offChainQuote.generalQuoteInfo
        );
        if (offChainQuote.nonce > offChainQuoteNonce[lenderVault]) {
            revert();
        }
        if (offChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            revert();
        }
        bytes32 offChainQuoteHash = hashOffChainQuote(offChainQuote);
        if (offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash]) {
            revert();
        }
        if (
            !areValidSignatures(
                lenderVault,
                offChainQuoteHash,
                offChainQuote.v,
                offChainQuote.r,
                offChainQuote.s
            )
        ) {
            revert();
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
            revert();
        }
        if (offChainQuote.generalQuoteInfo.isSingleUse) {
            offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
            emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
        }
    }

    function areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) internal view returns (bool) {
        if (
            v.length != r.length &&
            v.length != s.length &&
            v.length != ILenderVault(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        uint256 tmp;
        address recoveredSigner;
        uint256 newHash;
        for (uint256 i = 0; i < v.length; ) {
            recoveredSigner = ecrecover(messageHash, v[i], r[i], s[i]);
            // use hash instead of address to spread out over 256 bits and reduce false positives
            newHash = uint256(keccak256(abi.encode(recoveredSigner)));
            if (tmp == tmp | newHash) {
                return false;
            }

            if (!ILenderVault(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            tmp |= newHash;
            unchecked {
                i++;
            }
        }
        return true;
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteNonce[lenderVault] += 1;
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
        emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
    }

    function hashOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }

    function hashOffChainQuote(
        DataTypes.OffChainQuote memory offChainQuote
    ) internal view returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                offChainQuote.generalQuoteInfo,
                offChainQuote.quoteTuplesRoot,
                offChainQuote.salt,
                offChainQuote.nonce,
                block.chainid
            )
        );
    }

    function checkSenderAndGeneralQuoteInfo(
        address borrower,
        address lenderVault,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo
    ) internal {
        address _addressRegistry = addressRegistry;
        if (
            msg.sender != IAddressRegistry(_addressRegistry).borrowerGateway()
        ) {
            revert();
        }
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert();
        }
        if (
            !IAddressRegistry(_addressRegistry).isWhitelistedTokenPair(
                generalQuoteInfo.collToken,
                generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        if (
            generalQuoteInfo.borrower != address(0) &&
            generalQuoteInfo.borrower != borrower
        ) {
            revert();
        }
    }

    function isValidOnChainQuote(
        DataTypes.OnChainQuote calldata /*onChainQuote*/
    ) internal view returns (bool) {
        return true;
        /*
        console.log("PASS 1");
        if (quote.collToken == quote.loanToken) {
            return false;
        }
        console.log("PASS 2");
        console.log("PASS 3");
        if (
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.tenor.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.interestRatePctInBase.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.upfrontFeePctInBase.length
        ) {
            return false;
        }
        console.log("PASS 4");
        console.log("PASS 5");
        if (quote.validUntil < block.timestamp) {
            return false;
        }
        console.log("PASS 6");
        for (
            uint256 k = 0;
            k < quote.quoteTuples.loanPerCollUnitOrLtv.length;

        ) {
            if (quote.quoteTuples.upfrontFeePctInBase[k] > BASE) {
                return false;
            }
            console.log("PASS 7");
            if (
                quote.oracleAddr != address(0) &&
                quote.quoteTuples.loanPerCollUnitOrLtv[k] >= BASE
            ) {
                return false;
            }
            console.log("PASS 8");
            if (
                quote.quoteTuples.isNegativeInterestRate &&
                quote.quoteTuples.interestRatePctInBase[k] > BASE
            ) {
                return false;
            }
            console.log("PASS 9");
            unchecked {
                k++;
            }
        }
        return true;
        */
    }
}
