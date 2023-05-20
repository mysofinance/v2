// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Errors} from "../../../Errors.sol";
import {IAddressRegistry} from "../../interfaces/IAddressRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {INftWrapper} from "../../interfaces/wrappers/ERC721/INftWrapper.sol";
import {IWrappedNftErc20Impl} from "../../interfaces/wrappers/ERC721/IWrappedNftErc20Impl.sol";

contract AddressRegistry is ReentrancyGuard, INftWrapper {
    address public immutable addressRegistry;
    IERC20 public immutable wrappedNftErc20Impl;
    IERC20[] public wrappedERC20Instances;

    constructor(address _addressRegistry, address _wrappedErc20Impl) {
        if (_addressRegistry == address(0) || _wrappedErc20Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        wrappedNftErc20Impl = IERC20(_wrappedErc20Impl);
    }

    function createWrappedNftToken(
        address tokenOwner,
        DataTypesPeerToPeer.NftAddressAndIds[] calldata tokenInfo,
        string calldata name,
        string calldata symbol
    ) external nonReentrant returns (address newErc20Addr) {
        if (msg.sender != addressRegistry) {
            revert Errors.InvalidSender();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(wrappedERC20Instances.length)
        );
        newErc20Addr = Clones.cloneDeterministic(
            address(wrappedNftErc20Impl),
            salt
        );
        for (uint256 i = 0; i < tokenInfo.length; i++) {
            for (uint256 j = 0; j < tokenInfo[i].nftIds.length; j++) {
                try
                    IERC721(tokenInfo[i].nftAddress).safeTransferFrom(
                        tokenOwner,
                        newErc20Addr,
                        tokenInfo[i].nftIds[j]
                    )
                {
                    unchecked {
                        j++;
                    }
                } catch {
                    revert Errors.NftTransferToWrapperFailed();
                }
            }
            unchecked {
                i++;
            }
        }
        IWrappedNftErc20Impl(newErc20Addr).initialize(
            tokenOwner,
            tokenInfo,
            name,
            symbol
        );
        wrappedERC20Instances.push(IERC20(newErc20Addr));
    }
}
