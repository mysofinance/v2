const balancerV2VaultAbi = [
  {
    inputs: [{ internalType: 'bytes32', name: 'poolId', type: 'bytes32' }],
    name: 'getPoolTokens',
    outputs: [
      { internalType: 'contract IERC20[]', name: 'tokens', type: 'address[]' },
      { internalType: 'uint256[]', name: 'balances', type: 'uint256[]' },
      { internalType: 'uint256', name: 'lastChangeBlock', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const balancerV2PoolAbi = [
  {
    inputs: [],
    name: 'getSwapFeePercentage',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const collTokenAbi = [
  {
    inputs: [],
    name: 'cumulativeRewardPerToken',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: '_account', type: 'address' },
      { internalType: 'address', name: '_receiver', type: 'address' }
    ],
    name: 'claimForAccount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  { inputs: [], name: 'updateRewards', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'claimableReward',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    name: 'balanceOf',
    outputs: [{ type: 'uint256', name: '' }],
    inputs: [{ type: 'address', name: 'arg0' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    name: 'approve',
    outputs: [{ type: 'bool', name: '' }],
    inputs: [
      { type: 'address', name: '_spender' },
      { type: 'uint256', name: '_value' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    name: 'getCurrentVotes',
    constant: true,
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    outputs: [{ internalType: 'uint96', name: '', type: 'uint96' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'claimable_tokens',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'claimable_reward',
    inputs: [
      { name: '_user', type: 'address' },
      { name: '_reward_token', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'claimed_reward',
    inputs: [
      { name: '_addr', type: 'address' },
      { name: '_token', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'claim_rewards',
    outputs: [],
    inputs: [
      {
        type: 'address',
        name: '_addr'
      }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'periodFinish',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'reward_count',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'reward_tokens',
    inputs: [{ name: 'arg0', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    stateMutability: 'view',
    type: 'function',
    name: 'integrate_fraction',
    inputs: [{ name: 'arg0', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'gauge_types',
    outputs: [{ type: 'int128', name: '' }],
    inputs: [{ type: 'address', name: '_addr' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'earned',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]

const aavePoolAbi = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'asset',
        type: 'address'
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256'
      },
      {
        internalType: 'address',
        name: 'onBehalfOf',
        type: 'address'
      },
      {
        internalType: 'uint16',
        name: 'referralCode',
        type: 'uint16'
      }
    ],
    name: 'supply',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

const crvRewardsDistributorAbi = [
  {
    name: 'start_next_rewards_period',
    outputs: [],
    inputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

const gmxRewardRouterAbi = [
  {
    inputs: [
      { internalType: 'address', name: '_token', type: 'address' },
      { internalType: 'uint256', name: '_amount', type: 'uint256' },
      { internalType: 'uint256', name: '_minUsdg', type: 'uint256' },
      { internalType: 'uint256', name: '_minGlp', type: 'uint256' }
    ],
    name: 'mintAndStakeGlp',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'uint256', name: '_minUsdg', type: 'uint256' },
      { internalType: 'uint256', name: '_minGlp', type: 'uint256' }
    ],
    name: 'mintAndStakeGlpETH',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  }
]

const chainlinkAggregatorAbi = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { internalType: 'uint80', name: 'roundId', type: 'uint80' },
      { internalType: 'int256', name: 'answer', type: 'int256' },
      { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'updatedAt', type: 'uint256' },
      { internalType: 'uint80', name: 'answeredInRound', type: 'uint80' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const gohmAbi = [
  {
    inputs: [],
    name: 'index',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const uniV2Abi = [
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
      { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
      { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' }
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]

const uniV2RouterAbi = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint256', name: 'liquidity', type: 'uint256' },
      { internalType: 'uint256', name: 'amountAMin', type: 'uint256' },
      { internalType: 'uint256', name: 'amountBMin', type: 'uint256' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'removeLiquidity',
    outputs: [
      { internalType: 'uint256', name: 'amountA', type: 'uint256' },
      { internalType: 'uint256', name: 'amountB', type: 'uint256' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

const payloadScheme = [
  {
    components: [
      {
        internalType: 'address',
        name: 'collToken',
        type: 'address'
      },
      {
        internalType: 'address',
        name: 'loanToken',
        type: 'address'
      },
      {
        internalType: 'address',
        name: 'oracleAddr',
        type: 'address'
      },
      {
        internalType: 'uint256',
        name: 'minLoan',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'maxLoan',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'earliestRepayTenor',
        type: 'uint256'
      },
      {
        internalType: 'address',
        name: 'borrowerCompartmentImplementation',
        type: 'address'
      },
      {
        internalType: 'bool',
        name: 'isSingleUse',
        type: 'bool'
      },
      {
        internalType: 'address',
        name: 'whitelistAddr',
        type: 'address'
      },
      {
        internalType: 'bool',
        name: 'isWhitelistAddrSingleBorrower',
        type: 'bool'
      }
    ],
    internalType: 'struct DataTypesPeerToPeer.GeneralQuoteInfo',
    name: 'generalQuoteInfo',
    type: 'tuple'
  },
  {
    internalType: 'bytes32',
    name: 'quoteTuplesRoot',
    type: 'bytes32'
  },
  {
    internalType: 'bytes32',
    name: 'salt',
    type: 'bytes32'
  },
  {
    internalType: 'uint256',
    name: 'nonce',
    type: 'uint256'
  },
  {
    internalType: 'address',
    name: 'vaultAddr',
    type: 'address'
  },
  {
    internalType: 'uint256',
    name: 'chainId',
    type: 'uint256'
  }
]

export {
  balancerV2VaultAbi,
  balancerV2PoolAbi,
  collTokenAbi,
  aavePoolAbi,
  crvRewardsDistributorAbi,
  gmxRewardRouterAbi,
  chainlinkAggregatorAbi,
  gohmAbi,
  uniV2Abi,
  uniV2RouterAbi,
  payloadScheme
}
