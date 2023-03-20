# IStakingHelper









## Methods

### claim

```solidity
function claim(address _receiver) external nonpayable returns (uint256)
```

Claim fee reward tokens



#### Parameters

| Name | Type | Description |
|---|---|---|
| _receiver | address | address which is recipient of the claim |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

### claim_rewards

```solidity
function claim_rewards() external nonpayable
```

Claim all available reward tokens for msg.sender




### deposit

```solidity
function deposit(uint256 value, address depositAddr) external nonpayable
```

Deposit `value` LP tokens, curve type take pools



#### Parameters

| Name | Type | Description |
|---|---|---|
| value | uint256 | Number of tokens to deposit |
| depositAddr | address | Address to deposit for |

### gauges

```solidity
function gauges(uint256 index) external view returns (address)
```

returns gauge address by index from gaugeController



#### Parameters

| Name | Type | Description |
|---|---|---|
| index | uint256 | index in gauge controller array that returns liquidity gauge address |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### lp_token

```solidity
function lp_token() external view returns (address)
```

returns lpToken address for gauge




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### mint

```solidity
function mint(address gaugeAddr) external nonpayable
```

Mint allocated tokens for the caller based on a single gauge.



#### Parameters

| Name | Type | Description |
|---|---|---|
| gaugeAddr | address | address to get mintable amount from |

### reward_tokens

```solidity
function reward_tokens(uint256 index) external view returns (address)
```

returns reward token address for liquidity gauge by index



#### Parameters

| Name | Type | Description |
|---|---|---|
| index | uint256 | index of particular token address in the reward token array |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### withdraw

```solidity
function withdraw(uint256 value) external nonpayable
```

Withdraw `value` LP tokens, curve type take pools



#### Parameters

| Name | Type | Description |
|---|---|---|
| value | uint256 | Number of tokens to withdraw |




