// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {Errors} from "../../../Errors.sol";
import {IERC721Wrapper} from "../../interfaces/wrappers/ERC721/IERC721Wrapper.sol";
import {IWrappedERC721Impl} from "../../interfaces/wrappers/ERC721/IWrappedERC721Impl.sol";

/**
 * @dev ERC721Wrapper is a contract that wraps tokens from possibly multiple contracts and ids
 * IMPORTANT: This contract allows for whitelisting registered token addresses IF an address registry is provided.
 * This is to prevent the creation of wrapped tokens for non-registered tokens if that is a functionality that
 * is desired. If not, then the address registry can be set to the zero address.
 */
contract ERC721Wrapper is ReentrancyGuard, IERC721Wrapper {
    address public immutable addressRegistry;
    address public immutable wrappedErc721Impl;
    address[] public tokensCreated;

    constructor(address _addressRegistry, address _wrappedErc721Impl) {
        if (_wrappedErc721Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        wrappedErc721Impl = _wrappedErc721Impl;
    }

    // token addresses must be unique and passed in increasing order.
    // token ids must be unique and passed in increasing order for each token address.
    // minter must approve this contract to transfer all tokens to be wrapped.
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external nonReentrant returns (address newErc20Addr) {
        if (minter == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (tokensToBeWrapped.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        bytes32 salt = keccak256(abi.encodePacked(tokensCreated.length));
        newErc20Addr = Clones.cloneDeterministic(wrappedErc721Impl, salt);
        uint160 prevNftAddressCastToUint160;
        uint160 nftAddressCastToUint160;
        uint256 checkedId;
        for (uint256 i = 0; i < tokensToBeWrapped.length; ) {
            if (tokensToBeWrapped[i].tokenIds.length == 0) {
                revert Errors.InvalidArrayLength();
            }
            if (
                addressRegistry != address(0) &&
                IAddressRegistry(addressRegistry).whitelistState(
                    tokensToBeWrapped[i].tokenAddr
                ) !=
                DataTypesPeerToPeer.WhitelistState.ERC721_TOKEN
            ) {
                revert Errors.NonWhitelistedToken();
            }
            nftAddressCastToUint160 = uint160(tokensToBeWrapped[i].tokenAddr);
            if (nftAddressCastToUint160 <= prevNftAddressCastToUint160) {
                revert Errors.NonIncreasingTokenAddrs();
            }
            checkedId = 0;
            for (uint256 j = 0; j < tokensToBeWrapped[i].tokenIds.length; ) {
                if (tokensToBeWrapped[i].tokenIds[j] <= checkedId && j != 0) {
                    revert Errors.NonIncreasingNonFungibleTokenIds();
                }
                checkedId = tokensToBeWrapped[i].tokenIds[j];
                try
                    IERC721(tokensToBeWrapped[i].tokenAddr).transferFrom(
                        minter,
                        newErc20Addr,
                        checkedId
                    )
                {
                    unchecked {
                        j++;
                    }
                } catch {
                    revert Errors.TransferToWrappedTokenFailed();
                }
            }
            prevNftAddressCastToUint160 = nftAddressCastToUint160;
            unchecked {
                i++;
            }
        }
        IWrappedERC721Impl(newErc20Addr).initialize(
            minter,
            tokensToBeWrapped,
            name,
            symbol
        );
        tokensCreated.push(newErc20Addr);
    }
}
