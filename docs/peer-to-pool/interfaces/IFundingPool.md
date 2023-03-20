# IFundingPool









## Methods

### balanceOf

```solidity
function balanceOf(address) external view returns (uint256)
```

function returns balance deposited into pool note: balance is tracked only through using deposit function direct transfers into pool are not credited



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

### deposit

```solidity
function deposit(uint256 amount, uint256 transferFee) external nonpayable
```

function allows users to deposit into funding pool



#### Parameters

| Name | Type | Description |
|---|---|---|
| amount | uint256 | amount to deposit |
| transferFee | uint256 | this accounts for any transfer fee token may have (e.g. paxg token) |

### depositToken

```solidity
function depositToken() external view returns (address)
```

function returns address of deposit token for pool




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### executeLoanProposal

```solidity
function executeLoanProposal(address loanProposal) external nonpayable
```

function allows execution of a proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposal | address | address of the proposal executed |

### loanProposalFactory

```solidity
function loanProposalFactory() external view returns (address)
```

function returns factory address for loan proposals




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### subscribe

```solidity
function subscribe(address loanProposal, uint256 amount) external nonpayable
```

function allows users from funding pool to subscribe as lenders to a proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposal | address | address of the proposal to which user wants to subscribe |
| amount | uint256 | amount of subscription |

### subscribedBalanceOf

```solidity
function subscribedBalanceOf(address, address) external view returns (uint256)
```

function tracks subscription amounts for a given proposal address and subsciber address



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |
| _1 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

### totalSubscribed

```solidity
function totalSubscribed(address) external view returns (uint256)
```

function tracks total subscription amount for a given proposal address



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

### totalSubscribedIsDeployed

```solidity
function totalSubscribedIsDeployed(address) external view returns (bool)
```

function tracks if subscription is deployed for a given proposal address



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | undefined |

### unsubscribe

```solidity
function unsubscribe(address loanProposal, uint256 amount) external nonpayable
```

function allows subscribed lenders to unsubscribe from a proposal

*there is a cooldown period after subscribing to mitigate possible griefing attacks of subscription followed by quick unsubscription*

#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposal | address | address of the proposal to which user wants to unsubscribe |
| amount | uint256 | amount of subscription removed |

### withdraw

```solidity
function withdraw(uint256 amount) external nonpayable
```

function allows users to withdraw from funding pool



#### Parameters

| Name | Type | Description |
|---|---|---|
| amount | uint256 | amount to withdraw |




