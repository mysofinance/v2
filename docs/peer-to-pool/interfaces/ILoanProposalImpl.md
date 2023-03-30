# ILoanProposalImpl









## Methods

### acceptLoanTerms

```solidity
function acceptLoanTerms() external nonpayable
```

Accept loan terms

*Can only be called by the borrower*


### canSubscribe

```solidity
function canSubscribe() external view returns (bool)
```

Returns flag indicating whether lenders can currently subscribe to loan proposal




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Flag indicating whether lenders can currently subscribe to loan proposal |

### canUnsubscribe

```solidity
function canUnsubscribe() external view returns (bool)
```

Returns flag indicating whether lenders can currently unsubscribe from loan proposal




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Flag indicating whether lenders can currently unsubscribe from loan proposal |

### checkAndupdateStatus

```solidity
function checkAndupdateStatus() external nonpayable
```

Checks and updates the status of the loan proposal from &#39;READY_TO_EXECUTE&#39; to &#39;LOAN_DEPLOYED&#39;

*Can only be called by funding pool in conjunction with executing the loan proposal and settling amounts, i.e., sending loan amount to borrower and fees*


### claimDefaultProceeds

```solidity
function claimDefaultProceeds() external nonpayable
```

Allows lenders to claim default proceeds

*Can only be called if borrower defaulted and loan proposal was marked as defaulted; default proceeds are whatever is left in collateral token in loan proposal contract; proceeds are splitted among all lenders taking into account any conversions lenders already made during the default period.*


### claimRepayment

```solidity
function claimRepayment(uint256 repaymentIdx) external nonpayable
```

Allows lenders to claim any repayments for given repayment period

*Can only be called by entitled lenders and if they didn&#39;t make use of their conversion right*

#### Parameters

| Name | Type | Description |
|---|---|---|
| repaymentIdx | uint256 | the given repayment period index |

### collTokenConverted

```solidity
function collTokenConverted(uint256 repaymentIdx) external view returns (uint256)
```

Returns the amount of collateral tokens that were converted during given repayment period



#### Parameters

| Name | Type | Description |
|---|---|---|
| repaymentIdx | uint256 | The respective repayment index of given period |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | The total amount of collateral tokens that were converted during given repayment period |

### dynamicData

```solidity
function dynamicData() external view returns (uint256 arrangerFee, uint256 finalLoanAmount, uint256 finalCollAmountReservedForDefault, uint256 finalCollAmountReservedForConversions, uint256 loanTermsLockedTime, uint256 currentRepaymentIdx, enum DataTypes.LoanStatus status)
```

Returns core dynamic data for given loan proposal

*Note that finalCollAmountReservedForDefault is a lower bound for the collateral amount that lenders can claim in case of a default. This means that in case all lenders converted and the borrower defaults then this amount will be distributed as default recovery value on a pro-rata basis to lenders. In the other case where no lenders converted then finalCollAmountReservedForDefault plus finalCollAmountReservedForConversions will be available as default recovery value for lenders, hence finalCollAmountReservedForDefault is a lower bound for a lender&#39;s default recovery value.*


#### Returns

| Name | Type | Description |
|---|---|---|
| arrangerFee | uint256 | The arranger fee, which initially is expressed in relative terms (i.e., 100% = BASE) and once the proposal gets finalized is in absolute terms (e.g., 1000 USDC) |
| finalLoanAmount | uint256 | The final loan amount, which initially is zero and gets set once the proposal gets finalized |
| finalCollAmountReservedForDefault | uint256 | The final collateral amount reserved for default case, which initially is zero and gets set once the proposal gets finalized. |
| finalCollAmountReservedForConversions | uint256 | The final collateral amount reserved for lender conversions, which initially is zero and gets set once the proposal gets finalized |
| loanTermsLockedTime | uint256 | The timestamp when loan terms got locked in, which initially is zero and gets set once the proposal gets finalized |
| currentRepaymentIdx | uint256 | The current repayment index, which gets incremented on every repay |
| status | enum DataTypes.LoanStatus | The current loan proposal status. |

### exerciseConversion

```solidity
function exerciseConversion() external nonpayable
```

Allows lenders to exercise their conversion right for given repayment period

*Can only be called by entitled lenders and during conversion grace period of given repayment period*


### finalizeLoanTermsAndTransferColl

```solidity
function finalizeLoanTermsAndTransferColl(uint256 expectedTransferFee) external nonpayable
```

Finalize the loan terms and transfer final collateral amount

*Can only be called by the borrower*

#### Parameters

| Name | Type | Description |
|---|---|---|
| expectedTransferFee | uint256 | The expected transfer fee (if any) of the collateral token |

### getAbsoluteLoanTerms

```solidity
function getAbsoluteLoanTerms(DataTypes.LoanTerms _tmpLoanTerms, uint256 totalSubscribed, uint256 loanTokenDecimals) external view returns (struct DataTypes.LoanTerms loanTerms, uint256 absArrangerFee, uint256 absLoanAmount, uint256 absCollAmountReservedForDefault, uint256 absCollAmountReservedForConversions)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _tmpLoanTerms | DataTypes.LoanTerms | undefined |
| totalSubscribed | uint256 | undefined |
| loanTokenDecimals | uint256 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| loanTerms | DataTypes.LoanTerms | undefined |
| absArrangerFee | uint256 | undefined |
| absLoanAmount | uint256 | undefined |
| absCollAmountReservedForDefault | uint256 | undefined |
| absCollAmountReservedForConversions | uint256 | undefined |

### initialize

```solidity
function initialize(address _arranger, address _fundingPool, address _collToken, uint256 _arrangerFee, uint256 _unsubscribeGracePeriod, uint256 _conversionGracePeriod, uint256 _repaymentGracePeriod) external nonpayable
```

Initializes loan proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| _arranger | address | Address of the arranger of the proposal |
| _fundingPool | address | Address of the funding pool to be used to source liquidity, if successful |
| _collToken | address | Address of collateral token to be used in loan |
| _arrangerFee | uint256 | Arranger fee in percent (where 100% = BASE) |
| _unsubscribeGracePeriod | uint256 | The unsubscribe grace period, i.e., after a loan gets accepted by the borrower lenders can still unsubscribe for this time period before being locked-in |
| _conversionGracePeriod | uint256 | The grace period during which lenders can convert |
| _repaymentGracePeriod | uint256 | The grace period during which borrowers can repay |

### loanTerms

```solidity
function loanTerms() external view returns (struct DataTypes.LoanTerms)
```

Returns the current loan terms




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | DataTypes.LoanTerms | The current loan terms |

### markAsDefaulted

```solidity
function markAsDefaulted() external nonpayable
```

Marks loan proposal as defaulted

*Can be called by anyone but only if borrower failed to repay during repayment grace period*


### proposeLoanTerms

```solidity
function proposeLoanTerms(DataTypes.LoanTerms newLoanTerms) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| newLoanTerms | DataTypes.LoanTerms | undefined |

### repay

```solidity
function repay(uint256 expectedTransferFee) external nonpayable
```

Allows borrower to repay

*Can only be called by borrower and during repayment grace period of given repayment period. If borrower doesn&#39;t repay in time the loan can be marked as defaulted and borrowers loses control over pledged collateral. Note that the repayment amount can be lower than the loanTokenDue if lenders convert (potentially 0 if all convert, in which case borrower still needs to call the repay function to not default). Also note that on repay any unconverted collateral token reserved for conversions for that period get transferred back to borrower.*

#### Parameters

| Name | Type | Description |
|---|---|---|
| expectedTransferFee | uint256 | The expected transfer fee (if any) of the loan token |

### rollback

```solidity
function rollback() external nonpayable
```

Rolls back the loan proposal

*Can be called by borrower during the unsubscribe grace period or by anyone in case the total subscribed fell below the minLoanAmount*


### staticData

```solidity
function staticData() external view returns (address fundingPool, address collToken, address arranger, uint256 unsubscribeGracePeriod, uint256 conversionGracePeriod, uint256 repaymentGracePeriod)
```

Returns core static data for given loan proposal




#### Returns

| Name | Type | Description |
|---|---|---|
| fundingPool | address | The address of the funding pool from which lenders can subscribe, and from which -upon acceptance- the final loan amount gets sourced |
| collToken | address | The address of the collateral token to be provided by the borrower |
| arranger | address | The address of the arranger of the proposal |
| unsubscribeGracePeriod | uint256 | Unsubscribe grace period until which lenders can unsubscribe after a loan proposal got accepted by the borrower |
| conversionGracePeriod | uint256 | Conversion grace period during which lenders can convert, i.e., between [dueTimeStamp, dueTimeStamp+conversionGracePeriod] |
| repaymentGracePeriod | uint256 | Repayment grace period during which borrowers can repay, i.e., between [dueTimeStamp+conversionGracePeriod, dueTimeStamp+conversionGracePeriod+repaymentGracePeriod] |

### totalConvertedSubscriptionsPerIdx

```solidity
function totalConvertedSubscriptionsPerIdx(uint256 repaymentIdx) external view returns (uint256)
```

Returns the amount of subscriptions that converted for given repayment period



#### Parameters

| Name | Type | Description |
|---|---|---|
| repaymentIdx | uint256 | The respective repayment index of given period |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | The total amount of subscriptions that converted for given repayment period |




