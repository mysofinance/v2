# VoteCompartment









## Methods

### delegate

```solidity
function delegate(address _delegatee) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _delegatee | address | undefined |

### initialize

```solidity
function initialize(address _vaultAddr, uint256 _loanIdx) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _vaultAddr | address | undefined |
| _loanIdx | uint256 | undefined |

### loanIdx

```solidity
function loanIdx() external view returns (uint256)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

### transferCollFromCompartment

```solidity
function transferCollFromCompartment(uint256 repayAmount, uint256 repayAmountLeft, address borrowerAddr, address collTokenAddr, address callbackAddr) external nonpayable
```

function to transfer some amount of collateral to borrower on repay

*this function can only be called by vault and tranfers proportional amount of compartment collTokenBalance to borrower address. This needs use a proportion and not the amount to account for possible changes due to rewards accruing*

#### Parameters

| Name | Type | Description |
|---|---|---|
| repayAmount | uint256 | amount of loan token being sent to vault |
| repayAmountLeft | uint256 | amount of loan token still outstanding |
| borrowerAddr | address | address of borrower receiving transfer |
| collTokenAddr | address | address of collateral token being transferred |
| callbackAddr | address | address to send collateral to instead of borrower if using callback |

### unlockCollToVault

```solidity
function unlockCollToVault(address collTokenAddr) external nonpayable
```

function to unlock all collateral left in compartment

*this function can only be called by vault and returns all collateral to vault*

#### Parameters

| Name | Type | Description |
|---|---|---|
| collTokenAddr | address | pass in collToken addr to avoid callback reads gas cost |

### vaultAddr

```solidity
function vaultAddr() external view returns (address)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |



## Events

### Initialized

```solidity
event Initialized(uint8 version)
```



*Triggered when the contract has been initialized or reinitialized.*

#### Parameters

| Name | Type | Description |
|---|---|---|
| version  | uint8 | undefined |



## Errors

### InvalidDelegatee

```solidity
error InvalidDelegatee()
```






### InvalidSender

```solidity
error InvalidSender()
```






### WithdrawEntered

```solidity
error WithdrawEntered()
```







