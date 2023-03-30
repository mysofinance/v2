# FundingPool









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



## Events

### ClaimRepayment

```solidity
event ClaimRepayment(address indexed sender, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |
| amount  | uint256 | undefined |

### ConversionExercised

```solidity
event ConversionExercised(address indexed sender, uint256 repaymentIdx, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |
| repaymentIdx  | uint256 | undefined |
| amount  | uint256 | undefined |

### DefaultProceedsClaimed

```solidity
event DefaultProceedsClaimed(address indexed sender)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |

### LoanDefaulted

```solidity
event LoanDefaulted()
```






### LoanDeployed

```solidity
event LoanDeployed()
```






### LoanProposalCreated

```solidity
event LoanProposalCreated(address indexed loanProposalAddr, address indexed fundingPool, address indexed sender, address collToken, uint256 arrangerFee, uint256 unsubscribeGracePeriod)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| fundingPool `indexed` | address | undefined |
| sender `indexed` | address | undefined |
| collToken  | address | undefined |
| arrangerFee  | uint256 | undefined |
| unsubscribeGracePeriod  | uint256 | undefined |

### LoanProposalExecuted

```solidity
event LoanProposalExecuted(address indexed loanProposalAddr)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |

### LoanTermsAccepted

```solidity
event LoanTermsAccepted()
```






### LoanTermsAndTransferCollFinalized

```solidity
event LoanTermsAndTransferCollFinalized(uint256 finalLoanAmount, uint256 _finalCollAmountReservedForDefault, uint256 _finalCollAmountReservedForConversions, uint256 _arrangerFee)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| finalLoanAmount  | uint256 | undefined |
| _finalCollAmountReservedForDefault  | uint256 | undefined |
| _finalCollAmountReservedForConversions  | uint256 | undefined |
| _arrangerFee  | uint256 | undefined |

### LoanTermsProposed

```solidity
event LoanTermsProposed(DataTypes.LoanTerms loanTerms)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanTerms  | DataTypes.LoanTerms | undefined |

### Repay

```solidity
event Repay(uint256 remainingLoanTokenDue, uint256 collTokenLeftUnconverted)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| remainingLoanTokenDue  | uint256 | undefined |
| collTokenLeftUnconverted  | uint256 | undefined |

### Rollback

```solidity
event Rollback()
```






### Subscribed

```solidity
event Subscribed(address indexed loanProposalAddr, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| amount  | uint256 | undefined |

### Unsubscribed

```solidity
event Unsubscribed(address indexed loanProposalAddr, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| amount  | uint256 | undefined |



## Errors

### BeforeEarliestUnsubscribe

```solidity
error BeforeEarliestUnsubscribe()
```






### InsufficientBalance

```solidity
error InsufficientBalance()
```






### InvalidSendAmount

```solidity
error InvalidSendAmount()
```






### InvalidWithdrawAmount

```solidity
error InvalidWithdrawAmount()
```






### NotInSubscriptionPhase

```solidity
error NotInSubscriptionPhase()
```






### NotInUnsubscriptionPhase

```solidity
error NotInUnsubscriptionPhase()
```






### SubscriptionAmountTooHigh

```solidity
error SubscriptionAmountTooHigh()
```






### UnregisteredLoanProposal

```solidity
error UnregisteredLoanProposal()
```






### UnsubscriptionAmountTooLarge

```solidity
error UnsubscriptionAmountTooLarge()
```







