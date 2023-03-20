# Ownable









## Methods

### claimOwnership

```solidity
function claimOwnership() external nonpayable
```






### owner

```solidity
function owner() external view returns (address)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### proposeNewOwner

```solidity
function proposeNewOwner(address _newOwnerProposal) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _newOwnerProposal | address | undefined |



## Events

### ClaimedOwnership

```solidity
event ClaimedOwnership(address indexed owner, address oldOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| oldOwner  | address | undefined |

### NewOwnerProposed

```solidity
event NewOwnerProposed(address indexed owner, address newOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| newOwner  | address | undefined |



## Errors

### InvalidSender

```solidity
error InvalidSender()
```







