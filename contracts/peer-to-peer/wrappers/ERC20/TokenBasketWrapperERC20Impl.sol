// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../../../Errors.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenBasketWrapperERC20Impl} from "../../interfaces/wrappers/ERC20/ITokenBasketWrapperERC20Impl.sol";

contract TokenBasketWrapperERC20Impl is
    ERC20,
    Initializable,
    ReentrancyGuard,
    ITokenBasketWrapperERC20Impl
{
    using SafeERC20 for IERC20;

    string internal tokenName;
    string internal tokenSymbol;
    address[] internal tokenAddrs;

    constructor()
        ERC20("TokenBasketERC20MysoImpl", "TokenBasketERC20MysoImpl")
    {
        _disableInitializers();
    }

    function initialize(
        address minter,
        address[] calldata _tokenAddrs,
        uint256 totalInitialSupply,
        string calldata _name,
        string calldata _symbol
    ) external initializer {
        tokenAddrs = _tokenAddrs;
        tokenName = _name;
        tokenSymbol = _symbol;
        _mint(
            minter,
            totalInitialSupply < 10 ** 6 ? totalInitialSupply : 10 ** 6
        );
    }

    function redeem(uint256 amount) external nonReentrant {
        // faster fail here than in burn
        if (balanceOf(msg.sender) < 0) {
            revert Errors.InvalidSender();
        }
        uint256 currTotalSupply = totalSupply();
        for (uint256 i = 0; i < tokenAddrs.length; i++) {
            IERC20(tokenAddrs[i]).safeTransfer(
                msg.sender,
                (IERC20(tokenAddrs[i]).balanceOf(address(this)) * amount) /
                    currTotalSupply
            );
            unchecked {
                i++;
            }
        }
        _burn(msg.sender, amount);
    }

    function getAllTokenAddrs() external view returns (address[] memory) {
        return tokenAddrs;
    }

    function name() public view virtual override returns (string memory) {
        return tokenName;
    }

    function symbol() public view virtual override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
