// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
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
    uint8 internal _tokenDecimals;
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
        uint8 _decimals,
        bool _isIOU
    ) external initializer {
        for (uint256 i; i < wrappedTokens.length; ) {
            _wrappedTokens.push(wrappedTokens[i]);
            unchecked {
                ++i;
            }
        }
        _tokenName = _name;
        _tokenSymbol = _symbol;
        _tokenDecimals = _decimals;
        isIOU = _isIOU;
        _mint(
            minter,
            totalInitialSupply < 10 ** 6 || wrappedTokens.length == 1
                ? totalInitialSupply
                : 10 ** 6
        );
    }

    function redeem(
        address account,
        address recipient,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0) {
            revert Errors.InvalidAmount();
        }
        if (recipient == address(0)) {
            revert Errors.InvalidAddress();
        }
        uint256 currTotalSupply = totalSupply();
        if (msg.sender != account) {
            _spendAllowance(account, msg.sender, amount);
        }
        _burn(account, amount);
        if (!isIOU) {
            for (uint256 i; i < _wrappedTokens.length; ) {
                address tokenAddr = _wrappedTokens[i].tokenAddr;
                // @dev: this is not caught and will revert if the even one token has wrapper blacklisted
                // therefore minters in this wrapper need to weigh the risk of this happening and hence tokens
                // getting permanently stuck in the wrapper
                IERC20(tokenAddr).safeTransfer(
                    recipient,
                    Math.mulDiv(
                        IERC20(tokenAddr).balanceOf(address(this)),
                        amount,
                        currTotalSupply
                    )
                );
                unchecked {
                    ++i;
                }
            }
        }
        emit Redeemed(account, recipient, amount);
    }

    function mint(
        address recipient,
        uint256 amount,
        uint256 expectedTransferFee
    ) external nonReentrant {
        if (_wrappedTokens.length != 1) {
            revert Errors.OnlyMintFromSingleTokenWrapper();
        }
        if (amount == 0) {
            revert Errors.InvalidAmount();
        }
        if (recipient == address(0)) {
            revert Errors.InvalidAddress();
        }
        uint256 currTotalSupply = totalSupply();
        address tokenAddr = _wrappedTokens[0].tokenAddr;
        uint256 tokenPreBal = IERC20(tokenAddr).balanceOf(address(this));
        if (currTotalSupply > 0 && tokenPreBal == 0) {
            // @dev: this would have been some sort of error or negative rebase down to 0 balance with outstanding supply
            // in which case to not allow possibly diluted or unfair proportions for new minters, will revert
            revert Errors.NonMintableTokenState();
        }
        currTotalSupply == 0
            ? _mint(recipient, amount)
            : _mint(
                recipient,
                Math.mulDiv(amount, currTotalSupply, tokenPreBal)
            );
        IERC20(tokenAddr).transferFrom(
            msg.sender,
            address(this),
            amount + expectedTransferFee
        );
        uint256 tokenPostBal = IERC20(tokenAddr).balanceOf(address(this));
        if (tokenPostBal != tokenPreBal + amount) {
            revert Errors.InvalidSendAmount();
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
        return _tokenDecimals;
    }
}
