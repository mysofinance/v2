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
    address public redeemer;
    mapping(address => mapping(uint256 => bool)) public stuckTokens;
    bool internal _mutex;

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
                ++i;
            }
        }
        _tokenName = _name;
        _tokenSymbol = _symbol;
        _mint(minter, 1);
    }

    function redeem(address account, address recipient) external nonReentrant {
        // mutex is used to prevent entrancy into the sweepTokensLeftAfterRedeem function
        // in case the redeemer/recipient is one of the NFTs being transferred
        _mutex = true;
        if (msg.sender != account) {
            _spendAllowance(account, msg.sender, 1);
        }
        _burn(account, 1);
        redeemer = account;
        uint256 tokensLength = _wrappedTokens.length;
        address tokenAddr;
        uint256 tokenId;
        uint256 idsLength;
        for (uint256 i = 0; i < tokensLength; ) {
            idsLength = _wrappedTokens[i].tokenIds.length;
            tokenAddr = _wrappedTokens[i].tokenAddr;
            for (uint256 j = 0; j < idsLength; ) {
                tokenId = _wrappedTokens[i].tokenIds[j];
                try
                    IERC721(tokenAddr).transferFrom(
                        address(this),
                        recipient,
                        tokenId
                    )
                // solhint-disable-next-line no-empty-blocks
                {

                } catch {
                    stuckTokens[tokenAddr][tokenId] = true;
                    emit TransferFromWrappedTokenFailed(tokenAddr, tokenId);
                }
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
        _mutex = false;
        emit Redeemed(account, recipient);
    }

    function sweepTokensLeftAfterRedeem(
        address tokenAddr,
        uint256[] calldata tokenIds
    ) external nonReentrant {
        if (_mutex) {
            revert Errors.Reentrancy();
        }
        if (msg.sender != redeemer) {
            revert Errors.InvalidSender();
        }
        if (tokenIds.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        mapping(uint256 => bool) storage stuckTokenAddr = stuckTokens[
            tokenAddr
        ];
        for (uint256 i = 0; i < tokenIds.length; ) {
            // if not stuck, skip, else try to transfer
            if (stuckTokenAddr[tokenIds[i]]) {
                try
                    IERC721(tokenAddr).transferFrom(
                        address(this),
                        msg.sender,
                        tokenIds[i]
                    )
                {
                    delete stuckTokenAddr[tokenIds[i]];
                } catch {
                    emit TransferFromWrappedTokenFailed(tokenAddr, tokenIds[i]);
                }
            }
            unchecked {
                ++i;
            }
        }
        emit TokenSweepAttempted(tokenAddr, tokenIds);
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
