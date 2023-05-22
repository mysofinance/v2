// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypesPeerToPeer} from "../../../peer-to-peer/DataTypesPeerToPeer.sol";
import {Errors} from "../../../Errors.sol";
import {IERC20Wrapper} from "../../interfaces/wrappers/ERC20/IERC20Wrapper.sol";
import {IWrappedERC20Impl} from "../../interfaces/wrappers/ERC20/IWrappedERC20Impl.sol";

/**
 * @dev ERC20Wrapper is a contract that wraps tokens from possibly multiple ERC20 contracts
 * IMPORTANT: This contract allows for whitelisting registered token addresses IF an address registry is provided.
 * This is to prevent the creation of wrapped tokens for non-registered tokens if that is a functionality that
 * is desired. If not, then the address registry can be set to the zero address.
 */
contract ERC20Wrapper is ReentrancyGuard, IERC20Wrapper {
    using SafeERC20 for IERC20;
    address public immutable addressRegistry;
    address public immutable wrappedErc20Impl;
    address[] public tokensCreated;

    constructor(address _addressRegistry, address _wrappedErc20Impl) {
        if (_wrappedErc20Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        wrappedErc20Impl = _wrappedErc20Impl;
    }

    // token addresses must be unique and passed in increasing order.
    // token amounts must be non-zero
    // minter must approve this contract to transfer all tokens to be wrapped.
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata tokensToBeWrapped,
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
        newErc20Addr = Clones.cloneDeterministic(wrappedErc20Impl, salt);
        uint160 prevTokenAddressCastToUint160;
        uint160 currAddressCastToUint160;
        uint256 minTokenAmount = type(uint256).max;
        for (uint256 i = 0; i < tokensToBeWrapped.length; ) {
            if (
                addressRegistry != address(0) &&
                !IAddressRegistry(addressRegistry).isWhitelistedERC20(
                    tokensToBeWrapped[i].tokenAddr
                )
            ) {
                revert Errors.NonWhitelistedToken();
            }
            currAddressCastToUint160 = uint160(tokensToBeWrapped[i].tokenAddr);
            if (currAddressCastToUint160 <= prevTokenAddressCastToUint160) {
                revert Errors.NonIncreasingTokenAddrs();
            }
            if (tokensToBeWrapped[i].tokenAmount == 0) {
                revert Errors.InvalidSendAmount();
            }
            minTokenAmount = minTokenAmount > tokensToBeWrapped[i].tokenAmount
                ? tokensToBeWrapped[i].tokenAmount
                : minTokenAmount;
            IERC20(tokensToBeWrapped[i].tokenAddr).safeTransferFrom(
                minter,
                newErc20Addr,
                tokensToBeWrapped[i].tokenAmount
            );
            prevTokenAddressCastToUint160 = currAddressCastToUint160;
            unchecked {
                i++;
            }
        }
        IWrappedERC20Impl(newErc20Addr).initialize(
            minter,
            tokensToBeWrapped,
            minTokenAmount,
            name,
            symbol
        );
        tokensCreated.push(newErc20Addr);
    }
}
