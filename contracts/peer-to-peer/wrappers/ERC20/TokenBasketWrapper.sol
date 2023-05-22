// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {DataTypesPeerToPeer} from "../../../peer-to-peer/DataTypesPeerToPeer.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Errors} from "../../../Errors.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenBasketWrapper} from "../../interfaces/wrappers/ERC20/ITokenBasketWrapper.sol";
import {ITokenBasketWrapperERC20Impl} from "../../interfaces/wrappers/ERC20/ITokenBasketWrapperERC20Impl.sol";

/**
 * @dev TokenBasketWrapper is a contract that wraps tokens from possibly multiple ERC20 contracts
 * IMPORTANT: This contract allows for whitelisting registered token addresses IF an address registry is provided.
 * This is to prevent the creation of wrapped tokens for non-registered tokens if that is a functionality that
 * is desired. If not, then the address registry can be set to the zero address.
 */
contract TokenBasketWrapper is ReentrancyGuard, ITokenBasketWrapper {
    using SafeERC20 for IERC20;
    address public immutable addressRegistry;
    address public immutable tokenBasketWrapperErc20Impl;
    IERC20[] public wrappedERC20Instances;

    constructor(
        address _addressRegistry,
        address _tokenBasketWrapperErc20Impl
    ) {
        if (_tokenBasketWrapperErc20Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        tokenBasketWrapperErc20Impl = _tokenBasketWrapperErc20Impl;
    }

    // token addresses must be unique and passed in increasing order.
    // token amounts must be non-zero
    // minter must approve this contract to transfer all tokens to be wrapped.
    function createWrappedTokenBasket(
        address minter,
        DataTypesPeerToPeer.TokenBasketWrapperInfo calldata tokenInfo
    ) external nonReentrant returns (address newErc20Addr) {
        if (minter == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (
            tokenInfo.tokenAddrs.length == 0 ||
            tokenInfo.tokenAddrs.length != tokenInfo.tokenAmounts.length
        ) {
            revert Errors.InvalidArrayLength();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(wrappedERC20Instances.length)
        );
        newErc20Addr = Clones.cloneDeterministic(
            tokenBasketWrapperErc20Impl,
            salt
        );
        uint160 prevTokenAddressCastToUint160;
        uint160 currAddressCastToUint160;
        uint256 minTokenAmount = type(uint256).max;
        for (uint256 i = 0; i < tokenInfo.tokenAddrs.length; i++) {
            if (
                addressRegistry != address(0) &&
                !IAddressRegistry(addressRegistry).isWhitelistedToken(
                    tokenInfo.tokenAddrs[i]
                )
            ) {
                revert Errors.NonWhitelistedToken();
            }
            currAddressCastToUint160 = uint160(tokenInfo.tokenAddrs[i]);
            if (currAddressCastToUint160 <= prevTokenAddressCastToUint160) {
                revert Errors.NonIncreasingTokenAddrs();
            }
            if (tokenInfo.tokenAmounts[i] == 0) {
                revert Errors.InvalidSendAmount();
            }
            if (minTokenAmount > tokenInfo.tokenAmounts[i]) {
                minTokenAmount = tokenInfo.tokenAmounts[i];
            }
            IERC20(tokenInfo.tokenAddrs[i]).safeTransferFrom(
                minter,
                newErc20Addr,
                tokenInfo.tokenAmounts[i]
            );
            prevTokenAddressCastToUint160 = currAddressCastToUint160;
            unchecked {
                i++;
            }
        }
        ITokenBasketWrapperERC20Impl(newErc20Addr).initialize(
            minter,
            tokenInfo.tokenAddrs,
            minTokenAmount,
            tokenInfo.name,
            tokenInfo.symbol
        );
        wrappedERC20Instances.push(IERC20(newErc20Addr));
    }
}
