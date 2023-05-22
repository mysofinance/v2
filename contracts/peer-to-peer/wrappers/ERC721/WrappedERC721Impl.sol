// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {Errors} from "../../../Errors.sol";
import {IWrappedERC721Impl} from "../../interfaces/wrappers/ERC721/IWrappedERC721Impl.sol";

contract WrappedERC721Impl is
    ERC20,
    Initializable,
    ReentrancyGuard,
    IWrappedERC721Impl
{
    string internal _tokenName;
    string internal _tokenSymbol;
    DataTypesPeerToPeer.WrappedERC721TokenInfo[] internal _wrappedTokens;

    constructor() ERC20("Wrapped ERC721 Impl", "Wrapped ERC721 Impl") {
        _disableInitializers();
    }

    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata wrappedTokens,
        string calldata _name,
        string calldata _symbol
    ) external initializer {
        for (uint256 i = 0; i < wrappedTokens.length; ) {
            _wrappedTokens.push(wrappedTokens[i]);
            unchecked {
                i++;
            }
        }
        _tokenName = _name;
        _tokenSymbol = _symbol;
        _mint(minter, 1);
    }

    function redeem() external nonReentrant {
        if (balanceOf(msg.sender) != 1) {
            revert Errors.InvalidSender();
        }
        for (uint256 i = 0; i < _wrappedTokens.length; ) {
            for (uint256 j = 0; j < _wrappedTokens[i].tokenIds.length; ) {
                try
                    IERC721(_wrappedTokens[i].tokenAddr).transferFrom(
                        address(this),
                        msg.sender,
                        _wrappedTokens[i].tokenIds[j]
                    )
                {
                    unchecked {
                        j++;
                    }
                } catch {
                    revert Errors.TransferFromWrappedTokenFailed();
                }
            }
            unchecked {
                i++;
            }
        }
        _burn(msg.sender, 1);
    }

    function getWrappedTokensInfo()
        external
        view
        returns (DataTypesPeerToPeer.WrappedERC721TokenInfo[] memory)
    {
        return _wrappedTokens;
    }

    function name() public view virtual override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view virtual override returns (string memory) {
        return _tokenSymbol;
    }

    function decimals() public view virtual override returns (uint8) {
        return 0;
    }
}
