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
    address[] public _tokensCreated;

    constructor(address _addressRegistry, address _wrappedErc721Impl) {
        if (
            _addressRegistry == address(0) || _wrappedErc721Impl == address(0)
        ) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        wrappedErc721Impl = _wrappedErc721Impl;
    }

    // token ids must be unique and passed in increasing order for each token address.
    // minter must approve this contract to transfer all tokens to be wrapped.
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external nonReentrant returns (address newErc20Addr) {
        if (msg.sender != addressRegistry) {
            revert Errors.InvalidSender();
        }
        if (minter == address(0) || minter == address(this)) {
            revert Errors.InvalidAddress();
        }
        uint256 numTokensToBeWrapped = tokensToBeWrapped.length;
        if (numTokensToBeWrapped == 0) {
            revert Errors.InvalidArrayLength();
        }
        newErc20Addr = Clones.clone(wrappedErc721Impl);
        _tokensCreated.push(newErc20Addr);

        IWrappedERC721Impl(newErc20Addr).initialize(
            minter,
            tokensToBeWrapped,
            name,
            symbol
        );

        _transferTokens(
            minter,
            numTokensToBeWrapped,
            tokensToBeWrapped,
            newErc20Addr
        );
        emit ERC721WrapperCreated(
            newErc20Addr,
            minter,
            _tokensCreated.length,
            tokensToBeWrapped
        );
    }

    function tokensCreated() external view returns (address[] memory) {
        return _tokensCreated;
    }

    function numTokensCreated() external view returns (uint256) {
        return _tokensCreated.length;
    }

    function _transferTokens(
        address minter,
        uint256 numTokensToBeWrapped,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        address newErc20Addr
    ) internal {
        address prevNftAddress;
        address currNftAddress;
        uint256 checkedId;
        for (uint256 i = 0; i < numTokensToBeWrapped; ) {
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
            currNftAddress = tokensToBeWrapped[i].tokenAddr;
            if (currNftAddress <= prevNftAddress) {
                revert Errors.NonIncreasingTokenAddrs();
            }
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
                        ++j;
                    }
                } catch {
                    revert Errors.TransferToWrappedTokenFailed();
                }
            }
            prevNftAddress = currNftAddress;
            unchecked {
                ++i;
            }
        }
    }
}
