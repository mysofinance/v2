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
    address public lastRedeemer;
    mapping(address => mapping(uint256 => bool)) public stuckTokens;
    mapping(address => mapping(uint256 => bool)) public isTokenInWrapper;
    uint128[2] public totalAndCurrentNumOfTokensInWrapper;
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
        uint128 numTokens;
        for (uint256 i = 0; i < wrappedTokens.length; ) {
            _wrappedTokens.push(wrappedTokens[i]);
            for (uint256 j = 0; j < wrappedTokens[i].tokenIds.length; ) {
                mapping(uint256 => bool) storage isTokenAddr = isTokenInWrapper[
                    wrappedTokens[i].tokenAddr
                ];
                isTokenAddr[wrappedTokens[i].tokenIds[j]] = true;
                ++numTokens;
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
        _tokenName = _name;
        _tokenSymbol = _symbol;
        totalAndCurrentNumOfTokensInWrapper = [numTokens, numTokens];
        _mint(minter, 1);
    }

    function redeem(address account, address recipient) external nonReentrant {
        // mutex is used to prevent entrancy into the sweepTokensLeftAfterRedeem function
        // in case the redeemer/recipient is one of the NFTs being transferred
        _mutex = true;
        if (recipient == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (msg.sender != account) {
            _spendAllowance(account, msg.sender, 1);
        }
        _burn(account, 1);
        lastRedeemer = account;
        address tokenAddr;
        uint256 tokenId;
        uint128 tokensRemoved;
        for (uint256 i; i < _wrappedTokens.length; ) {
            tokenAddr = _wrappedTokens[i].tokenAddr;
            for (uint256 j; j < _wrappedTokens[i].tokenIds.length; ) {
                tokenId = _wrappedTokens[i].tokenIds[j];
                try
                    IERC721(tokenAddr).safeTransferFrom(
                        address(this),
                        recipient,
                        tokenId
                    )
                {
                    ++tokensRemoved;
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
        unchecked {
            totalAndCurrentNumOfTokensInWrapper[1] -= tokensRemoved;
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
        if (msg.sender != lastRedeemer) {
            revert Errors.InvalidSender();
        }
        if (tokenIds.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        mapping(uint256 => bool) storage stuckTokenAddr = stuckTokens[
            tokenAddr
        ];
        uint128 tokensRemoved;
        for (uint256 i; i < tokenIds.length; ) {
            if (!stuckTokenAddr[tokenIds[i]]) {
                revert Errors.TokenNotStuck();
            }
            try
                IERC721(tokenAddr).safeTransferFrom(
                    address(this),
                    msg.sender,
                    tokenIds[i]
                )
            {
                delete stuckTokenAddr[tokenIds[i]];
                ++tokensRemoved;
            } catch {
                emit TransferFromWrappedTokenFailed(tokenAddr, tokenIds[i]);
            }
            unchecked {
                ++i;
            }
        }
        unchecked {
            totalAndCurrentNumOfTokensInWrapper[1] -= tokensRemoved;
        }
        emit TokenSweepAttempted(tokenAddr, tokenIds);
    }

    function remintERC20Token(
        DataTypesPeerToPeer.WrappedERC721TokenInfo[]
            calldata _wrappedTokensForRemint,
        address recipient
    ) external nonReentrant {
        if (_mutex) {
            revert Errors.Reentrancy();
        }
        uint256 wrappedTokensForRemintLen = _wrappedTokensForRemint.length;
        if (wrappedTokensForRemintLen == 0) {
            revert Errors.InvalidArrayLength();
        }
        if (recipient == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (totalSupply() != 0) {
            revert Errors.CannotRemintUnlessZeroSupply();
        }
        // whoever remints must be able to transfer all the tokens to be reminted (all non-stuck tokens) back
        // to this contract. If even one transfer fails, then the remint fails.
        uint128 tokensNeeded = totalAndCurrentNumOfTokensInWrapper[0] -
            totalAndCurrentNumOfTokensInWrapper[1];
        totalAndCurrentNumOfTokensInWrapper[
            1
        ] = totalAndCurrentNumOfTokensInWrapper[0];
        _mint(recipient, 1);
        uint128 tokensAdded = _transferTokens(
            wrappedTokensForRemintLen,
            _wrappedTokensForRemint
        );
        if (tokensAdded != tokensNeeded) {
            revert Errors.TokensStillMissingFromWrapper();
        }
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

    function _transferTokens(
        uint256 numTokensToBeWrapped,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped
    ) internal returns (uint128 numTokensAdded) {
        address prevNftAddress;
        address currNftAddress;
        uint256 checkedId;
        for (uint256 i; i < numTokensToBeWrapped; ) {
            uint256 numTokenIds = tokensToBeWrapped[i].tokenIds.length;
            if (numTokenIds == 0) {
                revert Errors.InvalidArrayLength();
            }
            currNftAddress = tokensToBeWrapped[i].tokenAddr;
            if (currNftAddress <= prevNftAddress) {
                revert Errors.NonIncreasingTokenAddrs();
            }
            for (uint256 j; j < numTokenIds; ) {
                if (tokensToBeWrapped[i].tokenIds[j] <= checkedId && j != 0) {
                    revert Errors.NonIncreasingNonFungibleTokenIds();
                }
                checkedId = tokensToBeWrapped[i].tokenIds[j];
                if (!isTokenInWrapper[currNftAddress][checkedId]) {
                    revert Errors.TokenDoesNotBelongInWrapper(
                        currNftAddress,
                        checkedId
                    );
                }
                try
                    IERC721(tokensToBeWrapped[i].tokenAddr).transferFrom(
                        msg.sender,
                        address(this),
                        checkedId
                    )
                {
                    unchecked {
                        ++numTokensAdded;
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
