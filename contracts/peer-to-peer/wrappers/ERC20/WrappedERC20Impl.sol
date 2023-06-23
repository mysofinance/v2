// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";
import {Errors} from "../../../Errors.sol";
import {IWrappedERC20Impl} from "../../interfaces/wrappers/ERC20/IWrappedERC20Impl.sol";

contract WrappedERC20Impl is
    ERC20,
    Initializable,
    ReentrancyGuard,
    IWrappedERC20Impl
{
    using SafeERC20 for IERC20;

    string internal _tokenName;
    string internal _tokenSymbol;
    DataTypesPeerToPeer.WrappedERC20TokenInfo[] internal _wrappedTokens;
    bool public isIOU;

    constructor() ERC20("Wrapped ERC20 Impl", "Wrapped ERC20 Impl") {
        _disableInitializers();
    }

    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata wrappedTokens,
        uint256 totalInitialSupply,
        string calldata _name,
        string calldata _symbol,
        bool _isIOU
    ) external initializer {
        for (uint256 i = 0; i < wrappedTokens.length; ) {
            _wrappedTokens.push(wrappedTokens[i]);
            unchecked {
                i++;
            }
        }
        _tokenName = _name;
        _tokenSymbol = _symbol;
        isIOU = _isIOU;
        _mint(
            minter,
            totalInitialSupply < 10 ** 6 ? totalInitialSupply : 10 ** 6
        );
    }

    function redeem(
        address account,
        address recipient,
        uint256 amount
    ) external nonReentrant {
        if (isIOU) {
            revert Errors.IOUCannotBeRedeemedOnChain();
        }
        if (amount == 0) {
            revert Errors.InvalidAmount();
        }
        uint256 currTotalSupply = totalSupply();
        if (msg.sender != account) {
            _spendAllowance(account, msg.sender, amount);
        }
        _burn(account, amount);
        for (uint256 i = 0; i < _wrappedTokens.length; ) {
            address tokenAddr = _wrappedTokens[i].tokenAddr;
            IERC20(tokenAddr).safeTransfer(
                recipient,
                (IERC20(tokenAddr).balanceOf(address(this)) * amount) /
                    currTotalSupply
            );
            unchecked {
                i++;
            }
        }
    }

    function getWrappedTokensInfo()
        external
        view
        returns (DataTypesPeerToPeer.WrappedERC20TokenInfo[] memory)
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
        return 6;
    }
}
