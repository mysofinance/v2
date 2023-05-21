// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Errors} from "../../../Errors.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenBasketWrapper} from "../../interfaces/wrappers/ERC20/ITokenBasketWrapper.sol";
import {ITokenBasketWrapperERC20Impl} from "../../interfaces/wrappers/ERC20/ITokenBasketWrapperERC20Impl.sol";

contract TokenBasketWrapper is ReentrancyGuard, ITokenBasketWrapper {
    using SafeERC20 for IERC20;
    address public immutable tokenBasketWrapperErc20Impl;
    IERC20[] public wrappedERC20Instances;

    constructor(address _tokenBasketWrapperErc20Impl) {
        if (_tokenBasketWrapperErc20Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        tokenBasketWrapperErc20Impl = _tokenBasketWrapperErc20Impl;
    }

    function createWrappedTokenBasket(
        address tokenOwner,
        address[] calldata tokenAddrs,
        uint256[] calldata tokenAmounts,
        uint256 minAmount,
        string calldata name,
        string calldata symbol
    ) external nonReentrant returns (address newErc20Addr) {
        bytes32 salt = keccak256(
            abi.encodePacked(wrappedERC20Instances.length)
        );
        newErc20Addr = Clones.cloneDeterministic(
            tokenBasketWrapperErc20Impl,
            salt
        );
        for (uint256 i = 0; i < tokenAddrs.length; i++) {
            IERC20(tokenAddrs[i]).safeTransferFrom(
                tokenOwner,
                newErc20Addr,
                tokenAmounts[i]
            );
            unchecked {
                i++;
            }
        }
        ITokenBasketWrapperERC20Impl(newErc20Addr).initialize(
            tokenOwner,
            tokenAddrs,
            minAmount,
            name,
            symbol
        );
        wrappedERC20Instances.push(IERC20(newErc20Addr));
    }
}
