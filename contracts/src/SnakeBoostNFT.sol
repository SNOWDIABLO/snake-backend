// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║  SnakeBoostNFT — Public marketplace boost NFTs for SnakeCoin P2E   ║
 * ║  ──────────────────────────────────────────────────────────────── ║
 * ║  Polygon mainnet · ERC-721 · EIP-2981 · Chainlink MATIC/USD feed  ║
 * ║                                                                    ║
 * ║  3 permanent tiers (Basic/Pro/Elite) + seasonal boosts            ║
 * ║  Dual-currency: pay POL (Chainlink priced) OR burn $SNAKE         ║
 * ║  Upgrade path: burn 3 × tier N → mint 1 × tier N+1                ║
 * ║  Supply caps: 10 000 / 2 000 / 500 (+ seasonal caps)              ║
 * ║  SVG on-chain art (zero IPFS dependency)                          ║
 * ║                                                                    ║
 * ║  Contract SEPARATE from SnakeTrophyNFT (top 10 season trophies)   ║
 * ║  Trophy max +25%, Boost max +8% → trophies stay superior          ║
 * ╚════════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract SnakeBoostNFT is ERC721, Ownable, Pausable, IERC2981 {
    using Strings for uint256;

    // ═══════════════════════════════════════════════════════════════════
    //  TIER DEFINITIONS
    // ═══════════════════════════════════════════════════════════════════
    enum Tier { None, Basic, Pro, Elite, Seasonal }

    struct TierConfig {
        uint256 priceUsd;          // Price in USD (scaled 1e8, same as Chainlink)
        uint256 snakeBurnAmount;   // Amount of $SNAKE to burn for alt payment (in wei)
        uint16  multiplierBps;     // Reward multiplier in basis points (200 = 2%)
        uint32  supplyCap;         // Max supply for this tier
        uint32  minted;            // Current minted count
        bool    active;            // Can be purchased
    }

    // Permanent tiers
    mapping(Tier => TierConfig) public tiers;

    // Seasonal boosts : seasonId => TierConfig + metadata
    struct SeasonalBoost {
        string  name;              // e.g. "Spring Boost"
        string  emoji;             // e.g. "🌸"
        uint256 priceUsd;
        uint256 snakeBurnAmount;
        uint16  multiplierBps;
        uint32  supplyCap;
        uint32  minted;
        uint64  openUntil;         // Unix timestamp — after this, no more mint
        bool    active;
    }
    mapping(uint32 => SeasonalBoost) public seasonal;  // seasonId → config
    uint32 public currentSeasonalId;

    // ═══════════════════════════════════════════════════════════════════
    //  TOKEN ↔ METADATA MAPPING
    // ═══════════════════════════════════════════════════════════════════
    struct TokenMeta {
        Tier    tier;              // Basic/Pro/Elite/Seasonal
        uint32  seasonalId;        // If tier == Seasonal, the season identifier (else 0)
        uint64  mintedAt;          // Unix timestamp
    }
    mapping(uint256 => TokenMeta) public tokenMeta;

    uint256 private _nextTokenId = 1;

    // ═══════════════════════════════════════════════════════════════════
    //  EXTERNAL DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════════
    AggregatorV3Interface public priceFeed;   // Polygon MATIC/USD: 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
    IERC20 public snakeToken;                 // $SNAKE ERC-20 address
    address public burnAddress = 0x000000000000000000000000000000000000dEaD;

    // Royalty receiver (EIP-2981)
    address public royaltyReceiver;
    uint96  public royaltyBps = 500;          // 5%

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════
    event BoostMinted(address indexed to, uint256 indexed tokenId, Tier tier, uint32 seasonalId, uint256 paidPol, uint256 burnedSnake);
    event BoostUpgraded(address indexed by, Tier fromTier, Tier toTier, uint256 newTokenId);
    event SeasonalOpened(uint32 indexed seasonalId, string name, uint64 openUntil);
    event TierConfigUpdated(Tier tier, uint256 priceUsd, uint256 snakeBurn, uint16 multBps, uint32 cap);
    event RoyaltyUpdated(address receiver, uint96 bps);

    // ═══════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════
    constructor(
        address _priceFeed,
        address _snakeToken,
        address _royaltyReceiver
    ) ERC721("SnakeCoin Boost", "SNKBOOST") Ownable(msg.sender) {
        require(_priceFeed != address(0), "bad priceFeed");
        require(_snakeToken != address(0), "bad snakeToken");
        require(_royaltyReceiver != address(0), "bad royaltyReceiver");

        priceFeed = AggregatorV3Interface(_priceFeed);
        snakeToken = IERC20(_snakeToken);
        royaltyReceiver = _royaltyReceiver;

        // Default tier configs (can be adjusted later via setTierConfig)
        tiers[Tier.Basic] = TierConfig({
            priceUsd: 3e8,            // 3$ (Chainlink uses 8 decimals)
            snakeBurnAmount: 500 ether,   // 500 $SNAKE
            multiplierBps: 200,       // +2%
            supplyCap: 10000,
            minted: 0,
            active: true
        });
        tiers[Tier.Pro] = TierConfig({
            priceUsd: 10e8,           // 10$
            snakeBurnAmount: 2000 ether,
            multiplierBps: 400,       // +4%
            supplyCap: 2000,
            minted: 0,
            active: true
        });
        tiers[Tier.Elite] = TierConfig({
            priceUsd: 25e8,           // 25$
            snakeBurnAmount: 5000 ether,
            multiplierBps: 800,       // +8%
            supplyCap: 500,
            minted: 0,
            active: true
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PRICING HELPERS (Chainlink)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Returns the MATIC/POL price in USD (scaled 1e8)
    function getMaticUsdPrice() public view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = priceFeed.latestRoundData();
        require(answer > 0, "stale feed");
        require(block.timestamp - updatedAt < 3 hours, "price too old");
        return uint256(answer);
    }

    /// @notice Returns POL amount (in wei) needed to pay a given tier
    function getPolPrice(Tier tier) public view returns (uint256) {
        uint256 usd = tier == Tier.Seasonal ? seasonal[currentSeasonalId].priceUsd : tiers[tier].priceUsd;
        require(usd > 0, "bad tier");
        uint256 maticUsd = getMaticUsdPrice();
        // priceUsd (1e8) * 1e18 / maticUsd (1e8) = POL in wei
        return (usd * 1e18) / maticUsd;
    }

    /// @notice Returns POL amount for a specific seasonal boost
    function getSeasonalPolPrice(uint32 seasonalId) public view returns (uint256) {
        SeasonalBoost memory s = seasonal[seasonalId];
        require(s.priceUsd > 0, "bad seasonal");
        uint256 maticUsd = getMaticUsdPrice();
        return (s.priceUsd * 1e18) / maticUsd;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PUBLIC MINT — pay in POL
    // ═══════════════════════════════════════════════════════════════════

    function mintWithPol(Tier tier) external payable whenNotPaused returns (uint256) {
        require(tier == Tier.Basic || tier == Tier.Pro || tier == Tier.Elite, "not a permanent tier");
        TierConfig storage cfg = tiers[tier];
        require(cfg.active, "tier inactive");
        require(cfg.minted < cfg.supplyCap, "tier sold out");

        uint256 required = getPolPrice(tier);
        require(msg.value >= required, "not enough POL");

        // Accept up to 2% overpay (Chainlink price variance) — refund difference
        uint256 refund = msg.value > required ? msg.value - required : 0;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }

        cfg.minted++;
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        tokenMeta[tokenId] = TokenMeta({tier: tier, seasonalId: 0, mintedAt: uint64(block.timestamp)});

        emit BoostMinted(msg.sender, tokenId, tier, 0, required, 0);
        return tokenId;
    }

    function mintSeasonalWithPol(uint32 seasonalId) external payable whenNotPaused returns (uint256) {
        SeasonalBoost storage s = seasonal[seasonalId];
        require(s.active, "seasonal inactive");
        require(block.timestamp <= s.openUntil, "seasonal window closed");
        require(s.minted < s.supplyCap, "seasonal sold out");

        uint256 required = getSeasonalPolPrice(seasonalId);
        require(msg.value >= required, "not enough POL");

        uint256 refund = msg.value - required;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }

        s.minted++;
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        tokenMeta[tokenId] = TokenMeta({tier: Tier.Seasonal, seasonalId: seasonalId, mintedAt: uint64(block.timestamp)});

        emit BoostMinted(msg.sender, tokenId, Tier.Seasonal, seasonalId, required, 0);
        return tokenId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PUBLIC MINT — pay by burning $SNAKE
    // ═══════════════════════════════════════════════════════════════════

    function mintWithSnakeBurn(Tier tier) external whenNotPaused returns (uint256) {
        require(tier == Tier.Basic || tier == Tier.Pro || tier == Tier.Elite, "not a permanent tier");
        TierConfig storage cfg = tiers[tier];
        require(cfg.active, "tier inactive");
        require(cfg.minted < cfg.supplyCap, "tier sold out");
        require(cfg.snakeBurnAmount > 0, "burn disabled");

        // Transfer $SNAKE from user to burn address
        bool ok = snakeToken.transferFrom(msg.sender, burnAddress, cfg.snakeBurnAmount);
        require(ok, "SNAKE transfer failed");

        cfg.minted++;
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        tokenMeta[tokenId] = TokenMeta({tier: tier, seasonalId: 0, mintedAt: uint64(block.timestamp)});

        emit BoostMinted(msg.sender, tokenId, tier, 0, 0, cfg.snakeBurnAmount);
        return tokenId;
    }

    function mintSeasonalWithSnakeBurn(uint32 seasonalId) external whenNotPaused returns (uint256) {
        SeasonalBoost storage s = seasonal[seasonalId];
        require(s.active, "seasonal inactive");
        require(block.timestamp <= s.openUntil, "seasonal window closed");
        require(s.minted < s.supplyCap, "seasonal sold out");
        require(s.snakeBurnAmount > 0, "burn disabled");

        bool ok = snakeToken.transferFrom(msg.sender, burnAddress, s.snakeBurnAmount);
        require(ok, "SNAKE transfer failed");

        s.minted++;
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        tokenMeta[tokenId] = TokenMeta({tier: Tier.Seasonal, seasonalId: seasonalId, mintedAt: uint64(block.timestamp)});

        emit BoostMinted(msg.sender, tokenId, Tier.Seasonal, seasonalId, 0, s.snakeBurnAmount);
        return tokenId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UPGRADE PATH — burn 3 × tier N → mint 1 × tier N+1 (free)
    // ═══════════════════════════════════════════════════════════════════

    function upgrade(uint256[] calldata tokenIds) external whenNotPaused returns (uint256) {
        require(tokenIds.length == 3, "need exactly 3");

        Tier fromTier = tokenMeta[tokenIds[0]].tier;
        require(fromTier == Tier.Basic || fromTier == Tier.Pro, "upgrade not available");
        require(tokenMeta[tokenIds[0]].seasonalId == 0, "seasonal not upgradable");

        // Check all 3 tokens same tier, same owner, not seasonal
        for (uint256 i = 0; i < 3; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "not owner");
            require(tokenMeta[tokenIds[i]].tier == fromTier, "mixed tiers");
            require(tokenMeta[tokenIds[i]].seasonalId == 0, "seasonal not upgradable");
        }

        // Burn all 3
        for (uint256 i = 0; i < 3; i++) {
            _burn(tokenIds[i]);
            delete tokenMeta[tokenIds[i]];
        }

        // Update minted counters (free up supply for re-use? NO - burned are permanent)
        // Note: we don't decrement cfg.minted because the slots were "used". The user traded 3 low-tier for 1 high-tier.

        Tier toTier = fromTier == Tier.Basic ? Tier.Pro : Tier.Elite;
        TierConfig storage toCfg = tiers[toTier];
        require(toCfg.minted < toCfg.supplyCap, "target tier sold out");

        toCfg.minted++;
        uint256 newTokenId = _nextTokenId++;
        _safeMint(msg.sender, newTokenId);
        tokenMeta[newTokenId] = TokenMeta({tier: toTier, seasonalId: 0, mintedAt: uint64(block.timestamp)});

        emit BoostUpgraded(msg.sender, fromTier, toTier, newTokenId);
        return newTokenId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  MULTIPLIER QUERY (used by backend /api/claim to compute reward)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Returns the active multiplier (bps) for a wallet.
    ///         Rule: max between permanent tier held + currently-active seasonal (stackable).
    function getActiveMultiplierBps(address wallet) external view returns (uint16) {
        uint256 bal = balanceOf(wallet);
        if (bal == 0) return 0;

        uint16 bestPermanent = 0;
        uint16 bestSeasonalActive = 0;

        // Iterate owned tokens
        for (uint256 i = 1; i < _nextTokenId; i++) {
            if (_ownerOf(i) == wallet) {
                TokenMeta memory m = tokenMeta[i];
                if (m.tier == Tier.Basic || m.tier == Tier.Pro || m.tier == Tier.Elite) {
                    uint16 b = tiers[m.tier].multiplierBps;
                    if (b > bestPermanent) bestPermanent = b;
                } else if (m.tier == Tier.Seasonal) {
                    SeasonalBoost memory s = seasonal[m.seasonalId];
                    if (block.timestamp <= s.openUntil || s.multiplierBps > 0) {
                        // Seasonal boost stays active forever once minted (forever-use)
                        if (s.multiplierBps > bestSeasonalActive) bestSeasonalActive = s.multiplierBps;
                    }
                }
            }
        }
        return bestPermanent + bestSeasonalActive;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN — tier configuration
    // ═══════════════════════════════════════════════════════════════════

    function setTierConfig(
        Tier tier,
        uint256 priceUsd,
        uint256 snakeBurn,
        uint16 multBps,
        uint32 cap,
        bool active
    ) external onlyOwner {
        require(tier == Tier.Basic || tier == Tier.Pro || tier == Tier.Elite, "bad tier");
        TierConfig storage cfg = tiers[tier];
        require(cap >= cfg.minted, "cap below minted");
        cfg.priceUsd = priceUsd;
        cfg.snakeBurnAmount = snakeBurn;
        cfg.multiplierBps = multBps;
        cfg.supplyCap = cap;
        cfg.active = active;
        emit TierConfigUpdated(tier, priceUsd, snakeBurn, multBps, cap);
    }

    function openSeasonal(
        uint32 seasonalId,
        string calldata name,
        string calldata emoji,
        uint256 priceUsd,
        uint256 snakeBurn,
        uint16 multBps,
        uint32 cap,
        uint64 openUntil
    ) external onlyOwner {
        require(seasonal[seasonalId].priceUsd == 0, "already opened");
        require(openUntil > block.timestamp, "past date");
        seasonal[seasonalId] = SeasonalBoost({
            name: name,
            emoji: emoji,
            priceUsd: priceUsd,
            snakeBurnAmount: snakeBurn,
            multiplierBps: multBps,
            supplyCap: cap,
            minted: 0,
            openUntil: openUntil,
            active: true
        });
        currentSeasonalId = seasonalId;
        emit SeasonalOpened(seasonalId, name, openUntil);
    }

    function deactivateSeasonal(uint32 seasonalId) external onlyOwner {
        seasonal[seasonalId].active = false;
    }

    function setPriceFeed(address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "bad addr");
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function setSnakeToken(address _snakeToken) external onlyOwner {
        require(_snakeToken != address(0), "bad addr");
        snakeToken = IERC20(_snakeToken);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Withdraw POL revenue to a destination (typically multisig or project wallet)
    function withdrawPol(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "bad addr");
        require(amount <= address(this).balance, "insufficient");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer failed");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ROYALTIES (EIP-2981)
    // ═══════════════════════════════════════════════════════════════════

    function royaltyInfo(uint256 /* tokenId */, uint256 salePrice) external view override returns (address, uint256) {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(receiver != address(0), "bad receiver");
        require(bps <= 1000, "max 10%");
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyUpdated(receiver, bps);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ERC-165 — declare support for IERC2981 + IERC721
    // ═══════════════════════════════════════════════════════════════════

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TOKEN URI — on-chain SVG art + JSON metadata (no IPFS)
    // ═══════════════════════════════════════════════════════════════════

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        TokenMeta memory m = tokenMeta[tokenId];

        string memory tierName;
        string memory tierEmoji;
        uint16 multBps;

        if (m.tier == Tier.Basic)      { tierName = "Basic Boost";  tierEmoji = unicode"🟢"; multBps = tiers[Tier.Basic].multiplierBps; }
        else if (m.tier == Tier.Pro)   { tierName = "Pro Boost";    tierEmoji = unicode"🔵"; multBps = tiers[Tier.Pro].multiplierBps; }
        else if (m.tier == Tier.Elite) { tierName = "Elite Boost";  tierEmoji = unicode"💎"; multBps = tiers[Tier.Elite].multiplierBps; }
        else                           { tierName = seasonal[m.seasonalId].name; tierEmoji = seasonal[m.seasonalId].emoji; multBps = seasonal[m.seasonalId].multiplierBps; }

        string memory svg = _buildSVG(m.tier, tierName, multBps);
        string memory json = string.concat(
            '{"name":"', tierName, ' #', tokenId.toString(),
            '","description":"On-chain NFT boost for SnakeCoin P2E. Grants a permanent $SNAKE reward multiplier.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
              '{"trait_type":"Tier","value":"', tierName, '"},',
              '{"trait_type":"Multiplier","value":"+', uint256(multBps / 100).toString(), '%"},',
              '{"trait_type":"Minted At","display_type":"date","value":', uint256(m.mintedAt).toString(), '}',
            ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _buildSVG(Tier tier, string memory name, uint16 multBps) internal pure returns (string memory) {
        string memory bgColor;
        string memory glowColor;
        string memory orbColor;

        if (tier == Tier.Basic) {
            bgColor = "#0b1f0b"; glowColor = "#4ade80"; orbColor = "#22c55e";
        } else if (tier == Tier.Pro) {
            bgColor = "#0a1628"; glowColor = "#38bdf8"; orbColor = "#0ea5e9";
        } else if (tier == Tier.Elite) {
            bgColor = "#1a0b2e"; glowColor = "#c084fc"; orbColor = "#a855f7";
        } else {
            // Seasonal — pink/gold mix
            bgColor = "#2a1a0f"; glowColor = "#fbbf24"; orbColor = "#f59e0b";
        }

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
              '<defs>',
                '<radialGradient id="orb" cx="50%" cy="50%">',
                  '<stop offset="0%" stop-color="', glowColor, '" stop-opacity="1"/>',
                  '<stop offset="50%" stop-color="', orbColor, '" stop-opacity="0.9"/>',
                  '<stop offset="100%" stop-color="#000" stop-opacity="0.8"/>',
                '</radialGradient>',
                '<radialGradient id="halo" cx="50%" cy="50%">',
                  '<stop offset="0%" stop-color="', glowColor, '" stop-opacity="0.5"/>',
                  '<stop offset="100%" stop-color="', glowColor, '" stop-opacity="0"/>',
                '</radialGradient>',
              '</defs>',
              '<rect width="400" height="400" fill="', bgColor, '"/>',
              '<circle cx="200" cy="180" r="180" fill="url(#halo)"/>',
              '<circle cx="200" cy="180" r="90" fill="url(#orb)"/>',
              '<circle cx="200" cy="180" r="90" fill="none" stroke="', glowColor, '" stroke-width="2" opacity="0.6"/>',
              '<text x="200" y="340" text-anchor="middle" font-family="monospace" font-size="28" font-weight="bold" fill="', glowColor, '">', name, '</text>',
              '<text x="200" y="375" text-anchor="middle" font-family="monospace" font-size="22" fill="#ffffff">+', uint256(multBps / 100).toString(), '% $SNAKE</text>',
            '</svg>'
        );
    }
}
