// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Errors} from "../../../Errors.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IWrappedNftERC20Impl} from "../../interfaces/wrappers/ERC721/IWrappedNftERC20Impl.sol";

contract WrappedNftERC20Impl is
    ERC20,
    Initializable,
    ReentrancyGuard,
    IWrappedNftERC20Impl
{
    string internal tokenName;
    string internal tokenSymbol;
    address[] internal nftAddresses;
    mapping(address => uint256[]) public nftIds;

    constructor() ERC20("NFT-ERC20MysoImpl", "NFT-ERC20MysoImpl") {
        _disableInitializers();
    }

    function initialize(
        address tokenOwner,
        DataTypesPeerToPeer.NftAddressAndIds[] calldata _tokenInfo,
        string calldata _name,
        string calldata _symbol
    ) external initializer {
        for (uint256 i = 0; i < _tokenInfo.length; ) {
            nftAddresses.push(_tokenInfo[i].nftAddress);
            nftIds[_tokenInfo[i].nftAddress] = _tokenInfo[i].nftIds;
            unchecked {
                i++;
            }
        }
        tokenName = _name;
        tokenSymbol = _symbol;
        _mint(tokenOwner, 1);
    }

    function redeem() external nonReentrant {
        if (balanceOf(msg.sender) == 0) {
            revert Errors.InvalidSender();
        }
        address currNftAddress;
        for (uint256 i = 0; i < nftAddresses.length; i++) {
            currNftAddress = nftAddresses[i];
            for (uint256 j = 0; j < nftIds[currNftAddress].length; j++) {
                try
                    IERC721(currNftAddress).safeTransferFrom(
                        address(this),
                        msg.sender,
                        nftIds[currNftAddress][j]
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
        _burn(msg.sender, 1);
    }

    function getAllTokenAddrs() external view returns (address[] memory) {
        return nftAddresses;
    }

    function name() public view virtual override returns (string memory) {
        return tokenName;
    }

    function symbol() public view virtual override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view virtual override returns (uint8) {
        return 0;
    }
}
