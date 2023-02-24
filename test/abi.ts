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

export { balancerV2VaultAbi, balancerV2PoolAbi, collTokenAbi, aavePoolAbi, crvRewardsDistributorAbi }