# ChainlinkBasic







*supports oracles which are compatible with v2v3 or v3 interfaces*

## Methods

### getPrice

```solidity
function getPrice(address collToken, address loanToken) external view returns (uint256 collTokenPriceInLoanToken)
```

function checks oracle validity and calculates collTokenPriceInLoanToken



#### Parameters

| Name | Type | Description |
|---|---|---|
| collToken | address | address of coll token |
| loanToken | address | address of loan token |

#### Returns

| Name | Type | Description |
|---|---|---|
| collTokenPriceInLoanToken | uint256 | collateral price denominated in loan token |

### isUSDBased

```solidity
function isUSDBased() external view returns (bool)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | undefined |

### oracleAddrs

```solidity
function oracleAddrs(address) external view returns (address)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |




## Errors

### InvalidAddress

```solidity
error InvalidAddress()
```






### InvalidArrayLength

```solidity
error InvalidArrayLength()
```






### InvalidBTCOracle

```solidity
error InvalidBTCOracle()
```






### InvalidOracleAnswer

```solidity
error InvalidOracleAnswer()
```






### InvalidOracleDecimals

```solidity
error InvalidOracleDecimals()
```






### InvalidOraclePair

```solidity
error InvalidOraclePair()
```






### InvalidOracleVersion

```solidity
error InvalidOracleVersion()
```







