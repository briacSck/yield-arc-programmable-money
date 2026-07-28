// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @title MockYieldVenue — TEST DOUBLE ONLY. Never deployed to Arc.
/// @notice Implements the `IYieldVenue` seam {AgentMandateV2} depends on, shaped after Circle's
/// USYC Teller (separate share token, `deposit(assets,receiver)` pulling via allowance,
/// `redeem(shares,receiver,account)`), with the knobs the suite needs to drive the paths a real
/// fund exhibits but cannot be summoned on demand:
///   - `setPriceE6`   — NAV per share. 1e6 = par. Raise it for a gain, lower it for a loss.
///   - `setFeeBps`    — a subscription haircut, so shares minted < assets/price.
///   - `failDeposit` / `failRedeem` — a venue that reverts (stuck fund, paused vault, lost RPC).
///   - `mintZeroShares` / `payZeroAssets` — a venue that "succeeds" while moving nothing.
///   - `breakPreviewWithdraw` — forces the mandate's pro-rata share-sizing fallback.
///
/// Round-trip realism: the Arc testnet numbers this models are 1.000000 USDC → 0.883092 USYC and
/// 1.000000 USYC → 1.132275 USDC, i.e. a price of ~1.132275e6 with a small subscription haircut.
contract MockYieldVenue {
    MockERC20 public immutable assetToken;
    MockERC20 public immutable shareToken;

    /// @notice USDC (6-dec) per 1e6 shares. 1e6 == par.
    uint256 public priceE6 = 1e6;
    /// @notice Subscription haircut in basis points, applied to assets before minting.
    uint256 public feeBps;

    bool public failDeposit;
    bool public failRedeem;
    bool public mintZeroShares;
    bool public payZeroAssets;
    bool public breakPreviewWithdraw;

    constructor(MockERC20 asset_, MockERC20 share_) {
        assetToken = asset_;
        shareToken = share_;
    }

    // ── knobs ────────────────────────────────────────────────────────────────
    function setPriceE6(uint256 p) external {
        priceE6 = p;
    }

    function setFeeBps(uint256 b) external {
        feeBps = b;
    }

    function setFailDeposit(bool v) external {
        failDeposit = v;
    }

    function setFailRedeem(bool v) external {
        failRedeem = v;
    }

    function setMintZeroShares(bool v) external {
        mintZeroShares = v;
    }

    function setPayZeroAssets(bool v) external {
        payZeroAssets = v;
    }

    function setBreakPreviewWithdraw(bool v) external {
        breakPreviewWithdraw = v;
    }

    // ── IYieldVenue ──────────────────────────────────────────────────────────
    function asset() external view returns (address) {
        return address(assetToken);
    }

    function share() external view returns (address) {
        return address(shareToken);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        uint256 net = assets - (assets * feeBps) / 10_000;
        return (net * 1e6) / priceE6;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return (shares * priceE6) / 1e6;
    }

    /// @dev Rounds UP, like a real vault sizing a withdrawal.
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        require(!breakPreviewWithdraw, "MockYieldVenue: preview unavailable");
        return (assets * 1e6 + priceE6 - 1) / priceE6;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(!failDeposit, "MockYieldVenue: deposit disabled");
        assetToken.transferFrom(msg.sender, address(this), assets);
        shares = mintZeroShares ? 0 : previewDeposit(assets);
        if (shares != 0) shareToken.mint(receiver, shares);
    }

    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets) {
        require(!failRedeem, "MockYieldVenue: redeem disabled");
        shareToken.burn(account, shares);
        assets = payZeroAssets ? 0 : previewRedeem(shares);
        if (assets != 0) assetToken.transfer(receiver, assets);
    }
}
