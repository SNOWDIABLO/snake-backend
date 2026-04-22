/* ===================================================================
   SnowDiablo Arcade — Contract addresses + minimal ABIs
   =================================================================== */

export const CONTRACT_ADDRESS     = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1'; // $SNAKE ERC-20
export const NFT_CONTRACT_ADDRESS = '0xda4167D97caAa90DAf5510bcE338a90134BBdfA9'; // SnakeTrophyNFT
export const BOOST_NFT_ADDRESS    = '0x0a507FeAD82014674a0160CEf04570F19334E52C'; // SnakeBoostNFT

// Minimal ABI for claimReward + ERC20 helpers
// ⚠️ NE PAS changer nonce en uint256 : le contract déployé expose
// claimReward(uint256,bytes32,bytes) = selector 0xf337d43d.
// uint256 nonce → selector 0x76618f27 = fonction inexistante → revert instantané.
export const SNAKE_ABI = [
  'function claimReward(uint256 amount, bytes32 nonce, bytes signature) external',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

// Minimal ABI for trophy NFT mint
export const TROPHY_ABI = [
  'function mintTrophyWithSignature(address to, uint256 season, uint256 rank, bytes signature) payable',
  'function balanceOf(address owner) view returns (uint256)'
];

// Minimal ABI for boost NFT (SnakeBoostNFT.sol)
// Tier enum: 0=None, 1=Basic, 2=Pro, 3=Elite, 4=Seasonal
export const BOOST_ABI = [
  'function mintWithPol(uint8 tier) payable returns (uint256)',
  'function mintSeasonalWithPol(uint32 seasonalId) payable returns (uint256)',
  'function mintWithSnakeBurn(uint8 tier) returns (uint256)',
  'function mintSeasonalWithSnakeBurn(uint32 seasonalId) returns (uint256)',
  'function getPolPrice(uint8 tier) view returns (uint256)',
  'function getSeasonalPolPrice(uint32 seasonalId) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)'
];
