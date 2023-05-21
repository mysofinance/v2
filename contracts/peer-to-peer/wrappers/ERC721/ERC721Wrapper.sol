// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Errors} from "../../../Errors.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Wrapper} from "../../interfaces/wrappers/ERC721/IERC721Wrapper.sol";
import {IWrappedERC721Impl} from "../../interfaces/wrappers/ERC721/IWrappedERC721Impl.sol";

contract ERC721Wrapper is ReentrancyGuard, IERC721Wrapper {
    address public immutable addressRegistry;
    address public immutable wrappedNftErc20Impl;
    address[] public wrappedERC20Instances;

    constructor(address _addressRegistry, address _wrappedErc20Impl) {
        if (_addressRegistry == address(0) || _wrappedErc20Impl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        wrappedNftErc20Impl = _wrappedErc20Impl;
    }

    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
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
        for (uint256 i = 0; i < tokensToBeWrapped.length; ) {
            for (uint256 j = 0; j < tokensToBeWrapped[i].tokenIds.length; ) {
                try
                    IERC721(tokensToBeWrapped[i].tokenAddr).safeTransferFrom(
                        minter,
                        newErc20Addr,
                        tokensToBeWrapped[i].tokenIds[j]
                    )
                {
                    unchecked {
                        j++;
                    }
                } catch {
                    revert Errors.TransferToWrappedTokenFailed();
                }
            }
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
        wrappedERC20Instances.push(newErc20Addr);
    }
}
